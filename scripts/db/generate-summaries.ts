import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, calls, callScorecards, coachingActionItems, coachingSummaries, reportArtifacts } from "../../src/db/schema";
import { rubricKeys, type PeriodType, type RubricKey } from "../../src/lib/types";
import { writeCoachingSummary } from "../coach/summary-writer";

const themes: Record<RubricKey, string> = {
  opening: "Set a cleaner opening agenda before discovery.",
  qualification: "Tighten ICP and Contractor A/B qualification before solutioning.",
  discovery: "Diagnose current process, desired outcome, and status-quo consequence before product explanation.",
  quantification: "Quantify the financing gap before presenting Enhancify.",
  solution_to_pain: "Turn diagnosed pain into one concise solution narrative.",
  feature_dump_control: "Reduce product detail with shorter confirmation loops.",
  close_or_next_step: "Convert diagnosed pain into a clear decision or calendar-controlled next step.",
  compliance: "Tighten high-risk financing expectation language immediately."
};

const sellingSequence: RubricKey[] = [
  "qualification",
  "quantification",
  "discovery",
  "solution_to_pain",
  "close_or_next_step",
  "feature_dump_control",
  "opening"
];

const leverageWeights: Partial<Record<RubricKey, number>> = {
  qualification: 1.25,
  quantification: 1.25,
  discovery: 1.15,
  solution_to_pain: 1.1,
  close_or_next_step: 1,
  feature_dump_control: 0.85,
  opening: 0.8
};

const nextBehaviors: Record<RubricKey, string> = {
  opening: "Open with the inbound reason, confirm owner/decision-maker status, and earn permission to ask fit questions before explaining product.",
  qualification: "By minute 5, identify whether the buyer is no-financing, dealer-fee financing, adjacent, or poor-fit before explaining Enhancify.",
  discovery: "Ask current situation, desired situation, and consequence questions before describing how the platform works.",
  quantification: "Ask one math question before solutioning: out of 10 estimates, how many stall because of price or financing, and what is that worth per month?",
  solution_to_pain: "Before each product point, name the exact pain it solves and confirm the buyer sees the connection.",
  feature_dump_control: "After each relevant product point, pause and ask whether that fits their sales process instead of continuing the explanation.",
  close_or_next_step: "End with a direct close ask or a dated next step tied to the decision maker, decision criteria, and timing.",
  compliance: "Use approved language on marketplace status, soft pull, final lender approval, hard inquiry, customer-received funds, and no guaranteed rates, approvals, amounts, or timelines."
};

function parseArgs() {
  const args = process.argv.slice(2);
  const dateIndex = args.indexOf("--date");
  const periodIndex = args.indexOf("--period");
  return {
    date: dateIndex >= 0 ? args[dateIndex + 1] : new Date().toISOString().slice(0, 10),
    period: periodIndex >= 0 ? args[periodIndex + 1] : "daily",
    llm: args.includes("--llm") || process.env.COACH_SUMMARY_PROVIDER === "openrouter"
  };
}

function average(values: number[]) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function weakest(scores: Record<RubricKey, number>) {
  return rubricKeys.reduce((min, key) => (scores[key] < scores[min] ? key : min), rubricKeys[0]);
}

function strongest(scores: Record<RubricKey, number>) {
  return rubricKeys.reduce((max, key) => (scores[key] > scores[max] ? key : max), rubricKeys[0]);
}

function leverageDeficit(scores: Record<RubricKey, number>, key: RubricKey) {
  return Math.max(0, 8 - scores[key]) * (leverageWeights[key] ?? 1);
}

function chooseFocus(scores: Record<RubricKey, number>) {
  if (scores.compliance <= 5.5) {
    return {
      dimension: "compliance" as RubricKey,
      focus: themes.compliance,
      behavior: nextBehaviors.compliance,
      rationale: "Compliance is the coaching focus because the score indicates material financing-language risk."
    };
  }

  const dimension = [...sellingSequence].sort((a, b) => {
    const gap = leverageDeficit(scores, b) - leverageDeficit(scores, a);
    return gap || sellingSequence.indexOf(a) - sellingSequence.indexOf(b);
  })[0] ?? "quantification";

  return {
    dimension,
    focus: themes[dimension],
    behavior: nextBehaviors[dimension],
    rationale:
      "Primary focus selected by Decoded leverage: upstream selling behaviors beat compliance watchouts unless compliance risk is severe."
  };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function periodRange(anchor: string, periodType: PeriodType) {
  const date = new Date(`${anchor}T00:00:00.000Z`);
  if (periodType === "daily") {
    return { periodStart: anchor, periodEnd: anchor };
  }

  if (periodType === "weekly") {
    const day = date.getUTCDay() || 7;
    const start = addDays(date, 1 - day);
    const end = addDays(start, 6);
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  if (periodType === "monthly") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0));
  return { periodStart: isoDate(start), periodEnd: isoDate(end) };
}

