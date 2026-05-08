import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { auth, isNeonAuthConfigured } from "./auth/server";
import { getDb, hasDatabase } from "@/db/client";
import {
  appUsers,
  calls,
  callOutcomes,
  callReviews,
  callScorecards,
  coachingTargets,
  coachingActionItems,
  coachingSummaries,
  complianceFlags,
  deliveryEvents,
  ingestionRuns,
  managerCoachingSessions,
  managerRepAssignments,
  pipelineJobs,
  reportArtifacts
} from "@/db/schema";
import { chooseCoachingFocus, strongestScoreDimension, weakestScoreDimension } from "./coaching-focus";
import {
  rubricKeys,
  type AppUser,
  type CallCrmOutcome,
  type CallRow,
  type CrmOutcomeBucket,
  type CoachingFeedback,
  type CoachingTarget,
  type DashboardData,
  type DimensionTrendPoint,
  type ManagerFocusDecision,
  type ManagerSession,
  type OutcomeSummary,
  type PeriodType,
  type PipelineIncident,
  type PipelineMonitoring,
  type RepPerformance,
  type RubricKey,
  type UserRole
} from "./types";

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

const feedbackTableName = "coaching_feedback";
const feedbackTable = sql.raw(feedbackTableName);

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function toNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatTrendLabel(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildScoreTrend(summaryRows: Array<{ periodEnd: string | Date; averageScore: unknown }>, fallbackScore: number) {
  const byDate = new Map<string, number[]>();
  for (const summary of summaryRows) {
    const dateKey = typeof summary.periodEnd === "string" ? summary.periodEnd : summary.periodEnd.toISOString().slice(0, 10);
    const values = byDate.get(dateKey) || [];
    values.push(toNumber(summary.averageScore));
    byDate.set(dateKey, values);
  }

  const trend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([dateKey, values]) => ({
      label: formatTrendLabel(dateKey),
      score: values.reduce((sum, value) => sum + value, 0) / values.length
    }));

  return trend.length ? trend : [{ label: "Current", score: fallbackScore }];
}

function emptyScores() {
  return Object.fromEntries(rubricKeys.map((key) => [key, 0])) as Record<RubricKey, number>;
}

function coerceScores(value: unknown, fallback: Record<RubricKey, number> = emptyScores()) {
  const source = value && typeof value === "object" ? (value as Partial<Record<RubricKey, unknown>>) : {};
  return Object.fromEntries(rubricKeys.map((key) => [key, toNumber(source[key] ?? fallback[key])])) as Record<RubricKey, number>;
}

function emptyOutcomeSummary(): OutcomeSummary {
  return {
    won: 0,
    lost: 0,
    open: 0,
    noDecision: 0,
    unknown: 0,
    total: 0,
    closed: 0,
    winRate: 0
  };
}

function finalizeOutcomeSummary(summary: OutcomeSummary): OutcomeSummary {
  const closed = summary.won + summary.lost;
  return {
    ...summary,
    closed,
    winRate: closed ? summary.won / closed : 0
  };
}

function sumOutcomeSummaries(summaries: OutcomeSummary[]): OutcomeSummary {
  const aggregate = emptyOutcomeSummary();
  for (const summary of summaries) {
    aggregate.won += summary.won;
    aggregate.lost += summary.lost;
    aggregate.open += summary.open;
    aggregate.noDecision += summary.noDecision;
    aggregate.unknown += summary.unknown;
    aggregate.total += summary.total;
  }
  return finalizeOutcomeSummary(aggregate);
}

function isNoDecisionOutcome(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith("no_decision");
}

function crmOutcomeBucketFromValue(input: {
  statusType?: string | null;
  statusLabel?: string | null;
  won?: boolean | null;
  lost?: boolean | null;
  closeOpportunityId?: string | null;
}): CrmOutcomeBucket {
  if (input.won || input.statusType === "won") return "won";
  if (input.lost || input.statusType === "lost") return "lost";

  const normalizedStatus = (input.statusType || "").trim().toLowerCase();
  const normalizedLabel = (input.statusLabel || "").trim().toLowerCase();
  if (normalizedStatus === "active" || normalizedStatus === "open") return "open";
  if (normalizedLabel === "open" || normalizedLabel === "active") return "open";
  if (input.closeOpportunityId || input.statusType || input.statusLabel) return "open";
  return "unknown";
}

function buildCallCrmOutcome(input: {
  closeLeadId?: string | null;
  closeOpportunityId?: string | null;
  pipelineName?: string | null;
  statusLabel?: string | null;
  statusType?: string | null;
  value?: unknown;
  valuePeriod?: string | null;
  won?: boolean | null;
  lost?: boolean | null;
  closeDate?: string | Date | null;
  scorecardOutcomeType?: string | null;
}): CallCrmOutcome | null {
  const hasCrmContext =
    Boolean(input.closeLeadId) ||
    Boolean(input.closeOpportunityId) ||
    Boolean(input.pipelineName) ||
    Boolean(input.statusLabel) ||
    Boolean(input.statusType) ||
    input.value !== null && input.value !== undefined;
  const noDecision = isNoDecisionOutcome(input.scorecardOutcomeType);
  if (!hasCrmContext && !noDecision) return null;

  const bucket = crmOutcomeBucketFromValue(input);
  return {
    closeLeadId: input.closeLeadId || null,
    closeOpportunityId: input.closeOpportunityId || null,
    pipelineName: input.pipelineName || null,
    statusLabel: input.statusLabel || null,
    statusType: input.statusType || null,
    value: input.value === null || input.value === undefined ? null : toNumber(input.value),
    valuePeriod: input.valuePeriod || null,
    won: Boolean(input.won || input.statusType === "won"),
    lost: Boolean(input.lost || input.statusType === "lost"),
    closeDate: input.closeDate ? toIsoString(input.closeDate).slice(0, 10) : null,
    bucket,
    noDecision
  };
}

