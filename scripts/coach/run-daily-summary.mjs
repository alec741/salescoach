import path from "node:path";
import {
  ROOT,
  average,
  formatDateInTimeZone,
  loadLocalEnv,
  readJsonl,
  sanitizeFileName,
  writeJson
} from "./shared.mjs";
import { RUBRIC_KEYS, THEMES, chooseCoachingFocus } from "./grader.mjs";
import fs from "node:fs";

function parseArgs(argv) {
  const args = {
    date: formatDateInTimeZone(new Date()),
    minCallsForTheme: 1
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--date":
        args.date = next;
        index += 1;
        break;
      case "--min-calls-for-theme":
        args.minCallsForTheme = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function scorecardPath(localDate) {
  return path.join(ROOT, "data", "coach", "scorecards", `${localDate}.jsonl`);
}

function reportDir(localDate) {
  return path.join(ROOT, "reports", "daily", localDate);
}

function groupByRep(scorecards) {
  const reps = new Map();
  for (const scorecard of scorecards) {
    const key = scorecard.rep_id || scorecard.rep_name || "unknown";
    if (!reps.has(key)) reps.set(key, []);
    reps.get(key).push(scorecard);
  }
  return reps;
}

function aggregateRep(scorecards) {
  const first = scorecards[0];
  const dimensionAverages = Object.fromEntries(
    RUBRIC_KEYS.map((key) => [key, round1(average(scorecards.map((scorecard) => scorecard.scores?.[key])) || 0)])
  );
  const weakestDimension = Object.entries(dimensionAverages).sort((a, b) => a[1] - b[1])[0]?.[0] || "quantification";
  const strongestDimension = Object.entries(dimensionAverages).sort((a, b) => b[1] - a[1])[0]?.[0] || "discovery";
  const complianceFlags = scorecards.flatMap((scorecard) => scorecard.compliance_flags || []);
  const coachingFocus = chooseCoachingFocus(dimensionAverages, complianceFlags, scorecards.length);

  return {
    rep_id: first.rep_id,
    rep_name: first.rep_name || "Unknown Rep",
    calls_graded: scorecards.length,
    average_score: round1(average(scorecards.map((scorecard) => scorecard.overall_score)) || 0),
    average_duration_minutes: round1(average(scorecards.map((scorecard) => scorecard.duration_minutes)) || 0),
    dimension_averages: dimensionAverages,
    strongest_dimension: strongestDimension,
    weakest_dimension: weakestDimension,
    focus_dimensions: coachingFocus.dimensions,
    top_strength: THEMES[strongestDimension],
    primary_focus: coachingFocus.headline,
    next_call_focus: coachingFocus.behavior,
    focus_rationale: coachingFocus.rationale,
    compliance_flag_count: complianceFlags.length,
    common_compliance_flags: topCounts(complianceFlags, 3),
    call_ids: scorecards.map((scorecard) => scorecard.call_id)
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function topCounts(items, limit) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item, count]) => ({ item, count }));
}

function repMarkdown(localDate, aggregate) {
  const compliance = aggregate.common_compliance_flags.length
    ? aggregate.common_compliance_flags.map((flag) => `- ${flag.item} (${flag.count} calls)`).join("\n")
    : "- No repeated compliance flags detected.";

  const focusScores = aggregate.focus_dimensions
    .map((key) => `\`${key}\` at ${aggregate.dimension_averages[key]}/10`)
    .join(" and ");

  return `# Daily Coaching Summary - ${aggregate.rep_name}\n\nDate: ${localDate}\nCalls graded: ${aggregate.calls_graded}\nAverage score: ${aggregate.average_score}/10\nAverage substantive-call duration: ${aggregate.average_duration_minutes} minutes\n\n## One Focus For Tomorrow\n\n${aggregate.primary_focus}\n\n## Why This Is The Focus\n\nThe leverage model selected ${focusScores}. ${aggregate.focus_rationale} The goal is not to fix everything at once; the fastest improvement is to tighten this behavior across the next calls.\n\n## Next-Call Behavior\n\n${aggregate.next_call_focus}\n\n## Strength To Keep\n\n${aggregate.top_strength}\n\n## Score Breakdown\n\n${RUBRIC_KEYS.map((key) => `- ${key}: ${aggregate.dimension_averages[key]}/10`).join("\n")}\n\n## Compliance Watch\n\n${compliance}\n`;
}

function managerMarkdown(localDate, aggregates) {
  const sorted = [...aggregates].sort((a, b) => a.rep_name.localeCompare(b.rep_name));
  return `# Sales Manager Daily Coaching Brief\n\nDate: ${localDate}\nReps reviewed: ${sorted.length}\nSubstantive calls graded: ${sorted.reduce((sum, rep) => sum + rep.calls_graded, 0)}\n\n${sorted.map((rep) => `## ${rep.rep_name}\n\nCalls graded: ${rep.calls_graded}\nAverage score: ${rep.average_score}/10\nStrength: ${rep.top_strength}\nFocus: ${rep.primary_focus}\nManager coaching note: ${rep.next_call_focus}\nCompliance flags: ${rep.compliance_flag_count}\n`).join("\n")}`;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const scorecards = readJsonl(scorecardPath(args.date));
  const reps = groupByRep(scorecards);
  const aggregates = Array.from(reps.values()).map(aggregateRep);
  const dir = reportDir(args.date);
  fs.mkdirSync(dir, { recursive: true });

  for (const aggregate of aggregates) {
    const filePath = path.join(dir, `${sanitizeFileName(aggregate.rep_name)}.md`);
    fs.writeFileSync(filePath, repMarkdown(args.date, aggregate), "utf8");
  }

  const managerPath = path.join(dir, "manager-summary.md");
  fs.writeFileSync(managerPath, managerMarkdown(args.date, aggregates), "utf8");
  writeJson(path.join(dir, "daily-aggregates.json"), aggregates);

  console.log(JSON.stringify({
    ok: true,
    date: args.date,
    reps_reviewed: aggregates.length,
    substantive_calls_graded: scorecards.length,
    report_dir: path.relative(ROOT, dir),
    manager_summary: path.relative(ROOT, managerPath)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