function previousPeriodRange(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -days + 1);
  return { periodStart: isoDate(previousStart), periodEnd: isoDate(previousEnd) };
}

function selectedPeriods(period: string): PeriodType[] {
  if (period === "all") return ["daily", "weekly", "monthly", "quarterly"];
  if (["daily", "weekly", "monthly", "quarterly"].includes(period)) return [period as PeriodType];
  throw new Error(`Unsupported period: ${period}. Use daily, weekly, monthly, quarterly, or all.`);
}

export type GenerateSummariesOptions = {
  date?: string;
  period?: string;
  llm?: boolean;
};

export type GenerateSummariesResult = {
  ok: true;
  date: string;
  period: string;
  summaries: number;
  artifacts: number;
};

type SummaryArtifactInput = {
  reportType: "rep_summary" | "manager_summary";
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  repUserId?: string | null;
  managerUserId?: string | null;
  contentMarkdown: string;
};

async function upsertSummaryArtifact(input: SummaryArtifactInput) {
  const db = getDb();
  const conditions = [
    eq(reportArtifacts.reportType, input.reportType),
    eq(reportArtifacts.periodType, input.periodType),
    eq(reportArtifacts.periodStart, input.periodStart),
    eq(reportArtifacts.periodEnd, input.periodEnd),
    input.repUserId ? eq(reportArtifacts.repUserId, input.repUserId) : isNull(reportArtifacts.repUserId),
    input.managerUserId ? eq(reportArtifacts.managerUserId, input.managerUserId) : isNull(reportArtifacts.managerUserId)
  ];

  const values = {
    reportType: input.reportType,
    periodType: input.periodType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    repUserId: input.repUserId || null,
    managerUserId: input.managerUserId || null,
    storagePath: null,
    contentMarkdown: input.contentMarkdown
  };

  const existing = await db
    .select({ id: reportArtifacts.id })
    .from(reportArtifacts)
    .where(and(...conditions))
    .limit(1);

  if (existing[0]) {
    await db.update(reportArtifacts).set(values).where(eq(reportArtifacts.id, existing[0].id));
    return;
  }

  await db.insert(reportArtifacts).values(values);
}

function dimensionLines(scores: Record<RubricKey, number>) {
  return rubricKeys.map((key) => `- ${key}: ${scores[key]}/10`).join("\n");
}

function buildRepSummaryMarkdown(input: {
  titlePeriod: string;
  repName: string;
  periodStart: string;
  periodEnd: string;
  callsGraded: number;
  averageScore: number;
  dimensionAverages: Record<RubricKey, number>;
  strongestDimension: RubricKey;
  weakestScoreDimension: RubricKey;
  focus: ReturnType<typeof chooseFocus>;
}) {
  return `# ${input.titlePeriod} Coaching Summary - ${input.repName}

Period: ${input.periodStart} to ${input.periodEnd}
Calls graded: ${input.callsGraded}
Average score: ${input.averageScore}/10

## Highest-Leverage Focus

${input.focus.focus}

## Why This Matters

${input.focus.rationale}

## Next-Call Behavior

${input.focus.behavior}

## Score Pattern

Strongest dimension: ${input.strongestDimension}
Lowest score dimension: ${input.weakestScoreDimension}

${dimensionLines(input.dimensionAverages)}
`;
}

function buildManagerSummaryMarkdown(input: {
  titlePeriod: string;
  periodStart: string;
  periodEnd: string;
  repSummaries: Array<{
    repName: string;
    callsGraded: number;
    averageScore: number;
    primaryFocus: string;
    nextCallFocus: string;
    weakestScoreDimension: RubricKey;
    strongestDimension: RubricKey;
  }>;
}) {
  const totalCalls = input.repSummaries.reduce((sum, rep) => sum + rep.callsGraded, 0);
  const teamAverage = round1(average(input.repSummaries.map((rep) => rep.averageScore)));
  const sorted = [...input.repSummaries].sort((a, b) => a.repName.localeCompare(b.repName));

  return `# ${input.titlePeriod} Manager Coaching Summary

Period: ${input.periodStart} to ${input.periodEnd}
Reps reviewed: ${sorted.length}
Calls graded: ${totalCalls}
Team average score: ${teamAverage}/10

## Manager Priorities

${sorted.map((rep) => `### ${rep.repName}

Calls graded: ${rep.callsGraded}
Average score: ${rep.averageScore}/10
Strength: ${rep.strongestDimension}
Lowest score: ${rep.weakestScoreDimension}
Primary coaching focus: ${rep.primaryFocus}
Next manager coaching move: ${rep.nextCallFocus}
`).join("\n")}`;
}

