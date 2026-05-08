import fs from "node:fs";
import path from "node:path";

export const ROOT = /* turbopackIgnore: true */ process.cwd();
export const API_BASE = "https://api.close.com/api/v1";
export const COACH_TIMEZONE = process.env.COACH_TIMEZONE || "America/New_York";

export function loadLocalEnv(root = ROOT) {
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

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function appendJsonl(filePath, rows) {
  ensureDir(path.dirname(filePath));
  if (!rows.length) return;
  fs.appendFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function sanitizeFileName(name) {
  return String(name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function formatDateInTimeZone(date, timeZone = COACH_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function getTimeParts(date, timeZone = COACH_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function isBusinessHour(date = new Date(), timeZone = COACH_TIMEZONE) {
  const { weekday, hour } = getTimeParts(date, timeZone);
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && hour >= 6 && hour < 18;
}

export function toIso(date) {
  return date.toISOString();
}

export function getHourlyWindow({ now = new Date(), lookbackMinutes = 75 } = {}) {
  const until = now;
  const since = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  return { since: toIso(since), until: toIso(until), lookbackMinutes };
}

export function getDailyEasternWindow(day = new Date(), timeZone = COACH_TIMEZONE) {
  const localDate = formatDateInTimeZone(day, timeZone);
  return {
    localDate,
    since: `${localDate}T06:00:00-04:00`,
    until: `${localDate}T18:00:00-04:00`
  };
}

export function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

export async function closeFetch(url, apiKey) {
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

export function normalizeTranscript(transcript) {
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

export function normalizeCall(call) {
  return {
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
    note: call.note || "",
    recording_transcript: normalizeTranscript(call.recording_transcript),
    voicemail_transcript: normalizeTranscript(call.voicemail_transcript)
  };
}

const CALL_FIELDS = [
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

export async function fetchCloseCalls({ since, until, max = 1000, limit = 100 }) {
  const apiKey = process.env.CLOSE_API_KEY;
  if (!apiKey) throw new Error("CLOSE_API_KEY is not set in this shell or .env file.");

  let skip = 0;
  const output = [];

  while (output.length < max) {
    const url = new URL(`${API_BASE}/activity/call/`);
    url.searchParams.set("_limit", String(limit));
    url.searchParams.set("_skip", String(skip));
    url.searchParams.set("_fields", CALL_FIELDS.join(","));
    if (since) url.searchParams.set("date_created__gte", since);
    if (until) url.searchParams.set("date_created__lte", until);

    const payload = await closeFetch(url, apiKey);
    const calls = Array.isArray(payload.data) ? payload.data : [];
    for (const call of calls) {
      if (output.length >= max) break;
      output.push(normalizeCall(call));
    }

    if (!payload.has_more || calls.length === 0) break;
    skip += limit;
  }

  return output;
}

export function isSubstantiveConnectedCall(call, minDurationSeconds = 120) {
  return call.status === "completed" && (call.duration_seconds || 0) >= minDurationSeconds && !!call.recording_transcript;
}

export function transcriptText(call, maxChars = 24000) {
  const utterances = call.recording_transcript?.utterances || [];
  const text = utterances
    .map((utterance) => `${utterance.speaker_side || "unknown"}: ${utterance.text}`)
    .join("\n");
  return text.slice(0, maxChars);
}

export function textMatches(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function clampScore(value) {
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function average(numbers) {
  const valid = numbers.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
