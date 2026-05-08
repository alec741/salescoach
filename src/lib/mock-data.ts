import fs from "node:fs";
import path from "node:path";
import { chooseCoachingFocus, strongestScoreDimension, weakestScoreDimension } from "./coaching-focus";
import { type CallRow, type CoachingAction, type CoachingSummary, type DashboardData, type PeriodType, type RepPerformance, type RubricKey } from "./types";

const ROOT = process.cwd();

type AggregateFile = {
  date: string;
  total_calls: number;
  average_overall_score: number;
  average_scores: Record<RubricKey, number>;
  compliance_flag_count: number;
  highest_leverage_coaching_behavior: string;
  by_rep: Array<{
    rep_name: string;
    calls: number;
    average_overall: number;
    average_scores: Record<RubricKey, number>;
    compliance_flag_count: number;
  }>;
};

type RawScorecard = {
  call_id?: string;
  rep_name?: string;
  activity_at?: string;
  duration_minutes?: number;
  call_type?: string;
  overall_score?: number;
  scores?: Record<RubricKey, number>;
  top_strength?: string;
  next_call_focus?: string;
  compliance_flags?: unknown;
  evidence_summary?: {
    concise_call_readout?: string;
  };
};

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function readJsonl(filePath: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildOutcomeSummary(input: Pick<RepPerformance["outcomes"], "won" | "lost" | "open" | "noDecision" | "unknown" | "total">) {
  const closed = input.won + input.lost;
  return {
    ...input,
    closed,
    winRate: closed ? input.won / closed : 0
  };
}

function fallbackAggregate(): AggregateFile {
  const scores = {
    opening: 6.5,
    qualification: 7.1,
    discovery: 6.6,
    quantification: 5.8,
    solution_to_pain: 6.9,
    feature_dump_control: 5.7,
    close_or_next_step: 5.9,
    compliance: 5.8
  };
  return {
    date: "2026-05-06",
    total_calls: 36,
    average_overall_score: 6.3,
    average_scores: scores,
    compliance_flag_count: 60,
    highest_leverage_coaching_behavior:
      "Quantify the specific lost-job or margin math before presenting plan tiers, rates, promotions, or platform walkthroughs.",
    by_rep: ["Bryton Fernandez", "Chris Mitchell", "Janay Chirico", "Jen Miracle", "Josh Hrinda"].map((repName, index) => ({
      rep_name: repName,
      calls: [7, 3, 5, 2, 5][index],
      average_overall: [6.4, 5.3, 5.5, 7.9, 6.5][index],
      average_scores: scores,
      compliance_flag_count: [13, 7, 10, 3, 5][index]
    }))
  };
}

export function getMockDashboardData(role: "rep" | "manager" | "admin" = "manager", repId?: string): DashboardData {
  const aggregatePath = path.join(ROOT, "reports", "daily", "2026-05-06", "codex-over-10min", "daily-aggregates.json");
  const aggregate = readJson<AggregateFile>(aggregatePath, fallbackAggregate());

  const reps: RepPerformance[] = aggregate.by_rep.map((rep, index) => {
    const id = slug(rep.rep_name);
    const focus = chooseCoachingFocus(rep.average_scores, rep.compliance_flag_count, rep.calls);
    const weakestScore = weakestScoreDimension(rep.average_scores);
    const won = Math.max(0, Math.floor(rep.calls / 3) - (index % 2));
    const lost = Math.max(0, Math.floor(rep.calls / 4));
    const open = Math.max(0, rep.calls - won - lost);
    const noDecision = Math.min(rep.calls, (index % 3) + (rep.calls > 4 ? 1 : 0));
    return {
      id,
      name: rep.rep_name,
      email: `${id}@enhancify.example`,
      closeUserId: null,
      active: true,
      calls: rep.calls,
      averageScore: rep.average_overall,
      improvement: Number((0.2 + ((index % 4) - 1) * 0.18).toFixed(1)),
      complianceFlags: rep.compliance_flag_count,
      primaryFocusDimension: focus.primaryDimension,
      primaryFocusDimensions: focus.dimensions,
      primaryFocus: focus.headline,
      nextCallFocus: focus.behavior,
      focusRationale: focus.rationale,
      weakestScoreDimension: weakestScore,
      weakestDimension: weakestScore,
      strongestDimension: strongestScoreDimension(rep.average_scores),
      scores: rep.average_scores,
      outcomes: buildOutcomeSummary({
        won,
        lost,
        open,
        noDecision,
        unknown: 0,
        total: rep.calls
      })
    };
  });

  const selectedRep = reps.find((rep) => rep.id === repId) || reps[0];
  const currentUser = {
    id: role === "rep" ? selectedRep.id : "manager-demo",
    authUserId: null,
    email: role === "rep" ? selectedRep.email : "manager@enhancify.example",
    displayName: role === "rep" ? selectedRep.name : "Sales Manager",
    role,
    closeUserId: null,
    active: true
  };

  const scorecardsPath = path.join(ROOT, "data", "coach", "codex-review", "2026-05-06-over-10min", "codex-scorecards.jsonl");
  const rawScorecards = readJsonl(scorecardsPath);
  const calls: CallRow[] = rawScorecards.slice(0, 32).map((rawRow, index) => {
    const row = rawRow as RawScorecard;
    const repName = row.rep_name || reps[index % reps.length]?.name || "Unknown Rep";
    const scores = (row.scores || aggregate.average_scores) as Record<RubricKey, number>;
    const complianceFlagList = Array.isArray(row.compliance_flags) ? row.compliance_flags.map(String) : [];
    const focus = chooseCoachingFocus(scores, complianceFlagList.length, 1);
    const weakestScore = weakestScoreDimension(scores);
    const outcomePattern = index % 5;
    const crmOutcome =
      outcomePattern === 0
        ? {
            closeLeadId: `lead-${index + 1}`,
            closeOpportunityId: `opp-${index + 1}`,
            pipelineName: "Sales",
            statusLabel: "Won",
            statusType: "won",
            value: 18000 + index * 750,
            valuePeriod: "one_time",
            won: true,
            lost: false,
            closeDate: aggregate.date,
            bucket: "won" as const,
            noDecision: false
          }
        : outcomePattern === 1
          ? {
              closeLeadId: `lead-${index + 1}`,
              closeOpportunityId: `opp-${index + 1}`,
              pipelineName: "Sales",
              statusLabel: "Lost",
              statusType: "lost",
              value: 14000 + index * 600,
              valuePeriod: "one_time",
              won: false,
              lost: true,
              closeDate: aggregate.date,
              bucket: "lost" as const,
              noDecision: false
            }
          : outcomePattern === 2
            ? {
                closeLeadId: `lead-${index + 1}`,
                closeOpportunityId: `opp-${index + 1}`,
                pipelineName: "Sales",
                statusLabel: "Open",
                statusType: "active",
                value: 22000 + index * 500,
                valuePeriod: "one_time",
                won: false,
                lost: false,
                closeDate: null,
                bucket: "open" as const,
                noDecision: false
              }
            : outcomePattern === 3
              ? {
                  closeLeadId: `lead-${index + 1}`,
                  closeOpportunityId: `opp-${index + 1}`,
                  pipelineName: "Sales",
                  statusLabel: "Open",
                  statusType: "active",
                  value: 12000 + index * 450,
                  valuePeriod: "one_time",
                  won: false,
                  lost: false,
                  closeDate: null,
                  bucket: "open" as const,
                  noDecision: true
                }
              : null;
    return {
      id: row.call_id || `call-${index + 1}`,
      scorecardId: row.call_id || `scorecard-${index + 1}`,
      closeCallId: row.call_id || `call-${index + 1}`,
      repId: slug(repName),
      repName,
      activityAt: row.activity_at || `${aggregate.date}T15:${String(index).padStart(2, "0")}:00.000Z`,
      durationMinutes: Number(row.duration_minutes || 12 + (index % 8)),
      overallScore: Number(row.overall_score || 6),
      primaryFocusDimension: focus.primaryDimension,
      primaryFocus: focus.headline,
      focusRationale: focus.rationale,
      weakestScoreDimension: weakestScore,
      weakestDimension: weakestScore,
      callType: row.call_type || (index % 2 ? "discovery" : "closing"),
      outcomeType: outcomePattern === 3 ? "no_decision_due_to_missing_pain" : outcomePattern === 0 ? "won_with_strong_process" : outcomePattern === 1 ? "lost_because_of_weak_process" : "advanced_with_risk",
      leadSegment: index % 2 ? "Contractor A" : "Contractor B",
      topStrength: row.top_strength || "Keeps qualification clear and structured.",
      nextCallFocus: row.next_call_focus || focus.behavior,
      complianceFlags: complianceFlagList,
      reviewed: Number(row.overall_score || 6) >= 6.5 && complianceFlagList.length <= 1,
      reviewedAt: null,
      summary: row.evidence_summary?.concise_call_readout || "Concise call readout available after grading.",
      crmOutcome,
      feedback: []
    };
  });

  const scopedCalls = role === "rep" ? calls.filter((call) => call.repId === selectedRep.id) : calls;
  const scopedReps = role === "rep" ? [selectedRep] : reps;
  const scopedCategoryAverages = role === "rep" ? selectedRep.scores : aggregate.average_scores;
  const scopedAverage = role === "rep" ? selectedRep.averageScore : aggregate.average_overall_score;
  const teamFocus = chooseCoachingFocus(
    scopedCategoryAverages,
    role === "rep" ? selectedRep.complianceFlags : aggregate.compliance_flag_count,
    role === "rep" ? selectedRep.calls : aggregate.total_calls
  );
  const actions: CoachingAction[] = scopedReps.slice(0, 6).map((rep) => ({
    id: `action-${rep.id}`,
    repId: rep.id,
    dimension: rep.primaryFocusDimension,
    actionText: rep.nextCallFocus,
    whyItMatters: rep.focusRationale,
    status: "open"
  }));

  const summaries: CoachingSummary[] = scopedReps.flatMap((rep) =>
    (["daily", "weekly", "monthly"] as const).map((periodType, index) => ({
      id: `${rep.id}-${periodType}`,
      repId: rep.id,
      repName: rep.name,
      periodType,
      periodStart: index === 0 ? aggregate.date : index === 1 ? "2026-05-04" : "2026-05-01",
      periodEnd: aggregate.date,
      callsGraded: rep.calls,
      averageScore: rep.averageScore,
      dimensionAverages: rep.scores,
      primaryFocus: rep.primaryFocus,
      primaryFocusDimension: rep.primaryFocusDimension,
      focusRationale: rep.focusRationale,
      nextCallFocus: rep.nextCallFocus,
      feedback: []
    }))
  );
  const dimensionTrends = (["daily", "weekly", "monthly", "quarterly"] as PeriodType[]).reduce(
    (acc, periodType) => ({
      ...acc,
      [periodType]: [
        {
          label: "Current",
          periodType,
          periodStart: aggregate.date,
          periodEnd: aggregate.date,
          scores: scopedCategoryAverages
        }
      ]
    }),
    {} as DashboardData["dimensionTrends"]
  );
  const teamOutcomes = buildOutcomeSummary(
    scopedReps.reduce(
      (acc, rep) => ({
        won: acc.won + rep.outcomes.won,
        lost: acc.lost + rep.outcomes.lost,
        open: acc.open + rep.outcomes.open,
        noDecision: acc.noDecision + rep.outcomes.noDecision,
        unknown: acc.unknown + rep.outcomes.unknown,
        total: acc.total + rep.outcomes.total
      }),
      { won: 0, lost: 0, open: 0, noDecision: 0, unknown: 0, total: 0 }
    )
  );

  return {
    currentUser,
    reps: scopedReps,
    teamAverage: scopedAverage,
    totalCalls: role === "rep" ? scopedCalls.length : aggregate.total_calls,
    complianceFlags: role === "rep" ? selectedRep.complianceFlags : aggregate.compliance_flag_count,
    teamOpportunity: teamFocus.headline,
    teamFocusDimensions: teamFocus.dimensions,
    teamFocusRationale: teamFocus.rationale,
    categoryAverages: scopedCategoryAverages,
    teamOutcomes,
    dimensionTrends,
    scoreTrend: [
      { label: "Apr 1", score: 5.6 },
      { label: "Apr 8", score: 5.8 },
      { label: "Apr 15", score: 6.0 },
      { label: "Apr 22", score: 6.1 },
      { label: "Apr 29", score: 6.3 },
      { label: "May 6", score: scopedAverage }
    ],
    actions,
    calls: scopedCalls,
    summaries,
    reports: [
      {
        id: "daily-manager",
        title: "Manager Daily Coaching Brief",
        reportType: "manager_summary",
        periodType: "daily",
        periodStart: aggregate.date,
        periodEnd: aggregate.date,
        owner: "Sales Manager",
        storagePath: "output/pdf/daily/2026-05-06/codex-over-10min/manager-summary.pdf"
      },
      {
        id: "daily-packet",
        title: "Daily Coaching Packet",
        reportType: "coaching_packet",
        periodType: "daily",
        periodStart: aggregate.date,
        periodEnd: aggregate.date,
        owner: "Team",
        storagePath: "output/pdf/daily/2026-05-06/codex-over-10min/daily-coaching-packet.pdf"
      }
    ],
    monitoring: {
      openIncidents: 0,
      failedJobs: 0,
      failedSlackSends: 0,
      failedIngestionRuns: 0,
      modelApiErrors: 0,
      latestGradeRun: {
        status: "succeeded",
        occurredAt: `${aggregate.date}T18:00:00.000Z`,
        provider: "openrouter",
        windowStart: `${aggregate.date}T17:15:00.000Z`,
        windowEnd: `${aggregate.date}T18:00:00.000Z`,
        pulledCalls: aggregate.total_calls,
        salesFilteredCalls: aggregate.total_calls,
        substantiveConnectedCalls: aggregate.total_calls - 4,
        newlyGradedCalls: aggregate.total_calls - 6,
        skippedAlreadyGraded: 2,
        preGradeSkippedCalls: 4
      },
      incidents: [
        {
          id: "coverage-gap-demo",
          source: "coverage_gap",
          severity: "warning",
          title: "Calls skipped before grading",
          detail: "4 sales-filtered calls did not become substantive graded calls in the latest pass.",
          status: "observed",
          occurredAt: `${aggregate.date}T18:00:00.000Z`,
          meta: ["Possible causes: missing transcript, short duration, or disconnected calls.", "Provider: openrouter"]
        }
      ]
    },
    feedbackStorageReady: false,
    feedbackStorageMessage: "DATABASE_URL is not configured, so scorecard and summary feedback are read-only."
  };
}
