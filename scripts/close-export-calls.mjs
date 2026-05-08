import fs from "node:fs";
import path from "node:path";
import {
  buildCloseContext,
  createLeadCacheSession,
  flushLeadCache,
  getLead,
  loadSalesFilterConfig
} from "./coach/sales-filter.mjs";

const API_BASE = "https://api.close.com/api/v1";
const root = process.cwd();
const DEFAULT_FIELDS = [
  "id",
  "lead_id",
  "contact_id",
  "user_id",
  "user_name",
  "direction",
  "disposition",
  "duration",
  "activity_at",
  "date_created",
  "date_updated",
  "status",
  "outcome_id",
  "source",
  "note",
  "recording_transcript",
  "voicemail_transcript"
];

function loadLocalEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
function parseArgs(argv) {
  const args = {
    since: null,
    until: null,
    limit: 100,
    max: 500,
    out: "data/close/calls.jsonl",
    dryRun: false,
    includeLeadEnrichment: true,
    includeRecordingUrl: false,
    includeNotes: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--since":
        args.since = next;
        index += 1;
        break;
      case "--until":
        args.until = next;
        index += 1;
        break;
      case "--limit":
        args.limit = Number(next);
        index += 1;
        break;
      case "--max":
        args.max = Number(next);
        index += 1;
        break;
      case "--out":
        args.out = next;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--exclude-lead-enrichment":
        args.includeLeadEnrichment = false;
        break;
      case "--include-recording-url":
        args.includeRecordingUrl = true;
        break;
      case "--exclude-notes":
        args.includeNotes = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }

  if (!Number.isInteger(args.max) || args.max < 1) {
    throw new Error("--max must be a positive integer");
  }

  return args;
}

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function buildUrl(args, skip) {
  const fields = [...DEFAULT_FIELDS];
  if (args.includeRecordingUrl) fields.push("recording_url", "voicemail_url");
  if (!args.includeNotes) fields.splice(fields.indexOf("note"), 1);

  const url = new URL(`${API_BASE}/activity/call/`);
  url.searchParams.set("_limit", String(args.limit));
  url.searchParams.set("_skip", String(skip));
  url.searchParams.set("_fields", fields.join(","));

  if (args.since) url.searchParams.set("date_created__gte", args.since);
  if (args.until) url.searchParams.set("date_created__lte", args.until);

  return url;
}

function normalizeTranscript(transcript) {
  if (!transcript || !Array.isArray(transcript.utterances)) return null;
  return {
    summary_text: transcript.summary_text || null,
    utterances: transcript.utterances.map((utterance) => ({
      speaker_label: utterance.speaker_label || null,
      speaker_side: utterance.speaker_side || null,
      start: utterance.start ?? null,
      end: utterance.end ?? null,
      text: utterance.text || ""
    }))
  };
}

function normalizeCall(call, args, closeContext = null) {
  const normalized = {
    id: call.id,
    lead_id: call.lead_id || null,
    contact_id: call.contact_id || null,
    user_id: call.user_id || null,
    user_name: call.user_name || null,
    direction: call.direction || null,
    disposition: call.disposition || null,
    duration_seconds: call.duration ?? null,
    activity_at: call.activity_at || null,
    date_created: call.date_created || null,
    date_updated: call.date_updated || null,
    status: call.status || null,
    outcome_id: call.outcome_id || null,
    source: call.source || null,
    recording_transcript: normalizeTranscript(call.recording_transcript),
    voicemail_transcript: normalizeTranscript(call.voicemail_transcript)
  };

  if (args.includeNotes) normalized.note = call.note || "";
  if (closeContext) normalized.close_context = closeContext;
  if (args.includeRecordingUrl) {
    normalized.recording_url = call.recording_url || null;
    normalized.voicemail_url = call.voicemail_url || null;
  }

  return normalized;
}

async function closeFetch(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(apiKey),
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Close API request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function checkAuth() {
  const apiKey = process.env.CLOSE_API_KEY;
  if (!apiKey) {
    throw new Error("CLOSE_API_KEY is not set in this shell or .env file.");
  }

  const payload = await closeFetch(new URL(`${API_BASE}/me/`), apiKey);
  console.log(JSON.stringify({
    ok: true,
    user_id: payload.id || null,
    organization_id: payload.organization_id || null,
    email: payload.email || null
  }, null, 2));
}

async function exportCalls(args) {
  const outPath = path.resolve(process.cwd(), args.out);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  const apiKey = process.env.CLOSE_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error("CLOSE_API_KEY is not set in this shell. Set it before running the export command.");
  }

  const salesFilterConfig = loadSalesFilterConfig();
  const leadCache = createLeadCacheSession();

  let skip = 0;
  let exported = 0;
  const lines = [];

  while (exported < args.max) {
    const url = buildUrl(args, skip);
    if (args.dryRun) {
      console.log(`DRY RUN ${url.toString()}`);
      return;
    }

    const payload = await closeFetch(url, apiKey);
    const calls = Array.isArray(payload.data) ? payload.data : [];

    for (const call of calls) {
      if (exported >= args.max) break;
      let closeContext = null;
      if (args.includeLeadEnrichment && call.lead_id) {
        const lead = await getLead(call.lead_id, apiKey, leadCache);
        closeContext = buildCloseContext(lead, {
          preferredPipelines: salesFilterConfig.includePipelineNames || []
        });
      }
      lines.push(JSON.stringify(normalizeCall(call, args, closeContext)));
      exported += 1;
    }

    if (!payload.has_more || calls.length === 0) break;
    skip += args.limit;
  }

  flushLeadCache(leadCache);
  fs.writeFileSync(outPath, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  console.log(`Exported ${exported} calls to ${outPath}${args.includeLeadEnrichment ? ` with ${leadCache.fetched} lead fetches` : ""}`);
}

function printUsage() {
  console.log(`Usage: node scripts/close-export-calls.mjs [--check-auth] [options]\n\nOptions:\\n  --check-auth                   Verify the API key against Close and print account metadata only.\\n  --since <ISO date>             Include calls created at or after this value.\n  --until <ISO date>             Include calls created at or before this value.\n  --limit <1-100>                Page size. Default: 100.\n  --max <number>                 Maximum calls to export. Default: 500.\n  --out <path>                   Output JSONL path. Default: data/close/calls.jsonl.\n  --dry-run                      Print the request URL and do not call the API.\n  --exclude-lead-enrichment      Skip lead/opportunity enrichment and export raw call activity only.\n  --include-recording-url        Include recording/voicemail URLs. Off by default.\n  --exclude-notes                Exclude call notes from export.\n\nEnvironment:\n  CLOSE_API_KEY                  Required. Close API key. Never commit it.`);
}

try {
  loadLocalEnv();

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
  } else if (process.argv.includes("--check-auth")) {
    await checkAuth();
  } else {
    await exportCalls(parseArgs(process.argv.slice(2)));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
