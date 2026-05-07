import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, calls, callScorecards, coachingActionItems, coachingSummaries } from "../../src/db/schema";
import { rubricKeys, type PeriodType, type RubricKey } from "../../src/lib/types";

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
    period: periodIndex >= 0 ? args[periodIndex + 1] : "daily"
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

function selectedPeriods(period: string): PeriodType[] {
  if (period === "all") return ["daily", "weekly", "monthly", "quarterly"];
  if (["daily", "weekly", "monthly", "quarterly"].includes(period)) return [period as PeriodType];
  throw new Error(`Unsupported period: ${period}. Use daily, weekly, monthly, quarterly, or all.`);
}

async function main() {
  const { date, period } = parseArgs();
  const db = getDb();
  const reps = await db.select().from(appUsers).where(eq(appUsers.role, "rep"));
  let summaries = 0;

  for (const periodType of selectedPeriods(period)) {
    const { periodStart, periodEnd } = periodRange(date, periodType);
    const since = new Date(`${periodStart}T00:00:00.000Z`);
    const until = new Date(`${periodEnd}T23:59:59.999Z`);

    for (const rep of reps) {
      const rows = await db
        .select({
          overallScore: callScorecards.overallScore,
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
        .where(and(eq(calls.repUserId, rep.id), gte(calls.activityAt, since), lte(calls.activityAt, until)));

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
      const titlePeriod = `${periodType[0].toUpperCase()}${periodType.slice(1)}`;

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
          primaryFocusDimension: focus.dimension,
          focusRationale: focus.rationale,
          primaryFocus: focus.focus,
          nextCallFocus,
          summaryMarkdown: `# ${titlePeriod} Coaching Summary - ${rep.displayName}\n\nPeriod: ${periodStart} to ${periodEnd}\nCalls graded: ${rows.length}\nAverage score: ${averageScore}/10\n\n## Focus\n\n${focus.focus}\n\n## Next call behavior\n\n${nextCallFocus}\n`
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
            primaryFocusDimension: focus.dimension,
            focusRationale: focus.rationale,
            primaryFocus: focus.focus,
            nextCallFocus
          }
        });

      if (periodType === "daily") {
        const existingAction = await db
          .select({ id: coachingActionItems.id })
          .from(coachingActionItems)
          .where(
            and(
              eq(coachingActionItems.repUserId, rep.id),
              eq(coachingActionItems.sourcePeriodStart, periodStart),
              eq(coachingActionItems.sourcePeriodEnd, periodEnd),
              eq(coachingActionItems.dimension, focus.dimension),
              eq(coachingActionItems.status, "open")
            )
          )
          .limit(1);
        if (!existingAction[0]) {
          await db.insert(coachingActionItems).values({
            repUserId: rep.id,
            sourcePeriodStart: periodStart,
            sourcePeriodEnd: periodEnd,
            dimension: focus.dimension,
            actionText: nextCallFocus,
            whyItMatters: "This was selected by the Decoded leverage model for the current coaching window.",
            status: "open"
          });
        }
      }

      summaries += 1;
    }
  }

  console.log(JSON.stringify({ ok: true, date, period, summaries }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
