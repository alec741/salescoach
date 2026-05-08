import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  appendJsonl,
  fetchCloseCalls,
  formatDateInTimeZone,
  getHourlyWindow,
  isBusinessHour,
  isSubstantiveConnectedCall,
  loadLocalEnv,
  readJson,
  readJsonl,
  uniqueBy,
  writeJson
} from "./shared.mjs";
import { gradeCall } from "./grader.mjs";
import { filterSalesCalls } from "./sales-filter.mjs";
import { finishPipelineJob, startPipelineJob } from "./job-lock.mjs";

function defaultArgs() {
  return {
    force: false,
    since: null,
    until: null,
    max: 1500,
    minDurationSeconds: 600,
    lookbackMinutes: 45,
    provider: process.env.COACH_GRADER_PROVIDER || "openrouter",
    importToDb: true,
    importMode: "subprocess"
  };
}

export function parseArgs(argv) {
  const args = defaultArgs();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--force":
        args.force = true;
        break;
      case "--since":
        args.since = next;
        index += 1;
        break;
      case "--until":
        args.until = next;
        index += 1;
        break;
      case "--max":
        args.max = Number(next);
        index += 1;
        break;
      case "--min-duration-seconds":
        args.minDurationSeconds = Number(next);
        index += 1;
        break;
      case "--lookback-minutes":
        args.lookbackMinutes = Number(next);
        index += 1;
        break;
      case "--provider":
        args.provider = next;
        index += 1;
        break;
      case "--skip-import":
        args.importToDb = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function statePath() {
  return path.join(ROOT, "data", "coach", "pipeline-state.json");
}

function scorecardPath(provider, localDate) {
  return path.join(ROOT, "data", "coach", "scorecards", provider, `${localDate}.jsonl`);
}

function rawCallsPath(localDate) {
  return path.join(ROOT, "data", "coach", "raw-calls", `${localDate}.jsonl`);
}

async function importScorecardsInline({ scorecardsFile, localDate }) {
  const { importScorecardsFile } = await import("../db/import-scorecards.ts");
  return importScorecardsFile({
    file: scorecardsFile,
    callsFile: rawCallsPath(localDate),
    date: localDate
  });
}

export async function runHourly(overrides = {}) {
  loadLocalEnv();
  const args = {
    ...defaultArgs(),
    ...overrides
  };
  const now = new Date();

  if (!args.force && !isBusinessHour(now)) {
    return { ok: true, skipped: true, reason: "outside_business_hours" };
  }

  const window = args.since && args.until
    ? { since: args.since, until: args.until, lookbackMinutes: null }
    : getHourlyWindow({ now, lookbackMinutes: args.lookbackMinutes });
  const job = await startPipelineJob({
    jobType: "grade_calls",
    idempotencyKey: `grade_calls:${window.since}:${window.until}:${args.provider}:${args.minDurationSeconds}`,
    force: args.force,
    payload: {
      window,
      provider: args.provider,
      min_duration_seconds: args.minDurationSeconds,
      max: args.max
    }
  });
  if (!job.acquired) {
    return { ok: true, skipped: true, reason: job.reason, job_id: job.jobId };
  }

  try {
    const localDate = formatDateInTimeZone(new Date(window.until));
    const state = readJson(statePath(), { gradedCallIds: [] });
    const scorecardsFile = scorecardPath(args.provider, localDate);
    const existingScorecards = readJsonl(scorecardsFile);
    const alreadyGraded = new Set([
      ...state.gradedCallIds,
      ...existingScorecards.map((scorecard) => scorecard.call_id)
    ]);

    const calls = await fetchCloseCalls({ since: window.since, until: window.until, max: args.max });
    const uniqueCalls = uniqueBy(calls, (call) => call.id);
    const salesCalls = await filterSalesCalls(uniqueCalls, { apiKey: process.env.CLOSE_API_KEY });
    const substantiveCalls = salesCalls.filter((call) => isSubstantiveConnectedCall(call, args.minDurationSeconds));
    const newCalls = substantiveCalls.filter((call) => !alreadyGraded.has(call.id));

    const salesCallById = new Map(salesCalls.map((call) => [call.id, call]));
    appendJsonl(rawCallsPath(localDate), uniqueCalls.map((call) => ({
      pulled_at: now.toISOString(),
      window,
      ...(salesCallById.get(call.id) || call)
    })));

    const scorecards = [];
    for (const call of newCalls) {
      const scorecard = await gradeCall(call, { provider: args.provider });
      scorecards.push({
        graded_at: now.toISOString(),
        window,
        ...scorecard
      });
    }

    appendJsonl(scorecardsFile, scorecards);

    if (args.importToDb && scorecards.length && process.env.DATABASE_URL) {
      if (args.importMode === "inline") {
        await importScorecardsInline({ scorecardsFile, localDate });
      } else {
        const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/import-scorecards.ts", "--file", scorecardsFile, "--date", localDate, "--calls-file", rawCallsPath(localDate)], {
          cwd: ROOT,
          env: process.env,
          stdio: "inherit",
          shell: false
        });
        if (result.status !== 0) throw new Error(`Scorecard import failed with exit ${result.status}.`);
      }
    }

    const updatedIds = Array.from(new Set([...state.gradedCallIds, ...scorecards.map((scorecard) => scorecard.call_id)])).slice(-50000);
    writeJson(statePath(), {
      ...state,
      lastHourlyRunAt: now.toISOString(),
      lastWindow: window,
      gradedCallIds: updatedIds
    });

    const result = {
      ok: true,
      localDate,
      since: window.since,
      until: window.until,
      pulled_calls: uniqueCalls.length,
      sales_filtered_calls: salesCalls.length,
      substantive_connected_calls: substantiveCalls.length,
      newly_graded_calls: scorecards.length,
      skipped_already_graded: substantiveCalls.length - scorecards.length,
      scorecard_path: path.relative(ROOT, scorecardsFile),
      raw_calls_path: path.relative(ROOT, rawCallsPath(localDate))
    };
    await finishPipelineJob(job.jobId, { result });
    return result;
  } catch (error) {
    await finishPipelineJob(job.jobId, { status: "failed", errorMessage: error.message });
    throw error;
  }
}

async function main() {
  const result = await runHourly(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
