import path from "node:path";
import fs from "node:fs";
import {
  ROOT,
  appendJsonl,
  fetchCloseCalls,
  formatDateInTimeZone,
  getDailyEasternWindow,
  isSubstantiveConnectedCall,
  loadLocalEnv,
  readJsonl,
  uniqueBy
} from "./shared.mjs";
import { gradeCall } from "./grader.mjs";
import { filterSalesCalls } from "./sales-filter.mjs";

function parseArgs(argv) {
  const args = {
    date: formatDateInTimeZone(new Date()),
    since: null,
    until: null,
    max: 3000,
    minDurationSeconds: 120,
    provider: process.env.COACH_GRADER_PROVIDER || "openai",
    regrade: false,
    replaceOutput: false,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--date":
        args.date = next;
        index += 1;
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
      case "--provider":
        args.provider = next;
        index += 1;
        break;
      case "--regrade":
        args.regrade = true;
        break;
      case "--replace-output":
        args.replaceOutput = true;
        break;
      case "--limit":
        args.limit = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function windowFromArgs(args) {
  if (args.since || args.until) {
    if (!args.since || !args.until) throw new Error("Use both --since and --until, or neither.");
    return { localDate: args.date, since: args.since, until: args.until };
  }
  return getDailyEasternWindow(new Date(`${args.date}T12:00:00Z`));
}

function scorecardPath(provider, localDate) {
  return path.join(ROOT, "data", "coach", "scorecards", provider, `${localDate}.jsonl`);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const window = windowFromArgs(args);
  const provider = args.provider;

  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to grade calls with the OpenAI/Codex-style grader. Add it to .env, then rerun this command.");
  }

  const calls = await fetchCloseCalls({ since: window.since, until: window.until, max: args.max });
  const uniqueCalls = uniqueBy(calls, (call) => call.id);
  const salesCalls = await filterSalesCalls(uniqueCalls, { apiKey: process.env.CLOSE_API_KEY });
  let gradeable = salesCalls.filter((call) => isSubstantiveConnectedCall(call, args.minDurationSeconds));
  if (args.limit) gradeable = gradeable.slice(0, args.limit);

  const outPath = scorecardPath(provider, window.localDate);
  if (args.replaceOutput && args.regrade) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "", "utf8");
  }
  const existing = args.regrade ? [] : readJsonl(outPath);
  const existingIds = new Set(existing.map((scorecard) => scorecard.call_id));
  const todo = gradeable.filter((call) => !existingIds.has(call.id));

  const results = [];
  for (let index = 0; index < todo.length; index += 1) {
    const call = todo[index];
    console.log(`Grading ${index + 1}/${todo.length}: ${call.user_name || "Unknown"} ${call.id}`);
    const scorecard = await gradeCall(call, { provider });
    results.push({
      graded_at: new Date().toISOString(),
      window,
      ...scorecard
    });
    appendJsonl(outPath, [results.at(-1)]);
  }

  console.log(JSON.stringify({
    ok: true,
    provider,
    date: window.localDate,
    pulled_calls: uniqueCalls.length,
    sales_filtered_calls: salesCalls.length,
    gradeable_sales_calls: gradeable.length,
    already_graded: gradeable.length - todo.length,
    newly_graded: results.length,
    scorecard_path: path.relative(ROOT, outPath)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