async function getPreviousRepContext(repId: string, periodType: PeriodType, periodStart: string, periodEnd: string) {
  const db = getDb();
  const previous = previousPeriodRange(periodStart, periodEnd);
  const rows = await db
    .select({
      callsGraded: coachingSummaries.callsGraded,
      averageScore: coachingSummaries.averageScore,
      primaryFocusDimension: coachingSummaries.primaryFocusDimension,
      primaryFocus: coachingSummaries.primaryFocus,
      nextCallFocus: coachingSummaries.nextCallFocus,
      focusRationale: coachingSummaries.focusRationale,
      dimensionAveragesJson: coachingSummaries.dimensionAveragesJson
    })
    .from(coachingSummaries)
    .where(
      and(
        eq(coachingSummaries.repUserId, repId),
        eq(coachingSummaries.periodType, periodType),
        eq(coachingSummaries.periodStart, previous.periodStart),
        eq(coachingSummaries.periodEnd, previous.periodEnd)
      )
    )
    .limit(1);

  return rows[0]
    ? {
        period_start: previous.periodStart,
        period_end: previous.periodEnd,
        calls_graded: rows[0].callsGraded,
        average_score: Number(rows[0].averageScore),
        primary_focus_dimension: rows[0].primaryFocusDimension,
        primary_focus: rows[0].primaryFocus,
        next_call_focus: rows[0].nextCallFocus,
        focus_rationale: rows[0].focusRationale,
        dimension_averages: rows[0].dimensionAveragesJson
      }
    : null;
}

async function getPreviousManagerContext(periodType: PeriodType, periodStart: string, periodEnd: string) {
  const db = getDb();
  const previous = previousPeriodRange(periodStart, periodEnd);
  const rows = await db
    .select({
      repName: appUsers.displayName,
      callsGraded: coachingSummaries.callsGraded,
      averageScore: coachingSummaries.averageScore,
      primaryFocusDimension: coachingSummaries.primaryFocusDimension,
      primaryFocus: coachingSummaries.primaryFocus,
      dimensionAveragesJson: coachingSummaries.dimensionAveragesJson
    })
    .from(coachingSummaries)
    .innerJoin(appUsers, eq(appUsers.id, coachingSummaries.repUserId))
    .where(
      and(
        eq(coachingSummaries.periodType, periodType),
        eq(coachingSummaries.periodStart, previous.periodStart),
        eq(coachingSummaries.periodEnd, previous.periodEnd)
      )
    );

  return {
    period_start: previous.periodStart,
    period_end: previous.periodEnd,
    reps: rows.map((row) => ({
      rep_name: row.repName,
      calls_graded: row.callsGraded,
      average_score: Number(row.averageScore),
      primary_focus_dimension: row.primaryFocusDimension,
      primary_focus: row.primaryFocus,
      dimension_averages: row.dimensionAveragesJson
    }))
  };
}

