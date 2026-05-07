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
      scores: rep.average_scores
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
    return {
      id: row.call_id || `call-${index + 1}`,
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
      topStrength: row.top_strength || "Keeps qualification clear and structured.",
      nextCallFocus: row.next_call_focus || focus.behavior,
      complianceFlags: complianceFlagList,
      reviewed: Number(row.overall_score || 6) >= 6.5 && complianceFlagList.length <= 1,
      reviewedAt: null,
      summary: row.evidence_summary?.concise_call_readout || "Concise call readout available after grading."
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
      primaryFocus: rep.primaryFocus,
      primaryFocusDimension: rep.primaryFocusDimension,
      focusRationale: rep.focusRationale,
      nextCallFocus: rep.nextCallFocus
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
    ]
  };
}
