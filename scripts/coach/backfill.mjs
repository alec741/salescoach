import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatDateInTimeZone, loadLocalEnv } from "./shared.mjs";

const ROOT = process.cwd();

function parseArgs(argv) {
  const args = {
    days: 30,
    start: null,
    end: formatDateInTimeZone(new Date()),
    provider: process.env.COACH_GRADER_PROVIDER || "openai",
    minDurationSeconds: 120,
    maxPerDay: 3000,
    limitPerDay: null,
    managerEmail: "manager@enhancify.example",
    skipMigrate: false,
    skipSeedReps: false,
    skipGrading: false,
    skipImport: false,
    skipSummaries: false,
    llmSummaries: false,
    regrade: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--days":
        args.days = Number(next);
        index += 1;
        break;
      case "--start":
        args.start = next;
        index += 1;
        break;
      case "--end":
        args.end = next;
        index += 1;
        break;
      case "--provider":
        args.provider = next;
        index += 1;
        break;
      case "--min-duration-seconds":
        args.minDurationSeconds = Number(next);
        index += 1;
        break;
      case "--max-per-day":
        args.maxPerDay = Number(next);
        index += 1;
        break;
      case "--limit-per-day":
        args.limitPerDay = Number(next);
        index += 1;
        break;
      case "--manager-email":
        args.managerEmail = next;
        index += 1;
        break;
      case "--skip-migrate":
        args.skipMigrate = true;
        break;
      case "--skip-seed-reps":
        args.skipSeedReps = true;
        break;
      case "--skip-grading":
        args.skipGrading = true;
        break;
      case "--skip-import":
        args.skipImport = true;
        break;
      case "--skip-summaries":
        args.skipSummaries = true;
        break;
      case "--llm-summaries":
        args.llmSummaries = true;
        break;
      case "--regrade":
        args.regrade = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.days) || args.days < 1) throw new Error("--days must be a positive integer.");
  if (!Number.isInteger(args.minDurationSeconds) || args.minDurationSeconds < 1) {
    throw new Error("--min-duration-seconds must be a positive integer.");
  }
  if (!Number.isInteger(args.maxPerDay) || args.maxPerDay < 1) throw new Error("--max-per-day must be a positive integer.");
  if (args.limitPerDay !== null && (!Number.isInteger(args.limitPerDay) || args.limitPerDay < 1)) {
    throw new Error("--limit-per-day must be a positive integer.");
  }

  if (!args.start) {
    const end = new Date(`${args.end}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - args.days + 1);
    args.start = end.toISOString().slice(0, 10);
  }

  return args;
}

function addDays(date, days) {
  const current = new Date(`${date}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function monthAnchors(start, end) {
  const anchors = new Set();
  for (const date of dateRange(start, end)) {
    anchors.add(`${date.slice(0, 7)}-01`);
  }
  return [...anchors].sort();
}

function weekAnchors(start, end) {
  const anchors = new Set();
  for (const date of dateRange(start, end)) {
    const current = new Date(`${date}T12:00:00Z`);
    const day = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() + 1 - day);
    anchors.add(current.toISOString().slice(0, 10));
  }
  return [...anchors].sort();
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function localBin(name) {
  return path.join(ROOT, "node_modules", ".bin", commandName(name));
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`Command failed with exit ${result.status}: ${command} ${args.join(" ")}`);
  }
}

function nodeScript(script, args = []) {
  run(process.execPath, [script, ...args]);
}

function tsxScript(script, args = []) {
  run(process.execPath, ["--import", "tsx", script, ...args]);
}

function scorecardPath(provider, date) {
  return path.join(ROOT, "data", "coach", "scorecards", provider, `${date}.jsonl`);
}

function requireEnv(args) {
  const missing = [];
  if (!process.env.CLOSE_API_KEY) missing.push("CLOSE_API_KEY");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (args.provider === "openai" && !args.skipGrading && !process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (args.provider === "openrouter" && !args.skipGrading && !process.env.OPENROUTER_API_KEY) {
    missing.push("OPENROUTER_API_KEY");
  }

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Add them to .env, then rerun this backfill.`
    );
  }
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  requireEnv(args);

  if (!args.skipMigrate) run(localBin("drizzle-kit"), ["migrate"]);
  if (!args.skipSeedReps) tsxScript("scripts/db/seed-sales-reps.ts", ["--manager-email", args.managerEmail]);

  const dates = dateRange(args.start, args.end);
  const dailyResults = [];

  for (const date of dates) {
    if (!args.skipGrading) {
      const gradeArgs = [
        "--date",
        date,
        "--provider",
        args.provider,
        "--min-duration-seconds",
        String(args.minDurationSeconds),
        "--max",
        String(args.maxPerDay)
      ];
      if (args.regrade) gradeArgs.push("--regrade", "--replace-output");
      if (args.limitPerDay) gradeArgs.push("--limit", String(args.limitPerDay));
      nodeScript("scripts/coach/grade-day.mjs", gradeArgs);
    }

    const file = scorecardPath(args.provider, date);
    const hasScorecards = fs.existsSync(file) && fs.statSync(file).size > 0;
    if (!args.skipImport && hasScorecards) {
      tsxScript("scripts/db/import-scorecards.ts", ["--file", file, "--date", date]);
    }
    if (!args.skipSummaries && hasScorecards) {
      const summaryArgs = ["--date", date, "--period", "daily"];
      if (args.llmSummaries) summaryArgs.push("--llm");
      tsxScript("scripts/db/generate-summaries.ts", summaryArgs);
    }

    dailyResults.push({
      date,
      scorecard_file: path.relative(ROOT, file),
      scorecard_file_exists: hasScorecards
    });
  }

  if (!args.skipSummaries) {
    for (const anchor of weekAnchors(args.start, args.end)) {
      const summaryArgs = ["--date", anchor, "--period", "weekly"];
      if (args.llmSummaries) summaryArgs.push("--llm");
      tsxScript("scripts/db/generate-summaries.ts", summaryArgs);
    }
    for (const anchor of monthAnchors(args.start, args.end)) {
      const summaryArgs = ["--date", anchor, "--period", "monthly"];
      if (args.llmSummaries) summaryArgs.push("--llm");
      tsxScript("scripts/db/generate-summaries.ts", summaryArgs);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    start: args.start,
    end: args.end,
    provider: args.provider,
    min_duration_seconds: args.minDurationSeconds,
    llm_summaries: args.llmSummaries,
    days: dates.length,
    daily_results: dailyResults
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