export async function generateSummaries(options: GenerateSummariesOptions = {}): Promise<GenerateSummariesResult> {
  const date = options.date || new Date().toISOString().slice(0, 10);
  const period = options.period || "daily";
  const llm = options.llm ?? process.env.COACH_SUMMARY_PROVIDER === "openrouter";
  const minDurationSeconds = Number(process.env.COACH_SUMMARY_MIN_DURATION_SECONDS || 600);
  const db = getDb();
  const reps = await db.select().from(appUsers).where(eq(appUsers.role, "rep"));
  const managers = await db.select().from(appUsers).where(eq(appUsers.role, "manager"));
  let summaries = 0;
  let artifacts = 0;

  for (const periodType of selectedPeriods(period)) {
    const { periodStart, periodEnd } = periodRange(date, periodType);
    const since = new Date(`${periodStart}T00:00:00.000Z`);
    const until = new Date(`${periodEnd}T23:59:59.999Z`);
    const titlePeriod = `${periodType[0].toUpperCase()}${periodType.slice(1)}`;
    const managerRepSummaries = [];

    await db
      .delete(reportArtifacts)
      .where(
        and(
          eq(reportArtifacts.periodType, periodType),
          eq(reportArtifacts.periodStart, periodStart),
          eq(reportArtifacts.periodEnd, periodEnd)
        )
      );
    await db
      .delete(coachingSummaries)
      .where(
        and(
          eq(coachingSummaries.periodType, periodType),
          eq(coachingSummaries.periodStart, periodStart),
          eq(coachingSummaries.periodEnd, periodEnd)
        )
      );
    if (periodType === "daily") {
      await db
        .delete(coachingActionItems)
        .where(
          and(
            eq(coachingActionItems.sourcePeriodStart, periodStart),
            eq(coachingActionItems.sourcePeriodEnd, periodEnd),
            eq(coachingActionItems.status, "open")
          )
        );
    }

    for (const rep of reps) {
      const rows = await db
        .select({
          closeCallId: calls.closeCallId,
          activityAt: calls.activityAt,
          durationSeconds: calls.durationSeconds,
          overallScore: callScorecards.overallScore,
          opening: callScorecards.openingScore,
          qualification: callScorecards.qualificationScore,
          discovery: callScorecards.discoveryScore,
          quantification: callScorecards.quantificationScore,
          solutionToPain: callScorecards.solutionToPainScore,
          featureDumpControl: callScorecards.featureDumpControlScore,
          closeOrNextStep: callScorecards.closeOrNextStepScore,
          compliance: callScorecards.complianceScore,
          leadSegment: callScorecards.leadSegment,
          topStrength: callScorecards.topStrength,
          biggestCoachingOpportunity: callScorecards.biggestCoachingOpportunity,
          nextCallFocus: callScorecards.nextCallFocus,
          evidenceSummaryJson: callScorecards.evidenceSummaryJson
        })
        .from(callScorecards)
        .innerJoin(calls, eq(calls.id, callScorecards.callId))
        .where(
          and(
            eq(calls.repUserId, rep.id),
            gte(calls.activityAt, since),
            lte(calls.activityAt, until),
            gte(calls.durationSeconds, minDurationSeconds)
          )
        );

      if (!rows.length) continue;

      const dimensionAverages = {
        opening: round1(average(rows.map((row) => Number(row.opening)))),
        qualification: round1(average(rows.map((row) => Number(row.qualification)))),
        discovery: round1(average(rows.map((row) => Number(row.discovery)))),
        quantification: round1(average(rows.map((row) => Number(row.quantification)))),
        solution_to_pain: round1(average(rows.map((row) => Number(row.solutionToPain)))),
        feature_dump_control: round1(average(rows.map((row) => Number(row.featureDumpControl)))),
        close_or_next_step: round1(average(rows.map((row) => Number(row.closeOrNextStep)))),
        compliance: round1(average(rows.map((row) => Number(row.compliance))))
      };
      const weakestScoreDimension = weakest(dimensionAverages);
      const strongestDimension = strongest(dimensionAverages);
      const focus = chooseFocus(dimensionAverages);
      const averageScore = round1(average(rows.map((row) => Number(row.overallScore))));
      const nextCallFocus = focus.behavior;
      let summaryMarkdown = buildRepSummaryMarkdown({
        titlePeriod,
        repName: rep.displayName,
        periodStart,
        periodEnd,
        callsGraded: rows.length,
        averageScore,
        dimensionAverages,
        strongestDimension,
        weakestScoreDimension,
        focus
      });
      let primaryFocus = focus.focus;
      let primaryFocusDimension = focus.dimension;
      let focusRationale = focus.rationale;
      let effectiveNextCallFocus = nextCallFocus;

      if (llm) {
        const previousContext = await getPreviousRepContext(rep.id, periodType, periodStart, periodEnd);
        console.log(`Generating LLM ${periodType} rep summary for ${rep.displayName} (${rows.length} calls)`);
        const llmSummary = await writeCoachingSummary({
          audience: "rep",
          periodType,
          periodStart,
          periodEnd,
          repName: rep.displayName,
          aggregate: {
            calls_graded: rows.length,
            average_score: averageScore,
            dimension_averages: dimensionAverages,
            strongest_dimension: strongestDimension,
            weakest_score_dimension: weakestScoreDimension,
            deterministic_focus: focus.focus
          },
          previousContext,
          scorecards: rows
        });
        summaryMarkdown = llmSummary.markdown;
        primaryFocus = llmSummary.primary_focus || primaryFocus;
        primaryFocusDimension = (llmSummary.primary_focus_dimension || primaryFocusDimension) as RubricKey;
        focusRationale = llmSummary.focus_rationale || focusRationale;
        effectiveNextCallFocus = llmSummary.next_call_focus || effectiveNextCallFocus;
        console.log(`Generated LLM ${periodType} rep summary for ${rep.displayName}`);
      }

      await db
        .insert(coachingSummaries)
        .values({
          repUserId: rep.id,
          periodType,
          periodStart,
          periodEnd,
          callsGraded: rows.length,
          averageScore: String(averageScore),
          dimensionAveragesJson: dimensionAverages,
          strongestDimension,
          weakestDimension: weakestScoreDimension,
          weakestScoreDimension,
          primaryFocusDimension,
          focusRationale,
          primaryFocus,
          nextCallFocus: effectiveNextCallFocus,
          summaryMarkdown
        })
        .onConflictDoUpdate({
          target: [
            coachingSummaries.repUserId,
            coachingSummaries.periodType,
            coachingSummaries.periodStart,
            coachingSummaries.periodEnd
          ],
          set: {
            callsGraded: rows.length,
            averageScore: String(averageScore),
            dimensionAveragesJson: dimensionAverages,
            strongestDimension,
            weakestDimension: weakestScoreDimension,
            weakestScoreDimension,
            primaryFocusDimension,
            focusRationale,
            primaryFocus,
            nextCallFocus: effectiveNextCallFocus,
            summaryMarkdown
          }
        });

      await upsertSummaryArtifact({
        reportType: "rep_summary",
        periodType,
        periodStart,
        periodEnd,
        repUserId: rep.id,
        contentMarkdown: summaryMarkdown
      });
      artifacts += 1;

      if (periodType === "daily") {
        const existingAction = await db
          .select({ id: coachingActionItems.id })
          .from(coachingActionItems)
          .where(
            and(
              eq(coachingActionItems.repUserId, rep.id),
              eq(coachingActionItems.sourcePeriodStart, periodStart),
              eq(coachingActionItems.sourcePeriodEnd, periodEnd),
            eq(coachingActionItems.dimension, primaryFocusDimension),
              eq(coachingActionItems.status, "open")
            )
          )
          .limit(1);
        if (!existingAction[0]) {
          await db.insert(coachingActionItems).values({
            repUserId: rep.id,
            sourcePeriodStart: periodStart,
            sourcePeriodEnd: periodEnd,
            dimension: primaryFocusDimension,
            actionText: effectiveNextCallFocus,
            whyItMatters: "This was selected by the Decoded leverage model for the current coaching window.",
            status: "open"
          });
        }
      }

      managerRepSummaries.push({
        repName: rep.displayName,
        callsGraded: rows.length,
        averageScore,
        primaryFocus,
        nextCallFocus: effectiveNextCallFocus,
        weakestScoreDimension,
        strongestDimension,
        scorecards: rows
      });
      summaries += 1;
    }

    if (managerRepSummaries.length) {
      let managerMarkdown = buildManagerSummaryMarkdown({
        titlePeriod,
        periodStart,
        periodEnd,
        repSummaries: managerRepSummaries
      });

      if (llm) {
        const previousContext = await getPreviousManagerContext(periodType, periodStart, periodEnd);
        console.log(`Generating LLM ${periodType} manager summary (${managerRepSummaries.length} reps)`);
        const llmManagerSummary = await writeCoachingSummary({
          audience: "manager",
          periodType,
          periodStart,
          periodEnd,
          aggregate: {
            reps_reviewed: managerRepSummaries.length,
            total_calls: managerRepSummaries.reduce((sum, rep) => sum + rep.callsGraded, 0),
            rep_summaries: managerRepSummaries.map(({ scorecards: _scorecards, ...rep }) => rep)
          },
          previousContext,
          scorecards: managerRepSummaries.flatMap((rep) => rep.scorecards)
        });
        managerMarkdown = llmManagerSummary.markdown;
        console.log(`Generated LLM ${periodType} manager summary`);
      }

      for (const manager of managers) {
        await upsertSummaryArtifact({
          reportType: "manager_summary",
          periodType,
          periodStart,
          periodEnd,
          managerUserId: manager.id,
          contentMarkdown: managerMarkdown
        });
        artifacts += 1;
      }
    }
  }

  return { ok: true, date, period, summaries, artifacts };
}

async function main() {
  const { date, period, llm } = parseArgs();
  const result = await generateSummaries({ date, period, llm });
  console.log(JSON.stringify(result, null, 2));
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