function buildDimensionTrends(
  summaryRows: Array<{
    periodType: PeriodType;
    periodStart: string | Date;
    periodEnd: string | Date;
    dimensionAveragesJson: unknown;
  }>,
  fallbackScores: Record<RubricKey, number>
) {
  const periodTypes: PeriodType[] = ["daily", "weekly", "monthly", "quarterly"];
  const trends: Record<PeriodType, DimensionTrendPoint[]> = {
    daily: [],
    weekly: [],
    monthly: [],
    quarterly: []
  };

  for (const periodType of periodTypes) {
    const grouped = new Map<string, Array<Record<RubricKey, number>>>();
    for (const summary of summaryRows.filter((row) => row.periodType === periodType)) {
      const periodEnd = typeof summary.periodEnd === "string" ? summary.periodEnd : summary.periodEnd.toISOString().slice(0, 10);
      const values = grouped.get(periodEnd) || [];
      values.push(coerceScores(summary.dimensionAveragesJson, fallbackScores));
      grouped.set(periodEnd, values);
    }

    trends[periodType] = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([periodEnd, values]) => {
        const scores = Object.fromEntries(
          rubricKeys.map((key) => [key, values.reduce((sum, item) => sum + item[key], 0) / values.length])
        ) as Record<RubricKey, number>;
        return {
          label: formatTrendLabel(periodEnd),
          periodType,
          periodStart: periodEnd,
          periodEnd,
          scores
        };
      });

    if (!trends[periodType].length) {
      trends[periodType] = [
        {
          label: "Current",
          periodType,
          periodStart: "current",
          periodEnd: "current",
          scores: fallbackScores
        }
      ];
    }
  }

  return trends;
}

