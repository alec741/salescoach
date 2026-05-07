import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auth, isNeonAuthConfigured } from "./auth/server";
import { getDb, hasDatabase } from "@/db/client";
import {
  appUsers,
  calls,
  callReviews,
  callScorecards,
  coachingActionItems,
  coachingSummaries,
  complianceFlags,
  managerRepAssignments,
  reportArtifacts
} from "@/db/schema";
import { chooseCoachingFocus, strongestScoreDimension, weakestScoreDimension } from "./coaching-focus";
import { getMockDashboardData } from "./mock-data";
import { rubricKeys, type AppUser, type CallRow, type DashboardData, type DimensionTrendPoint, type PeriodType, type RepPerformance, type RubricKey } from "./types";

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function formatTrendLabel(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
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

export async function getCurrentAppUser(preferredRole: "rep" | "manager" | "admin" = "manager"): Promise<AppUser | null> {
  if (!isNeonAuthConfigured || !hasDatabase) {
    return getMockDashboardData(preferredRole).currentUser;
  }

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
    const reps = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.role, "rep"));
    return reps.map((rep) => rep.id);
  }

  const assignments = await db
    .select({ repUserId: managerRepAssignments.repUserId })
    .from(managerRepAssignments)
    .where(eq(managerRepAssignments.managerUserId, user.id));

  return assignments.map((assignment) => assignment.repUserId);
}

export async function getDashboardData(options: {
  roleHint?: "rep" | "manager" | "admin";
  repId?: string;
} = {}): Promise<DashboardData | null> {
  if (!hasDatabase) return getMockDashboardData(options.roleHint || "manager", options.repId);

  try {
    const currentUser = await getCurrentAppUser(options.roleHint || "manager");
    if (!currentUser) return null;

    const db = getDb();
    const allowedRepIds = await getRepIdsForUser(currentUser);
    const scopedRepIds =
      options.repId && (currentUser.role === "admin" || allowedRepIds.includes(options.repId)) ? [options.repId] : allowedRepIds;

    if (!scopedRepIds.length) {
      return { ...getMockDashboardData(currentUser.role), currentUser, reps: [], calls: [], summaries: [], actions: [] };
    }

    const repRows = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.role, "rep"), inArray(appUsers.id, scopedRepIds)));

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

    const flagsByRep = new Map(flagRows.map((row) => [row.repId, toNumber(row.flagCount)]));
    const scoreByRep = new Map(scoreRows.map((row) => [row.repId, row]));

    const reps: RepPerformance[] = repRows.map((rep) => {
      const scoresRow = scoreByRep.get(rep.id);
      const complianceFlagCount = flagsByRep.get(rep.id) || 0;
      const callsGraded = toNumber(scoresRow?.callsGraded);
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
        scores
      };
    });

    if (!reps.some((rep) => rep.calls > 0)) return getMockDashboardData(currentUser.role, options.repId);

    const callRows = await db
      .select({
        id: calls.id,
        closeCallId: calls.closeCallId,
        repId: calls.repUserId,
        repName: appUsers.displayName,
        activityAt: calls.activityAt,
        durationSeconds: calls.durationSeconds,
        overallScore: callScorecards.overallScore,
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
        compliance: callScorecards.complianceScore
      })
      .from(callScorecards)
      .innerJoin(calls, eq(calls.id, callScorecards.callId))
      .innerJoin(appUsers, eq(appUsers.id, calls.repUserId))
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
      const evidence = call.summary as { concise_call_readout?: string } | null;
      const reviewedAt = reviewsByCall.get(call.id) || null;
      return {
        id: call.id,
        closeCallId: call.closeCallId,
        repId: call.repId || "",
        repName: call.repName,
        activityAt: call.activityAt.toISOString(),
        durationMinutes: Math.round((call.durationSeconds / 60) * 10) / 10,
        overallScore: toNumber(call.overallScore),
        primaryFocusDimension: focus.primaryDimension,
        primaryFocus: focus.headline,
        focusRationale: focus.rationale,
        weakestScoreDimension: weakestScore,
        weakestDimension: weakestScore,
        topStrength: call.topStrength,
        nextCallFocus: call.nextCallFocus || focus.behavior,
        complianceFlags: callComplianceFlags,
        reviewed: Boolean(reviewedAt),
        reviewedAt: reviewedAt?.toISOString() || null,
        summary: evidence?.concise_call_readout || "Concise call readout available after grading."
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

    const actions = await db
      .select()
      .from(coachingActionItems)
      .where(and(inArray(coachingActionItems.repUserId, scopedRepIds), eq(coachingActionItems.status, "open")))
      .limit(20);

    const reports = await db
      .select({
        id: reportArtifacts.id,
        reportType: reportArtifacts.reportType,
        periodType: reportArtifacts.periodType,
        periodStart: reportArtifacts.periodStart,
        periodEnd: reportArtifacts.periodEnd,
        storagePath: reportArtifacts.storagePath,
        repName: appUsers.displayName
      })
      .from(reportArtifacts)
      .leftJoin(appUsers, eq(appUsers.id, reportArtifacts.repUserId))
      .orderBy(desc(reportArtifacts.createdAt))
      .limit(50);

    const categoryAverages = Object.fromEntries(
      rubricKeys.map((key) => [key, reps.length ? reps.reduce((sum, rep) => sum + rep.scores[key], 0) / reps.length : 0])
    ) as Record<RubricKey, number>;

    const teamAverage = reps.length ? reps.reduce((sum, rep) => sum + rep.averageScore, 0) / reps.length : 0;
    const totalCalls = reps.reduce((sum, rep) => sum + rep.calls, 0);
    const totalComplianceFlags = reps.reduce((sum, rep) => sum + rep.complianceFlags, 0);
    const teamFocus = chooseCoachingFocus(categoryAverages, totalComplianceFlags, totalCalls);
    const dimensionTrends = buildDimensionTrends(summaries, categoryAverages);
    return {
      currentUser,
      reps,
      teamAverage,
      totalCalls,
      complianceFlags: totalComplianceFlags,
      teamOpportunity: teamFocus.headline,
      teamFocusDimensions: teamFocus.dimensions,
      teamFocusRationale: teamFocus.rationale,
      categoryAverages,
      dimensionTrends,
      scoreTrend: buildScoreTrend(summaries, teamAverage),
      actions: actions.map((action) => ({
        id: action.id,
        repId: action.repUserId,
        dimension: action.dimension as RubricKey,
        actionText: action.actionText,
        whyItMatters: action.whyItMatters,
        status: action.status
      })),
      calls: callsData,
      summaries: summaries.map(({ dimensionAveragesJson, ...summary }) => ({
        ...summary,
        averageScore: toNumber(summary.averageScore),
        dimensionAverages: coerceScores(dimensionAveragesJson, categoryAverages),
        weakestScoreDimension: summary.weakestScoreDimension ? (summary.weakestScoreDimension as RubricKey) : undefined,
        primaryFocusDimension: summary.primaryFocusDimension ? (summary.primaryFocusDimension as RubricKey) : undefined,
        focusRationale: summary.focusRationale || undefined
      })),
      reports: reports.map((report) => ({
        id: report.id,
        title: report.reportType.replace(/_/g, " "),
        reportType: report.reportType,
        periodType: report.periodType,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        owner: report.repName || "Team",
        storagePath: report.storagePath
      }))
    };
  } catch (error) {
    console.error(error);
    return getMockDashboardData(options.roleHint || "manager", options.repId);
  }
}
