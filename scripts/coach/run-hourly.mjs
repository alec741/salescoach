import path from "node:path";
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

function parseArgs(argv) {
  const args = {
    force: false,
    since: null,
    until: null,
    max: 1500,
    minDurationSeconds: 120,
    lookbackMinutes: 75,
    provider: process.env.COACH_GRADER_PROVIDER || "heuristic"
  };

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
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function statePath() {
  return path.join(ROOT, "data", "coach", "pipeline-state.json");
}

function scorecardPath(localDate) {
  return path.join(ROOT, "data", "coach", "scorecards", `${localDate}.jsonl`);
}

function rawCallsPath(localDate) {
  return path.join(ROOT, "data", "coach", "raw-calls", `${localDate}.jsonl`);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  if (!args.force && !isBusinessHour(now)) {
    console.log("Skipped: outside Monday-Friday 6 AM-6 PM Eastern business window.");
    return;
  }

  const window = args.since && args.until
    ? { since: args.since, until: args.until, lookbackMinutes: null }
    : getHourlyWindow({ now, lookbackMinutes: args.lookbackMinutes });

  const localDate = formatDateInTimeZone(new Date(window.until));
  const state = readJson(statePath(), { gradedCallIds: [] });
  const existingScorecards = readJsonl(scorecardPath(localDate));
  const alreadyGraded = new Set([
    ...state.gradedCallIds,
    ...existingScorecards.map((scorecard) => scorecard.call_id)
  ]);

  const calls = await fetchCloseCalls({ since: window.since, until: window.until, max: args.max });
  const uniqueCalls = uniqueBy(calls, (call) => call.id);
  const salesCalls = await filterSalesCalls(uniqueCalls, { apiKey: process.env.CLOSE_API_KEY });
  const substantiveCalls = salesCalls.filter((call) => isSubstantiveConnectedCall(call, args.minDurationSeconds));
  const newCalls = substantiveCalls.filter((call) => !alreadyGraded.has(call.id));

  appendJsonl(rawCallsPath(localDate), uniqueCalls.map((call) => ({
    pulled_at: now.toISOString(),
    window,
    ...call
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

  appendJsonl(scorecardPath(localDate), scorecards);

  const updatedIds = Array.from(new Set([...state.gradedCallIds, ...scorecards.map((scorecard) => scorecard.call_id)])).slice(-50000);
  writeJson(statePath(), {
    ...state,
    lastHourlyRunAt: now.toISOString(),
    lastWindow: window,
    gradedCallIds: updatedIds
  });

  console.log(JSON.stringify({
    ok: true,
    localDate,
    since: window.since,
    until: window.until,
    pulled_calls: uniqueCalls.length,
    sales_filtered_calls: salesCalls.length,
    substantive_connected_calls: substantiveCalls.length,
    newly_graded_calls: scorecards.length,
    skipped_already_graded: substantiveCalls.length - scorecards.length,
    scorecard_path: path.relative(ROOT, scorecardPath(localDate)),
    raw_calls_path: path.relative(ROOT, rawCallsPath(localDate))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