function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (((result as { rows?: T[] }).rows) || []) as T[];
  }
  return [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonNumber(source: Record<string, unknown>, key: string) {
  return toNumber(source[key]);
}

function jsonString(source: Record<string, unknown>, key: string) {
  return toNullableString(source[key]);
}

function feedbackMapKey(entityType: "scorecard" | "summary", entityId: string) {
  return `${entityType}:${entityId}`;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function looksLikeApiOrModelError(message: string | null | undefined) {
  return /(openai|openrouter|anthropic|model|api|rate limit|quota|timeout|gateway|fetch failed|provider|429|5\d\d|slack)/i.test(
    message || ""
  );
}

function emptyMonitoring(): PipelineMonitoring {
  return {
    openIncidents: 0,
    failedJobs: 0,
    failedSlackSends: 0,
    failedIngestionRuns: 0,
    modelApiErrors: 0,
    latestGradeRun: null,
    incidents: []
  };
}

function emptyDashboardData(currentUser: AppUser, monitoring: PipelineMonitoring, overrides: Partial<DashboardData> = {}): DashboardData {
  const scores = emptyScores();
  return {
    currentUser,
    reps: [],
    teamAverage: 0,
    totalCalls: 0,
    complianceFlags: 0,
    teamOpportunity: "No graded calls yet.",
    teamFocusDimensions: [],
    teamFocusRationale: "Import and grade calls to generate coaching focus areas.",
    categoryAverages: scores,
    teamOutcomes: emptyOutcomeSummary(),
    scoreTrend: [],
    dimensionTrends: {
      daily: [],
      weekly: [],
      monthly: [],
      quarterly: []
    },
    actions: [],
    targets: [],
    calls: [],
    summaries: [],
    reports: [],
    monitoring,
    feedbackStorageReady: false,
    feedbackStorageMessage: `Create public.${feedbackTableName} to persist scorecard and summary feedback.`,
    ...overrides
  };
}

function reportTitle(reportType: string) {
  return reportType.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportPreview(markdown: string | null) {
  if (!markdown) return null;
  const firstParagraph = markdown
    .replace(/^#+\s+/gm, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!firstParagraph) return null;
  return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 217)}...` : firstParagraph;
}

function parseManagerSessionNotes(value: string | null) {
  if (!value) return {} as Partial<ManagerSession>;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters : undefined,
      managerNote: typeof parsed.managerNote === "string" ? parsed.managerNote : undefined,
      suggestedFocusDimension: typeof parsed.suggestedFocusDimension === "string" ? (parsed.suggestedFocusDimension as RubricKey) : undefined,
      suggestedActionText: typeof parsed.suggestedActionText === "string" ? parsed.suggestedActionText : undefined,
      focusDecision: typeof parsed.focusDecision === "string" ? (parsed.focusDecision as ManagerFocusDecision) : undefined
    };
  } catch {
    return { managerNote: value };
  }
}

async function loadFeedbackByEntity(db: ReturnType<typeof getDb>, scorecardIds: string[], summaryIds: string[]) {
  const tableCheck = await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = ${feedbackTableName}
    ) as "exists"
  `);
  const tableExists = Boolean(rowsFromExecute<{ exists: boolean }>(tableCheck)[0]?.exists);

  if (!tableExists) {
    return {
      ready: false,
      message: `Create public.${feedbackTableName} to persist scorecard and summary feedback.`,
      byEntity: new Map<string, CoachingFeedback[]>()
    };
  }

  const filters: Array<ReturnType<typeof sql>> = [];
  if (scorecardIds.length) {
    filters.push(
      sql`(entity_type = 'scorecard' and entity_id in (${sql.join(scorecardIds.map((id) => sql`cast(${id} as uuid)`), sql`, `)}))`
    );
  }
  if (summaryIds.length) {
    filters.push(
      sql`(entity_type = 'summary' and entity_id in (${sql.join(summaryIds.map((id) => sql`cast(${id} as uuid)`), sql`, `)}))`
    );
  }

  if (!filters.length) {
    return {
      ready: true,
      message: undefined,
      byEntity: new Map<string, CoachingFeedback[]>()
    };
  }

  const feedbackRows = rowsFromExecute<{
    id: string;
    entityType: "scorecard" | "summary";
    entityId: string;
    actorUserId: string | null;
    actorName: string;
    actorRole: UserRole;
    usefulnessRating: number;
    feedbackText: string;
    createdAt: string | Date;
  }>(
    await db.execute(sql`
      select
        id::text as "id",
        entity_type as "entityType",
        entity_id::text as "entityId",
        actor_user_id::text as "actorUserId",
        actor_name as "actorName",
        actor_role as "actorRole",
        usefulness_rating as "usefulnessRating",
        feedback_text as "feedbackText",
        created_at as "createdAt"
      from ${feedbackTable}
      where ${sql.join(filters, sql` or `)}
      order by created_at desc
    `)
  );

  const byEntity = new Map<string, CoachingFeedback[]>();
  for (const row of feedbackRows) {
    const key = feedbackMapKey(row.entityType, row.entityId);
    const entries = byEntity.get(key) || [];
    entries.push({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      actorRole: row.actorRole,
      usefulnessRating: toNumber(row.usefulnessRating),
      feedbackText: row.feedbackText || "",
      createdAt: toIsoString(row.createdAt)
    });
    byEntity.set(key, entries);
  }

  return {
    ready: true,
    message: undefined,
    byEntity
  };
}

async function loadPipelineMonitoring(db: ReturnType<typeof getDb>, role: UserRole): Promise<PipelineMonitoring> {
  if (role === "rep") return emptyMonitoring();

  const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    recentPipelineRows,
    recentIngestionRows,
    recentDeliveryRows,
    failedJobCountRows,
    failedIngestionCountRows,
    failedSlackCountRows
  ] = await Promise.all([
    db
      .select({
        id: pipelineJobs.id,
        jobType: pipelineJobs.jobType,
        status: pipelineJobs.status,
        source: pipelineJobs.source,
        startedAt: pipelineJobs.startedAt,
        finishedAt: pipelineJobs.finishedAt,
        createdAt: pipelineJobs.createdAt,
        payloadJson: pipelineJobs.payloadJson,
        resultJson: pipelineJobs.resultJson,
        errorMessage: pipelineJobs.errorMessage
      })
      .from(pipelineJobs)
      .orderBy(desc(pipelineJobs.createdAt))
      .limit(12),
    db
      .select({
        id: ingestionRuns.id,
        source: ingestionRuns.source,
        runType: ingestionRuns.runType,
        provider: ingestionRuns.provider,
        modelName: ingestionRuns.modelName,
        startedAt: ingestionRuns.startedAt,
        finishedAt: ingestionRuns.finishedAt,
        status: ingestionRuns.status,
        callsSeen: ingestionRuns.callsSeen,
        callsImported: ingestionRuns.callsImported,
        callsGraded: ingestionRuns.callsGraded,
        errorMessage: ingestionRuns.errorMessage
      })
      .from(ingestionRuns)
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(12),
    db
      .select({
        id: deliveryEvents.id,
        status: deliveryEvents.status,
        audience: deliveryEvents.audience,
        destination: deliveryEvents.destination,
        errorMessage: deliveryEvents.errorMessage,
        createdAt: deliveryEvents.createdAt,
        sentAt: deliveryEvents.sentAt,
        reportType: reportArtifacts.reportType,
        periodType: reportArtifacts.periodType,
        periodStart: reportArtifacts.periodStart,
        periodEnd: reportArtifacts.periodEnd
      })
      .from(deliveryEvents)
      .leftJoin(reportArtifacts, eq(reportArtifacts.id, deliveryEvents.reportArtifactId))
      .where(eq(deliveryEvents.channel, "slack"))
      .orderBy(desc(deliveryEvents.createdAt))
      .limit(12),
    db
      .select({ count: sql<number>`count(*)` })
      .from(pipelineJobs)
      .where(and(eq(pipelineJobs.status, "failed"), gte(pipelineJobs.createdAt, recentSince))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.status, "failed"), gte(ingestionRuns.startedAt, recentSince))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(deliveryEvents)
      .where(and(eq(deliveryEvents.channel, "slack"), eq(deliveryEvents.status, "failed"), gte(deliveryEvents.createdAt, recentSince)))
  ]);

  const failedJobs = toNumber(failedJobCountRows[0]?.count);
  const failedIngestionRuns = toNumber(failedIngestionCountRows[0]?.count);
  const failedSlackSends = toNumber(failedSlackCountRows[0]?.count);
  const latestGradeJob = recentPipelineRows.find((row) => row.jobType === "grade_calls") || null;
  const latestGradePayload = asRecord(latestGradeJob?.payloadJson);
  const latestGradeWindow = asRecord(latestGradePayload.window);
  const latestGradeResult = asRecord(latestGradeJob?.resultJson);
  const salesFilteredCalls = jsonNumber(latestGradeResult, "sales_filtered_calls");
  const substantiveConnectedCalls = jsonNumber(latestGradeResult, "substantive_connected_calls");

  const latestGradeRun = latestGradeJob
    ? {
        status: latestGradeJob.status,
        occurredAt: toIsoString(latestGradeJob.finishedAt || latestGradeJob.startedAt || latestGradeJob.createdAt),
        provider: jsonString(latestGradePayload, "provider"),
        windowStart: jsonString(latestGradeWindow, "since"),
        windowEnd: jsonString(latestGradeWindow, "until"),
        pulledCalls: jsonNumber(latestGradeResult, "pulled_calls"),
        salesFilteredCalls,
        substantiveConnectedCalls,
        newlyGradedCalls: jsonNumber(latestGradeResult, "newly_graded_calls"),
        skippedAlreadyGraded: jsonNumber(latestGradeResult, "skipped_already_graded"),
        preGradeSkippedCalls: Math.max(0, salesFilteredCalls - substantiveConnectedCalls)
      }
    : null;

  const incidents: PipelineIncident[] = [];

  for (const row of recentPipelineRows.filter((item) => item.status === "failed")) {
    const payload = asRecord(row.payloadJson);
    const window = asRecord(payload.window);
    const message = row.errorMessage || `${row.jobType} failed without a stored error message.`;
    incidents.push({
      id: `pipeline-job-${row.id}`,
      source: "pipeline_job",
      severity: "critical",
      title: looksLikeApiOrModelError(row.errorMessage) ? `${row.jobType} failed with provider/API error` : `${row.jobType} failed`,
      detail: message,
      status: row.status,
      occurredAt: toIsoString(row.finishedAt || row.startedAt || row.createdAt),
      meta: [
        toNullableString(payload.provider) ? `Provider: ${payload.provider}` : null,
        toNullableString(window.since) && toNullableString(window.until) ? `Window: ${window.since} to ${window.until}` : null,
        row.source ? `Source: ${row.source}` : null
      ].filter((value): value is string => Boolean(value))
    });
  }

  for (const row of recentIngestionRows.filter((item) => item.status === "failed")) {
    const message = row.errorMessage || `${row.source} ingestion failed without a stored error message.`;
    incidents.push({
      id: `ingestion-run-${row.id}`,
      source: "ingestion_run",
      severity: looksLikeApiOrModelError(row.errorMessage) ? "critical" : "warning",
      title: looksLikeApiOrModelError(row.errorMessage) ? `${row.source} ingestion failed with provider/API error` : `${row.source} ingestion failed`,
      detail: message,
      status: row.status,
      occurredAt: toIsoString(row.finishedAt || row.startedAt),
      meta: [
        row.runType ? `Run type: ${row.runType}` : null,
        row.provider ? `Provider: ${row.provider}` : null,
        row.modelName ? `Model: ${row.modelName}` : null,
        `Seen/imported/graded: ${row.callsSeen}/${row.callsImported}/${row.callsGraded}`
      ].filter((value): value is string => Boolean(value))
    });
  }

  for (const row of recentDeliveryRows.filter((item) => item.status === "failed")) {
    incidents.push({
      id: `delivery-event-${row.id}`,
      source: "delivery_event",
      severity: "warning",
      title: "Slack send failed",
      detail: row.errorMessage || `Slack delivery to ${row.destination || "configured channel"} failed.`,
      status: row.status,
      occurredAt: toIsoString(row.sentAt || row.createdAt),
      meta: [
        row.reportType ? `Report: ${row.reportType}` : null,
        row.periodType ? `Period: ${row.periodType}${row.periodStart ? ` ${row.periodStart}${row.periodEnd && row.periodEnd !== row.periodStart ? ` to ${row.periodEnd}` : ""}` : ""}` : null,
        row.destination ? `Destination: ${row.destination}` : null,
        row.audience ? `Audience: ${row.audience}` : null
      ].filter((value): value is string => Boolean(value))
    });
  }

  if (latestGradeRun && (latestGradeRun.preGradeSkippedCalls > 0 || latestGradeRun.skippedAlreadyGraded > 0)) {
    incidents.push({
      id: `coverage-gap-${latestGradeRun.occurredAt}`,
      source: "coverage_gap",
      severity: latestGradeRun.preGradeSkippedCalls > 0 ? "warning" : "info",
      title: latestGradeRun.preGradeSkippedCalls > 0 ? "Calls skipped before grading" : "Substantive calls already graded",
      detail:
        latestGradeRun.preGradeSkippedCalls > 0
          ? `${latestGradeRun.preGradeSkippedCalls} sales-filtered calls did not become substantive graded calls in the latest window.`
          : `${latestGradeRun.skippedAlreadyGraded} substantive calls were skipped because they were already graded in the latest window.`,
      status: "observed",
      occurredAt: latestGradeRun.occurredAt,
      meta: [
        "Possible causes include missing transcripts, short duration, disconnected calls, or other non-substantive call states.",
        latestGradeRun.provider ? `Provider: ${latestGradeRun.provider}` : null,
        latestGradeRun.windowStart && latestGradeRun.windowEnd ? `Window: ${latestGradeRun.windowStart} to ${latestGradeRun.windowEnd}` : null
      ].filter((value): value is string => Boolean(value))
    });
  }

  const sortedIncidents = incidents
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 8);

  return {
    openIncidents: failedJobs + failedSlackSends + failedIngestionRuns + (latestGradeRun?.preGradeSkippedCalls ? 1 : 0),
    failedJobs,
    failedSlackSends,
    failedIngestionRuns,
    modelApiErrors: sortedIncidents.filter((incident) => incident.source !== "coverage_gap" && looksLikeApiOrModelError(incident.detail)).length,
    latestGradeRun,
    incidents: sortedIncidents
  };
}

