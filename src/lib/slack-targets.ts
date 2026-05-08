import fs from "node:fs";
import path from "node:path";

export type SlackRepIdentity = {
  appUserId?: string | null;
  closeUserId?: string | null;
  email?: string | null;
};

export type SlackRepTargetMatch = {
  destination: string;
  matchedBy: "appUserId" | "closeUserId" | "email";
};

export type SlackRepTargetMap = Record<string, string>;

function normalizeKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function parseTargets(value: unknown, source: string): SlackRepTargetMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object mapping rep IDs or emails to Slack user IDs or channel IDs.`);
  }

  const targets: SlackRepTargetMap = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    const destination = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!key) continue;
    if (!destination) {
      throw new Error(`${source} entry "${rawKey}" must be a non-empty Slack destination string.`);
    }
    targets[key] = destination;
  }

  return targets;
}

function parseTargetJson(raw: string, source: string) {
  try {
    return parseTargets(JSON.parse(raw), source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Slack rep target config in ${source}: ${message}`);
  }
}

export function loadSlackRepTargets(root = process.cwd()): SlackRepTargetMap {
  const fileSetting = process.env.SLACK_REP_TARGETS_FILE?.trim() || process.env.SLACK_REP_TARGETS_PATH?.trim() || "";
  const envSetting = process.env.SLACK_REP_TARGETS_JSON?.trim() || "";

  let fileTargets: SlackRepTargetMap = {};
  if (fileSetting) {
    const resolved = path.isAbsolute(fileSetting) ? fileSetting : path.resolve(root, fileSetting);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Slack rep targets file not found: ${resolved}`);
    }
    fileTargets = parseTargetJson(fs.readFileSync(resolved, "utf8"), `SLACK_REP_TARGETS_FILE (${resolved})`);
  }

  const envTargets = envSetting ? parseTargetJson(envSetting, "SLACK_REP_TARGETS_JSON") : {};
  return {
    ...fileTargets,
    ...envTargets
  };
}

export function resolveSlackRepTarget(rep: SlackRepIdentity, targets: SlackRepTargetMap): SlackRepTargetMatch | null {
  const candidates: Array<{ key: string; matchedBy: SlackRepTargetMatch["matchedBy"] }> = [
    { key: normalizeKey(rep.appUserId), matchedBy: "appUserId" },
    { key: normalizeKey(rep.email), matchedBy: "email" },
    { key: normalizeKey(rep.closeUserId), matchedBy: "closeUserId" }
  ];

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const destination = targets[candidate.key];
    if (destination) {
      return {
        destination,
        matchedBy: candidate.matchedBy
      };
    }
  }

  return null;
}
