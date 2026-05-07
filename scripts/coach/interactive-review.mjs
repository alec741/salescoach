import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  ensureDir,
  fetchCloseCalls,
  formatDateInTimeZone,
  getDailyEasternWindow,
  isSubstantiveConnectedCall,
  loadLocalEnv,
  readJson,
  sanitizeFileName,
  transcriptText,
  writeJson
} from "./shared.mjs";
import { filterSalesCalls } from "./sales-filter.mjs";

function parseArgs(argv) {
  const args = {
    date: formatDateInTimeZone(new Date()),
    since: null,
    until: null,
    max: 500,
    minDurationSeconds: 120,
    callId: null,
    rep: null,
    longest: false,
    list: false,
    outDir: path.join(ROOT, "data", "coach", "interactive"),
    salesOnly: true,
    explainFilter: false
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
      case "--call-id":
        args.callId = next;
        index += 1;
        break;
      case "--rep":
        args.rep = next.toLowerCase();
        index += 1;
        break;
      case "--longest":
        args.longest = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--out-dir":
        args.outDir = path.resolve(ROOT, next);
        index += 1;
        break;
      case "--include-non-sales":
        args.salesOnly = false;
        break;
      case "--explain-filter":
        args.explainFilter = true;
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

function filterCalls(calls, args) {
  return calls
    .filter((call) => isSubstantiveConnectedCall(call, args.minDurationSeconds))
    .filter((call) => !args.rep || String(call.user_name || "").toLowerCase().includes(args.rep))
    .sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
}

function listCalls(calls) {
  console.log(JSON.stringify({
    count: calls.length,
    calls: calls.slice(0, 50).map((call) => ({
      id: call.id,
      rep: call.user_name,
      direction: call.direction,
      duration_min: Math.round(((call.duration_seconds || 0) / 60) * 10) / 10,
      activity_at: call.activity_at,
      utterances: call.recording_transcript?.utterances?.length || 0,
      summary: call.recording_transcript?.summary_text?.split("\n").slice(0, 2).join(" ") || ""
    }))
  }, null, 2));
}

function buildReviewPacket(call, window) {
  const methodology = readJson(path.join(ROOT, "config", "methodology.decoded.json"));
  const profile = readJson(path.join(ROOT, "config", "companies", "enhancify.json"));
  const gradingPrompt = fs.readFileSync(path.join(ROOT, "prompts", "grading", "call-scorecard.md"), "utf8");
  const transcript = transcriptText(call, 40000);

  return [
    "# Codex Interactive Call Review Packet",
    "",
    "Use this packet to grade the call as Decoded Coach for Enhancify. Do not treat heuristic scores as source of truth. Return a concise coaching review and a structured scorecard.",
    "",
    "## Call Metadata",
    "",
    JSON.stringify({
      call_id: call.id,
      lead_id: call.lead_id,
      rep_id: call.user_id,
      rep_name: call.user_name,
      direction: call.direction,
      status: call.status,
      activity_at: call.activity_at,
      date_created: call.date_created,
      duration_seconds: call.duration_seconds,
      duration_minutes: Math.round(((call.duration_seconds || 0) / 60) * 10) / 10,
      transcript_utterances: call.recording_transcript?.utterances?.length || 0,
      sales_filter: call.sales_filter ? {
        reason: call.sales_filter.reason,
        lead_status: call.sales_filter.lead?.status_label || null,
        lead_pipeline_names: (call.sales_filter.lead?.opportunities || []).map((opportunity) => opportunity.pipeline_name).filter(Boolean),
        customer_type: call.sales_filter.lead?.custom?.["Customer type"] || null,
        lead_owner: call.sales_filter.lead?.custom?.["Lead Owner"] || null,
        lead_source_tier: call.sales_filter.lead?.custom?.["Lead Source Tier"] || null
      } : null,
      window
    }, null, 2),
    "",
    "## Close Transcript Summary",
    "",
    call.recording_transcript?.summary_text || "No Close transcript summary available.",
    "",
    "## Decoded Methodology",
    "",
    JSON.stringify(methodology, null, 2),
    "",
    "## Enhancify Profile",
    "",
    JSON.stringify(profile, null, 2),
    "",
    "## Grading Contract",
    "",
    gradingPrompt,
    "",
    "## Transcript",
    "",
    transcript
  ].join("\n");
}

function writePacket(call, window, outDir) {
  ensureDir(outDir);
  const slug = `${sanitizeFileName(call.user_name)}-${call.id}`;
  const jsonPath = path.join(outDir, `${slug}.json`);
  const mdPath = path.join(outDir, `${slug}.md`);
  writeJson(jsonPath, call);
  fs.writeFileSync(mdPath, buildReviewPacket(call, window), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const window = windowFromArgs(args);
  const calls = await fetchCloseCalls({ since: window.since, until: window.until, max: args.max });
  const salesFilterResult = args.salesOnly
    ? await filterSalesCalls(calls, { apiKey: process.env.CLOSE_API_KEY, explain: args.explainFilter })
    : null;
  const callPool = args.salesOnly
    ? (args.explainFilter ? salesFilterResult.included : salesFilterResult)
    : calls;
  const candidates = filterCalls(callPool, args);

  if (args.list) {
    listCalls(candidates);
    if (args.explainFilter && salesFilterResult) {
      console.log("\nSALES FILTER SUMMARY");
      console.log(JSON.stringify({
        included: salesFilterResult.included.length,
        excluded: salesFilterResult.excluded.length,
        excluded_reasons: salesFilterResult.excluded.reduce((acc, item) => {
          acc[item.reason] = (acc[item.reason] || 0) + 1;
          return acc;
        }, {})
      }, null, 2));
    }
    return;
  }

  let selected = null;
  if (args.callId) selected = candidates.find((call) => call.id === args.callId);
  if (!selected && args.longest) selected = candidates[0];
  if (!selected) {
    listCalls(candidates);
    console.log("\nNo call selected. Re-run with --longest or --call-id <id>.");
    return;
  }

  const paths = writePacket(selected, window, args.outDir);
  console.log(JSON.stringify({
    ok: true,
    selected_call_id: selected.id,
    rep_name: selected.user_name,
    duration_minutes: Math.round(((selected.duration_seconds || 0) / 60) * 10) / 10,
    review_packet: path.relative(ROOT, paths.mdPath),
    raw_call_json: path.relative(ROOT, paths.jsonPath),
    sales_only_filter_enabled: args.salesOnly,
    instruction: "Ask Codex: review the generated packet and grade this sales call."
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