export async function getCurrentAppUser(_preferredRole: "rep" | "manager" | "admin" = "manager"): Promise<AppUser | null> {
  if (!hasDatabase) return null;
  if (!isNeonAuthConfigured) return null;

  const { data: session } = await auth.getSession();
  const sessionUser = session?.user as SessionUser | undefined;
  if (!sessionUser?.email) return null;

  const db = getDb();
  const rows = await db
    .select()
    .from(appUsers)
    .where(and(eq(appUsers.email, sessionUser.email), eq(appUsers.active, true)))
    .limit(1);

  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    authUserId: rows[0].authUserId,
    email: rows[0].email,
    displayName: rows[0].displayName,
    role: rows[0].role,
    closeUserId: rows[0].closeUserId,
    active: rows[0].active
  };
}

async function getRepIdsForUser(user: AppUser) {
  if (user.role === "rep") return [user.id];
  const db = getDb();
  if (user.role === "admin") {
    const reps = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.role, "rep"), eq(appUsers.active, true)));
    return reps.map((rep) => rep.id);
  }

  const assignments = await db
    .select({ repUserId: managerRepAssignments.repUserId })
    .from(managerRepAssignments)
    .innerJoin(appUsers, eq(appUsers.id, managerRepAssignments.repUserId))
    .where(and(eq(managerRepAssignments.managerUserId, user.id), eq(appUsers.active, true)));

  return assignments.map((assignment) => assignment.repUserId);
}

export async function getDashboardData(options: {
  roleHint?: "rep" | "manager" | "admin";
  repId?: string;
} = {}): Promise<DashboardData | null> {
  if (!hasDatabase) return null;

  try {
    const currentUser = await getCurrentAppUser(options.roleHint || "manager");
    if (!currentUser) return null;
    if (options.roleHint === "admin" && currentUser.role !== "admin") return null;
    if (options.roleHint === "manager" && currentUser.role === "rep") return null;
    if (options.roleHint === "rep" && currentUser.role !== "rep" && currentUser.role !== "admin") return null;

    const db = getDb();
    const monitoring = await loadPipelineMonitoring(db, currentUser.role);
    const allowedRepIds = await getRepIdsForUser(currentUser);
    const allowedUuidRepIds = allowedRepIds.filter(isUuid);

    if (!allowedUuidRepIds.length) {
      return emptyDashboardData(currentUser, monitoring);
    }

    const allowedRepRows = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.role, "rep"), inArray(appUsers.id, allowedUuidRepIds)));

    const repRows = options.repId
      ? allowedRepRows.filter(
          (rep) => rep.id === options.repId || slug(rep.displayName) === options.repId || rep.closeUserId === options.repId
        )
      : allowedRepRows;
    const scopedRepIds = repRows.map((rep) => rep.id);

    if (!scopedRepIds.length) {
      return emptyDashboardData(currentUser, monitoring);
    }

    const scoreRows = await db
      .select({
        repId: calls.repUserId,
        repName: appUsers.displayName,
        callsGraded: sql<number>`count(${callScorecards.id})`,
        averageScore: sql<number>`avg(${callScorecards.overallScore})`,
        opening: sql<number>`avg(${callScorecards.openingScore})`,
        qualification: sql<number>`avg(${callScorecards.qualificationScore})`,
        discovery: sql<number>`avg(${callScorecards.discoveryScore})`,
        quantification: sql<number>`avg(${callScorecards.quantificationScore})`,
        solutionToPain: sql<number>`avg(${callScorecards.solutionToPainScore})`,
        featureDumpControl: sql<number>`avg(${callScorecards.featureDumpControlScore})`,
        closeOrNextStep: sql<number>`avg(${callScorecards.closeOrNextStepScore})`,
        compliance: sql<number>`avg(${callScorecards.complianceScore})`
      })
      .from(callScorecards)
      .innerJoin(calls, eq(calls.id, callScorecards.callId))
      .innerJoin(appUsers, eq(appUsers.id, calls.repUserId))
      .where(inArray(calls.repUserId, scopedRepIds))
      .groupBy(calls.repUserId, appUsers.displayName);

    const flagRows = await db
      .select({
        repId: calls.repUserId,
        flagCount: sql<number>`count(${complianceFlags.id})`
      })
      .from(complianceFlags)
      .innerJoin(callScorecards, eq(callScorecards.id, complianceFlags.callScorecardId))
      .innerJoin(calls, eq(calls.id, callScorecards.callId))
      .where(inArray(calls.repUserId, scopedRepIds))
      .groupBy(calls.repUserId);

    const repOutcomeRows = await db
      .select({
        repId: calls.repUserId,
        scorecardOutcomeType: callScorecards.outcomeType,
        closeLeadId: callOutcomes.closeLeadId,
        closeOpportunityId: callOutcomes.closeOpportunityId,
        pipelineName: callOutcomes.pipelineName,
        statusLabel: callOutcomes.statusLabel,
        statusType: callOutcomes.statusType,
        value: callOutcomes.value,
        valuePeriod: callOutcomes.valuePeriod,
        won: callOutcomes.won,
        lost: callOutcomes.lost,
        closeDate: callOutcomes.closeDate
      })
      .from(callScorecards)
      .innerJoin(calls, eq(calls.id, callScorecards.callId))
      .leftJoin(callOutcomes, eq(callOutcomes.callId, calls.id))
      .where(inArray(calls.repUserId, scopedRepIds));

    const flagsByRep = new Map(flagRows.map((row) => [row.repId, toNumber(row.flagCount)]));
    const scoreByRep = new Map(scoreRows.map((row) => [row.repId, row]));
    const outcomesByRep = new Map<string, OutcomeSummary>();
    for (const row of repOutcomeRows) {
      if (!row.repId) continue;
      const summary = outcomesByRep.get(row.repId) || emptyOutcomeSummary();
      summary.total += 1;
      const crmOutcome = buildCallCrmOutcome(row);
      if (crmOutcome?.bucket === "won") summary.won += 1;
      else if (crmOutcome?.bucket === "lost") summary.lost += 1;
      else if (crmOutcome?.bucket === "open") summary.open += 1;
      else summary.unknown += 1;
      if (crmOutcome?.noDecision) summary.noDecision += 1;
      outcomesByRep.set(row.repId, summary);
    }

    const reps: RepPerformance[] = repRows.map((rep) => {
      const scoresRow = scoreByRep.get(rep.id);
      const complianceFlagCount = flagsByRep.get(rep.id) || 0;
      const callsGraded = toNumber(scoresRow?.callsGraded);
      const outcomes = finalizeOutcomeSummary(outcomesByRep.get(rep.id) || emptyOutcomeSummary());
      const scores = {
        opening: toNumber(scoresRow?.opening),
        qualification: toNumber(scoresRow?.qualification),
        discovery: toNumber(scoresRow?.discovery),
        quantification: toNumber(scoresRow?.quantification),
        solution_to_pain: toNumber(scoresRow?.solutionToPain),
        feature_dump_control: toNumber(scoresRow?.featureDumpControl),
        close_or_next_step: toNumber(scoresRow?.closeOrNextStep),
        compliance: toNumber(scoresRow?.compliance)
      };
      const focus = chooseCoachingFocus(scores, complianceFlagCount, callsGraded);
      const weakestScore = weakestScoreDimension(scores);
      return {
        id: rep.id,
        name: rep.displayName,
        email: rep.email,
        closeUserId: rep.closeUserId,
        active: rep.active,
        calls: callsGraded,
        averageScore: toNumber(scoresRow?.averageScore),
        improvement: 0,
        complianceFlags: complianceFlagCount,
        primaryFocusDimension: focus.primaryDimension,
        primaryFocusDimensions: focus.dimensions,
        primaryFocus: focus.headline,
        nextCallFocus: focus.behavior,
        focusRationale: focus.rationale,
        weakestScoreDimension: weakestScore,
        weakestDimension: weakestScore,
        strongestDimension: strongestScoreDimension(scores),
        scores,
        outcomes
      };
    });

    const callRows = await db
      .select({
        id: calls.id,
        scorecardId: callScorecards.id,
        closeCallId: calls.closeCallId,
        repId: calls.repUserId,
        repName: appUsers.displayName,
        activityAt: calls.activityAt,
        durationSeconds: calls.durationSeconds,
        overallScore: callScorecards.overallScore,
        callType: callScorecards.callType,
        outcomeType: callScorecards.outcomeType,
        outcomeRationale: callScorecards.outcomeRationale,
        leadSegment: callScorecards.leadSegment,
        focusDimension: callScorecards.focusDimension,
        topStrength: callScorecards.topStrength,
        nextCallFocus: callScorecards.nextCallFocus,
        summary: callScorecards.evidenceSummaryJson,
        opening: callScorecards.openingScore,
        qualification: callScorecards.qualificationScore,
        discovery: callScorecards.discoveryScore,
        quantification: callScorecards.quantificationScore,
        solutionToPain: callScorecards.solutionToPainScore,
        featureDumpControl: callScorecards.featureDumpControlScore,
        closeOrNextStep: callScorecards.closeOrNextStepScore,
        compliance: callScorecards.complianceScore,
        closeLeadId: callOutcomes.closeLeadId,
        closeOpportunityId: callOutcomes.closeOpportunityId,
        pipelineName: callOutcomes.pipelineName,
        statusLabel: callOutcomes.statusLabel,
        statusType: callOutcomes.statusType,
        opportunityValue: callOutcomes.value,
        opportunityValuePeriod: callOutcomes.valuePeriod,
        opportunityWon: callOutcomes.won,
        opportunityLost: callOutcomes.lost,
        opportunityCloseDate: callOutcomes.closeDate
      })
      .from(callScorecards)
      .innerJoin(calls, eq(calls.id, callScorecards.callId))
      .innerJoin(appUsers, eq(appUsers.id, calls.repUserId))
      .leftJoin(callOutcomes, eq(callOutcomes.callId, calls.id))
      .where(inArray(calls.repUserId, scopedRepIds))
      .orderBy(desc(calls.activityAt))
      .limit(40);

    const callIds = callRows.map((call) => call.id);
    const flagDetails = callIds.length
      ? await db
          .select({ callId: calls.id, flag: complianceFlags.flag })
          .from(complianceFlags)
          .innerJoin(callScorecards, eq(callScorecards.id, complianceFlags.callScorecardId))
          .innerJoin(calls, eq(calls.id, callScorecards.callId))
          .where(inArray(calls.id, callIds))
      : [];
    const flagsByCall = new Map<string, string[]>();
    for (const flag of flagDetails) {
      const list = flagsByCall.get(flag.callId) || [];
      list.push(flag.flag);
      flagsByCall.set(flag.callId, list);
    }
    const reviewRows = callIds.length
      ? await db
          .select({ callId: callReviews.callId, reviewedAt: callReviews.reviewedAt })
          .from(callReviews)
          .where(and(inArray(callReviews.callId, callIds), eq(callReviews.status, "reviewed")))
      : [];
    const reviewsByCall = new Map(reviewRows.map((review) => [review.callId, review.reviewedAt]));

    const callsData: CallRow[] = callRows.map((call) => {
      const callComplianceFlags = flagsByCall.get(call.id) || [];
      const scores = {
        opening: toNumber(call.opening),
        qualification: toNumber(call.qualification),
        discovery: toNumber(call.discovery),
        quantification: toNumber(call.quantification),
        solution_to_pain: toNumber(call.solutionToPain),
        feature_dump_control: toNumber(call.featureDumpControl),
        close_or_next_step: toNumber(call.closeOrNextStep),
        compliance: toNumber(call.compliance)
      };
      const focus = chooseCoachingFocus(scores, callComplianceFlags.length, 1);
      const weakestScore = weakestScoreDimension(scores);
      const evidence = call.summary as
        | {
            concise_call_readout?: string;
            coachable_moment?: Record<string, unknown> | null;
            manager_action?: Record<string, unknown> | null;
            success_pattern?: Record<string, unknown> | null;
            rep_practice_drill?: string | null;
          }
        | null;
      const reviewedAt = reviewsByCall.get(call.id) || null;
      const crmOutcome = buildCallCrmOutcome({
        closeLeadId: call.closeLeadId,
        closeOpportunityId: call.closeOpportunityId,
        pipelineName: call.pipelineName,
        statusLabel: call.statusLabel,
        statusType: call.statusType,
        value: call.opportunityValue,
        valuePeriod: call.opportunityValuePeriod,
        won: call.opportunityWon,
        lost: call.opportunityLost,
        closeDate: call.opportunityCloseDate,
        scorecardOutcomeType: call.outcomeType
      });
      return {
        id: call.id,
        scorecardId: call.scorecardId,
        closeCallId: call.closeCallId,
        repId: call.repId || "",
        repName: call.repName,
        activityAt: call.activityAt.toISOString(),
        durationMinutes: Math.round((call.durationSeconds / 60) * 10) / 10,
        overallScore: toNumber(call.overallScore),
        callType: call.callType,
        outcomeType: call.outcomeType,
        outcomeRationale: call.outcomeRationale,
        leadSegment: call.leadSegment,
        primaryFocusDimension: (call.focusDimension as RubricKey | null) || focus.primaryDimension,
        primaryFocus: focus.headline,
        focusRationale: focus.rationale,
        weakestScoreDimension: weakestScore,
        weakestDimension: weakestScore,
        topStrength: call.topStrength,
        nextCallFocus: call.nextCallFocus || focus.behavior,
        complianceFlags: callComplianceFlags,
        reviewed: Boolean(reviewedAt),
        reviewedAt: reviewedAt?.toISOString() || null,
        summary: evidence?.concise_call_readout || "Concise call readout available after grading.",
        coachableMoment: evidence?.coachable_moment || null,
        managerAction: evidence?.manager_action || null,
        successPattern: evidence?.success_pattern || null,
        repPracticeDrill: evidence?.rep_practice_drill || null,
        crmOutcome,
        feedback: []
      };
    });

    const summaries = await db
      .select({
        id: coachingSummaries.id,
        repId: coachingSummaries.repUserId,
        repName: appUsers.displayName,
        periodType: coachingSummaries.periodType,
        periodStart: coachingSummaries.periodStart,
        periodEnd: coachingSummaries.periodEnd,
        callsGraded: coachingSummaries.callsGraded,
        averageScore: coachingSummaries.averageScore,
        dimensionAveragesJson: coachingSummaries.dimensionAveragesJson,
        weakestScoreDimension: coachingSummaries.weakestScoreDimension,
        primaryFocusDimension: coachingSummaries.primaryFocusDimension,
        focusRationale: coachingSummaries.focusRationale,
        primaryFocus: coachingSummaries.primaryFocus,
        nextCallFocus: coachingSummaries.nextCallFocus
      })
      .from(coachingSummaries)
      .innerJoin(appUsers, eq(appUsers.id, coachingSummaries.repUserId))
      .where(inArray(coachingSummaries.repUserId, scopedRepIds))
      .orderBy(desc(coachingSummaries.periodEnd))
      .limit(200);

    const sessionRows = await db
      .select({
        id: managerCoachingSessions.id,
        repId: managerCoachingSessions.repUserId,
        status: managerCoachingSessions.status,
        focusDimension: managerCoachingSessions.focusDimension,
        actionText: managerCoachingSessions.actionText,
        notes: managerCoachingSessions.notes,
        preparedAt: managerCoachingSessions.preparedAt,
        assignedAt: managerCoachingSessions.assignedAt,
        completedAt: managerCoachingSessions.completedAt,
        updatedAt: managerCoachingSessions.updatedAt,
        sessionDate: managerCoachingSessions.sessionDate
      })
      .from(managerCoachingSessions)
      .where(inArray(managerCoachingSessions.repUserId, scopedRepIds))
      .orderBy(desc(managerCoachingSessions.sessionDate), desc(managerCoachingSessions.updatedAt));

    const feedbackState = await loadFeedbackByEntity(
      db,
      callRows.map((call) => call.scorecardId),
      summaries.map((summary) => summary.id)
    );

    const actions = await db
      .select()
      .from(coachingActionItems)
      .where(and(inArray(coachingActionItems.repUserId, scopedRepIds), eq(coachingActionItems.status, "open")))
      .limit(20);

    const targetRows = await db
      .select({
        id: coachingTargets.id,
        repId: coachingTargets.repUserId,
        dimension: coachingTargets.dimension,
        targetScore: coachingTargets.targetScore,
        periodType: coachingTargets.periodType,
        periodStart: coachingTargets.periodStart,
        periodEnd: coachingTargets.periodEnd,
        status: coachingTargets.status
      })
      .from(coachingTargets)
      .where(and(inArray(coachingTargets.repUserId, scopedRepIds), eq(coachingTargets.status, "active")))
      .orderBy(desc(coachingTargets.periodEnd));

    const reports = await db
      .select({
        id: reportArtifacts.id,
        reportType: reportArtifacts.reportType,
        periodType: reportArtifacts.periodType,
        periodStart: reportArtifacts.periodStart,
        periodEnd: reportArtifacts.periodEnd,
        storagePath: reportArtifacts.storagePath,
        contentMarkdown: reportArtifacts.contentMarkdown,
        createdAt: reportArtifacts.createdAt,
        repUserId: reportArtifacts.repUserId,
        managerUserId: reportArtifacts.managerUserId,
        repName: appUsers.displayName
      })
      .from(reportArtifacts)
      .leftJoin(appUsers, eq(appUsers.id, reportArtifacts.repUserId))
      .orderBy(desc(reportArtifacts.createdAt))
      .limit(100);
    const scopedReports = reports
      .filter((report) => {
        if (currentUser.role === "admin") return true;
        if (currentUser.role === "rep") return report.repUserId === currentUser.id;
        if (report.repUserId) return scopedRepIds.includes(report.repUserId);
        return true;
      })
      .slice(0, 50);

    const sessionsByRep = new Map<string, ManagerSession>();
    for (const session of sessionRows) {
      if (sessionsByRep.has(session.repId)) continue;
      const metadata = parseManagerSessionNotes(session.notes);
      sessionsByRep.set(session.repId, {
        id: session.id,
        repId: session.repId,
        status: session.status,
        focusDimension: session.focusDimension ? (session.focusDimension as RubricKey) : undefined,
        actionText: session.actionText || undefined,
        whyItMatters: metadata.whyItMatters,
        managerNote: metadata.managerNote,
        suggestedFocusDimension: metadata.suggestedFocusDimension,
        suggestedActionText: metadata.suggestedActionText,
        focusDecision: metadata.focusDecision,
        preparedAt: session.preparedAt?.toISOString() || null,
        assignedAt: session.assignedAt?.toISOString() || null,
        completedAt: session.completedAt?.toISOString() || null,
        updatedAt: session.updatedAt?.toISOString() || null
      });
    }

    const repsWithSessions = reps.map((rep) => ({
      ...rep,
      managerSession: sessionsByRep.get(rep.id)
    }));

    const categoryAverages = Object.fromEntries(
      rubricKeys.map((key) => [
        key,
        repsWithSessions.length ? repsWithSessions.reduce((sum, rep) => sum + rep.scores[key], 0) / repsWithSessions.length : 0
      ])
    ) as Record<RubricKey, number>;

    const teamAverage = repsWithSessions.length
      ? repsWithSessions.reduce((sum, rep) => sum + rep.averageScore, 0) / repsWithSessions.length
      : 0;
    const teamOutcomes = sumOutcomeSummaries(repsWithSessions.map((rep) => rep.outcomes));
    const totalCalls = repsWithSessions.reduce((sum, rep) => sum + rep.calls, 0);
    const totalComplianceFlags = repsWithSessions.reduce((sum, rep) => sum + rep.complianceFlags, 0);
    const teamFocus = chooseCoachingFocus(categoryAverages, totalComplianceFlags, totalCalls);
    const dimensionTrends = buildDimensionTrends(summaries, categoryAverages);
    const targetData: CoachingTarget[] = targetRows.map((target) => ({
      id: target.id,
      repId: target.repId,
      dimension: target.dimension as RubricKey,
      targetScore: toNumber(target.targetScore),
      periodType: target.periodType,
      periodStart: target.periodStart,
      periodEnd: target.periodEnd,
      status: target.status
    }));
    return {
      currentUser,
      reps: repsWithSessions,
      teamAverage,
      totalCalls,
      complianceFlags: totalComplianceFlags,
      teamOpportunity: totalCalls ? teamFocus.headline : "No graded calls yet.",
      teamFocusDimensions: totalCalls ? teamFocus.dimensions : [],
      teamFocusRationale: totalCalls ? teamFocus.rationale : "Import and grade calls to generate coaching focus areas.",
      categoryAverages,
      teamOutcomes,
      dimensionTrends,
      scoreTrend: summaries.length ? buildScoreTrend(summaries, teamAverage) : [],
      monitoring,
      actions: actions.map((action) => ({
        id: action.id,
        repId: action.repUserId,
        dimension: action.dimension as RubricKey,
        actionText: action.actionText,
        whyItMatters: action.whyItMatters,
        status: action.status,
        completedAt: action.completedAt?.toISOString() || null
      })),
      targets: targetData,
      calls: callsData.map((call) => ({
        ...call,
        feedback: feedbackState.byEntity.get(feedbackMapKey("scorecard", call.scorecardId)) || []
      })),
      summaries: summaries.map(({ dimensionAveragesJson, ...summary }) => ({
        ...summary,
        averageScore: toNumber(summary.averageScore),
        dimensionAverages: coerceScores(dimensionAveragesJson, categoryAverages),
        weakestScoreDimension: summary.weakestScoreDimension ? (summary.weakestScoreDimension as RubricKey) : undefined,
        primaryFocusDimension: summary.primaryFocusDimension ? (summary.primaryFocusDimension as RubricKey) : undefined,
        focusRationale: summary.focusRationale || undefined,
        feedback: feedbackState.byEntity.get(feedbackMapKey("summary", summary.id)) || []
      })),
      reports: scopedReports.map((report) => ({
        id: report.id,
        title: reportTitle(report.reportType),
        reportType: report.reportType,
        periodType: report.periodType,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        owner: report.repName || "Team",
        storagePath: report.storagePath,
        contentPreview: reportPreview(report.contentMarkdown),
        createdAt: toIsoString(report.createdAt)
      })),
      feedbackStorageReady: feedbackState.ready,
      feedbackStorageMessage: feedbackState.message
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
