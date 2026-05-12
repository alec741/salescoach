import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "../src/db/client";
import { appUsers, deliveryEvents, reportArtifactEvents, reportArtifacts } from "../src/db/schema";
import { loadSlackRepTargets, resolveSlackRepTarget, type SlackRepTargetMap } from "../src/lib/slack-targets";
import { isSlackConfigured, postSlackMessage } from "../src/lib/slack";
import type { PeriodType } from "../src/lib/types";

type SupportedPeriod = PeriodType;
type SummaryAudience = "manager" | "rep";
type DeliveryStatus = "failed" | "sent" | "skipped";

type Args = {
  audience: SummaryAudience;
  channel: string | null;
  date: string;
  dryRun: boolean;
  period: SupportedPeriod;
  rep: string | null;
};

type SummaryPayload = {
  artifactId: string | null;
  audience: SummaryAudience;
  closeUserId?: string | null;
  contentMarkdown: string;
  managerUserId?: string | null;
  pdfArtifactId?: string | null;
  pdfStoragePath?: string | null;
  periodEnd: string;
  periodStart: string;
  repEmail?: string | null;
  repName?: string | null;
  repUserId?: string | null;
  source: "database" | "local_file";
  title: string;
};

type DeliveryAttempt = {
  destination: string | null;
  externalId?: string | null;
  matchedBy?: "appUserId" | "closeUserId" | "email" | null;
  message: string;
  status: DeliveryStatus;
  summary: SummaryPayload;
};

const ROOT = process.cwd();
const COACH_TIMEZONE = process.env.COACH_TIMEZONE || "America/New_York";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    audience: "manager",
    channel: null,
    date: currentCoachDate(),
    dryRun: Boolean(process.env.npm_config_dry_run),
    period: "daily",
    rep: null
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--audience":
        if (next !== "manager" && next !== "rep") {
          throw new Error(`Unsupported audience: ${next}`);
        }
        args.audience = next;
        index += 1;
        break;
      case "--channel":
        args.channel = next;
        index += 1;
        break;
      case "--date":
        args.date = next;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--period":
        if (next !== "daily" && next !== "weekly" && next !== "monthly" && next !== "quarterly") {
          throw new Error(`Unsupported period: ${next}`);
        }
        args.period = next;
        index += 1;
        break;
      case "--rep":
        args.rep = next?.trim() || null;
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
        positionals.push(arg);
    }
  }

  if (positionals[0]) {
    if (positionals[0] !== "daily" && positionals[0] !== "weekly" && positionals[0] !== "monthly" && positionals[0] !== "quarterly") {
      throw new Error(`Unsupported period: ${positionals[0]}`);
    }
    args.period = positionals[0];
  }
  if (positionals[1]) args.date = positionals[1];

  return args;
}

function loadLocalEnv(root = ROOT) {
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

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function formatDateInTimeZone(date: Date, timeZone = COACH_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function currentCoachDate(now = new Date()) {
  return formatDateInTimeZone(now, COACH_TIMEZONE);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`Expected ISO date YYYY-MM-DD, received: ${value}`);
  }
  return new Date(`${value}T12:00:00.000Z`);
}

function periodRange(anchor: string, periodType: SupportedPeriod) {
  const date = parseIsoDate(anchor);

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
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1, 12));
  const end = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0, 12));
  return { periodStart: isoDate(start), periodEnd: isoDate(end) };
}

function summaryTitle(
  audience: SummaryAudience,
  period: SupportedPeriod,
  periodStart: string,
  periodEnd: string,
  repName?: string | null
) {
  const prefix =
    audience === "manager"
      ? `${period.charAt(0).toUpperCase()}${period.slice(1)} manager coaching summary`
      : `${period.charAt(0).toUpperCase()}${period.slice(1)} rep coaching summary${repName ? ` for ${repName}` : ""}`;
  return period === "daily" ? `${prefix} for ${periodStart}` : `${prefix} for ${periodStart} to ${periodEnd}`;
}

function normalizeMarkdownForSlack(markdown: string) {
  return markdown
    .replace(/^###\s+(.*)$/gm, "*$1*")
    .replace(/^##\s+(.*)$/gm, "*$1*")
    .replace(/^#\s+(.*)$/gm, "*$1*")
    .replace(/\r/g, "")
    .trim();
}

function toPlainText(markdown: string) {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .trim();
}

function firstMatch(markdown: string, pattern: RegExp) {
  return markdown.match(pattern)?.[1]?.trim() || "";
}

function sentenceLimit(value: string, limit = 260) {
  const text = toPlainText(value).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("? "), clipped.lastIndexOf("! "));
  return `${clipped.slice(0, sentenceEnd > 90 ? sentenceEnd + 1 : limit - 1).trim()}...`;
}

function parseRepSnapshots(markdown: string) {
  const reps: Array<{ name: string; calls: string; score: string; pattern: string }> = [];
  const pattern = /^###\s+(.+?)\s+\((\d+)\s+calls?,\s+([\d.]+)\s+avg\)\s*\n+([\s\S]*?)(?=^###\s+|\n---|\n##\s+|$)/gm;
  for (const match of markdown.matchAll(pattern)) {
    const body = match[4] || "";
    const repPattern = firstMatch(body, /\*\*Pattern:\*\*\s*([\s\S]*?)(?=\n\n\*\*|\n\n---|$)/);
    reps.push({
      name: match[1].trim(),
      calls: match[2].trim(),
      score: match[3].trim(),
      pattern: sentenceLimit(repPattern, 150)
    });
  }

  return reps.sort((left, right) => Number(left.score) - Number(right.score)).slice(0, 4);
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
}

function reportUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/manager/reports` : null;
}

function pdfUrl(summary: SummaryPayload) {
  const baseUrl = appBaseUrl();
  if (!baseUrl || !summary.pdfArtifactId) return null;
  const secret = process.env.REPORT_LINK_SECRET || process.env.CRON_SECRET || process.env.NEON_AUTH_COOKIE_SECRET || "";
  const token = secret
    ? crypto.createHmac("sha256", secret).update(`report-pdf:${summary.pdfArtifactId}`).digest("hex")
    : "";
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : "";
  return `${baseUrl}/api/reports/pdf?id=${encodeURIComponent(summary.pdfArtifactId)}${tokenQuery}&download=1`;
}

function buildManagerDigestBlocks(summary: SummaryPayload) {
  const markdown = summary.contentMarkdown;
  const teamPerformance = sentenceLimit(firstMatch(markdown, /\*\*Team Performance:\*\*\s*([\s\S]*?)(?=\n\n\*\*|\n\n---|$)/), 300);
  const primaryFocus = sentenceLimit(firstMatch(markdown, /\*\*Primary Focus:\*\*\s*([\s\S]*?)(?=\n\n---|\n\n##|$)/), 360);
  const dayPattern = sentenceLimit(firstMatch(markdown, /##\s+The Pattern Across All Calls\s+([\s\S]*?)(?=\n\n\*\*What should happen:\*\*|\n\n---|\n\n##|$)/), 280);
  const reps = parseRepSnapshots(markdown);
  const pdfHref = pdfUrl(summary);
  const reportsHref = reportUrl();
  const actionElements = [
    ...(pdfHref ? [{ type: "button", text: { type: "plain_text", text: "Open full PDF" }, url: pdfHref, style: "primary" }] : []),
    ...(reportsHref ? [{ type: "button", text: { type: "plain_text", text: "Open reports" }, url: reportsHref }] : [])
  ];
  const repLines = reps.length
    ? reps.map((rep) => `*${rep.name}* - ${rep.score}/10, ${rep.calls} call${rep.calls === "1" ? "" : "s"}: ${rep.pattern}`).join("\n")
    : "No rep-level coaching actions were available in this summary.";

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Daily manager coaching brief - ${summary.periodStart}`,
        emoji: true
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: summary.pdfArtifactId ? "Quick Slack brief. Full PDF is linked below." : "Quick Slack brief. Full PDF will be linked once generated."
        }
      ]
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:bar_chart: Day breakdown*\n${teamPerformance || "No team performance summary was available."}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:rotating_light: Major red flag*\n${primaryFocus || dayPattern || "No major red flag was called out in the manager summary."}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:dart: Manager focus tomorrow*\n${dayPattern || "Use the full report to pick the highest-leverage coaching moment."}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:busts_in_silhouette: Reps to review first*\n${repLines}`
      }
    },
    ...(actionElements.length ? [{ type: "actions", elements: actionElements }] : [])
  ];
}

function chunkMrkdwn(text: string, limit = 2800) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }

    for (let start = 0; start < paragraph.length; start += limit) {
      chunks.push(paragraph.slice(start, start + limit));
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks;
}

async function getDbManagerSummary(period: SupportedPeriod, periodStart: string, periodEnd: string) {
  if (!hasDatabase) return null;

  const rows = await getDb()
    .select({
      contentMarkdown: reportArtifacts.contentMarkdown,
      id: reportArtifacts.id,
      managerUserId: reportArtifacts.managerUserId,
      storagePath: reportArtifacts.storagePath
    })
    .from(reportArtifacts)
    .where(
      and(
        eq(reportArtifacts.reportType, "manager_summary"),
        eq(reportArtifacts.periodType, period),
        eq(reportArtifacts.periodStart, periodStart),
        eq(reportArtifacts.periodEnd, periodEnd)
      )
    )
    .orderBy(desc(reportArtifacts.createdAt))
    .limit(10);

  const row = rows.find((item) => item.contentMarkdown?.trim()) || rows[0];
  const pdfRow = rows.find((item) => item.storagePath?.trim());
  if (!row?.contentMarkdown?.trim()) return null;

  return {
    artifactId: row.id,
    audience: "manager" as const,
    contentMarkdown: row.contentMarkdown,
    managerUserId: row.managerUserId,
    pdfArtifactId: pdfRow?.id || null,
    pdfStoragePath: pdfRow?.storagePath || null,
    periodEnd,
    periodStart,
    source: "database" as const,
    title: summaryTitle("manager", period, periodStart, periodEnd)
  };
}

async function getDbRepSummaries(period: SupportedPeriod, periodStart: string, periodEnd: string, repFilter?: string | null) {
  if (!hasDatabase) {
    throw new Error("Rep summary delivery requires DATABASE_URL and DB-backed report artifacts.");
  }

  const rows = await getDb()
    .select({
      closeUserId: appUsers.closeUserId,
      contentMarkdown: reportArtifacts.contentMarkdown,
      email: appUsers.email,
      id: reportArtifacts.id,
      repName: appUsers.displayName,
      repUserId: reportArtifacts.repUserId
    })
    .from(reportArtifacts)
    .innerJoin(appUsers, eq(appUsers.id, reportArtifacts.repUserId))
    .where(
      and(
        eq(reportArtifacts.reportType, "rep_summary"),
        eq(reportArtifacts.periodType, period),
        eq(reportArtifacts.periodStart, periodStart),
        eq(reportArtifacts.periodEnd, periodEnd)
      )
    )
    .orderBy(asc(appUsers.displayName), desc(reportArtifacts.createdAt));

  const summariesByRep = new Map<string, SummaryPayload>();
  for (const row of rows) {
    if (!row.repUserId || summariesByRep.has(row.repUserId) || !row.contentMarkdown?.trim()) continue;
    summariesByRep.set(row.repUserId, {
      artifactId: row.id,
      audience: "rep",
      closeUserId: row.closeUserId,
      contentMarkdown: row.contentMarkdown,
      periodEnd,
      periodStart,
      repEmail: row.email,
      repName: row.repName,
      repUserId: row.repUserId,
      source: "database",
      title: summaryTitle("rep", period, periodStart, periodEnd, row.repName)
    });
  }

  const summaries = Array.from(summariesByRep.values());
  const filtered = repFilter ? summaries.filter((summary) => matchesRepFilter(summary, repFilter)) : summaries;
  if (!filtered.length) {
    throw new Error(
      repFilter
        ? `No rep summary found for "${repFilter}" in ${periodStart} to ${periodEnd}.`
        : `No rep summaries found for ${periodStart} to ${periodEnd}.`
    );
  }

  return filtered;
}

function getLocalDailySummary(date: string) {
  const localPath = path.join(ROOT, "reports", "daily", date, "manager-summary.md");
  if (!fs.existsSync(localPath)) return null;

  return {
    artifactId: null,
    audience: "manager" as const,
    contentMarkdown: fs.readFileSync(localPath, "utf8"),
    periodEnd: date,
    periodStart: date,
    source: "local_file" as const,
    title: summaryTitle("manager", "daily", date, date)
  };
}

async function loadSummaries(args: Args): Promise<SummaryPayload[]> {
  const { periodStart, periodEnd } = periodRange(args.date, args.period);

  if (args.audience === "rep") {
    return getDbRepSummaries(args.period, periodStart, periodEnd, args.rep);
  }

  const dbSummary = await getDbManagerSummary(args.period, periodStart, periodEnd);
  if (dbSummary) return [dbSummary];

  if (args.period === "daily") {
    const localSummary = getLocalDailySummary(args.date);
    if (localSummary) return [localSummary];
  }

  throw new Error(`No manager summary found for ${args.period} period ${periodStart} to ${periodEnd}.`);
}

function buildBlocks(summary: SummaryPayload) {
  if (summary.audience === "manager") {
    return buildManagerDigestBlocks(summary);
  }

  const body = normalizeMarkdownForSlack(summary.contentMarkdown);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: summary.title.slice(0, 150),
        emoji: true
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            summary.periodStart === summary.periodEnd
              ? `Audience: ${summary.audience} | Period: ${summary.periodStart} | Source: ${summary.source}`
              : `Audience: ${summary.audience} | Period: ${summary.periodStart} to ${summary.periodEnd} | Source: ${summary.source}`
        }
      ]
    },
    { type: "divider" }
  ];

  for (const chunk of chunkMrkdwn(body).slice(0, 10)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: chunk
      }
    });
  }

  return blocks;
}

function matchesRepFilter(summary: SummaryPayload, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;

  return [summary.repUserId, summary.repEmail, summary.closeUserId]
    .map((value) => (value || "").trim().toLowerCase())
    .filter(Boolean)
    .includes(query);
}

function resolveDestination(args: Args, summary: SummaryPayload, repTargets: SlackRepTargetMap) {
  if (summary.audience === "manager") {
    const destination = args.channel || process.env.SLACK_MANAGER_CHANNEL_ID || null;
    if (!destination) {
      throw new Error("SLACK_MANAGER_CHANNEL_ID is required unless --channel is provided.");
    }
    return { destination, matchedBy: null };
  }

  if (args.channel) {
    throw new Error("--channel is only supported for manager summary delivery.");
  }

  const target = resolveSlackRepTarget(
    {
      appUserId: summary.repUserId,
      closeUserId: summary.closeUserId,
      email: summary.repEmail
    },
    repTargets
  );

  return target
    ? {
        destination: target.destination,
        matchedBy: target.matchedBy
      }
    : { destination: null, matchedBy: null };
}

async function recordSlackEvent(attempt: DeliveryAttempt) {
  if (!hasDatabase) return;

  const destination = attempt.destination || null;
  await getDb().insert(deliveryEvents).values({
    channel: "slack",
    audience: attempt.summary.audience,
    status: attempt.status,
    reportArtifactId: attempt.summary.artifactId,
    repUserId: attempt.summary.repUserId || null,
    managerUserId: attempt.summary.managerUserId || null,
    destination,
    externalId: attempt.externalId || null,
    payloadJson: {
      close_user_id: attempt.summary.closeUserId || null,
      matched_by: attempt.matchedBy || null,
      period_end: attempt.summary.periodEnd,
      period_start: attempt.summary.periodStart,
      rep_email: attempt.summary.repEmail || null,
      rep_name: attempt.summary.repName || null,
      source: attempt.summary.source,
      title: attempt.summary.title
    },
    errorMessage: attempt.status === "sent" ? null : attempt.message,
    sentAt: attempt.status === "sent" ? new Date() : null
  });

  if (attempt.status !== "sent" || !attempt.summary.artifactId) return;

  await getDb().insert(reportArtifactEvents).values({
    reportArtifactId: attempt.summary.artifactId,
    actorUserId: null,
    eventType: "slack_sent",
    message: `Delivered ${attempt.summary.title} to Slack destination ${destination}.`
  });
}

async function sendSummary(summary: SummaryPayload, args: Args, repTargets: SlackRepTargetMap): Promise<DeliveryAttempt> {
  const resolved = resolveDestination(args, summary, repTargets);
  if (!resolved.destination) {
    return {
      destination: null,
      matchedBy: resolved.matchedBy,
      message: `No Slack target configured for ${summary.repName || summary.repEmail || summary.repUserId || "rep summary"}.`,
      status: "skipped",
      summary
    };
  }

  const text = toPlainText(summary.contentMarkdown).slice(0, 1200);
  const blocks = buildBlocks(summary);
  const slack = await postSlackMessage({
    channel: resolved.destination,
    text: `${summary.title}\n\n${text}`,
    blocks
  });

  if (!slack.ok) {
    return {
      destination: slack.channel || resolved.destination,
      externalId: slack.ts ? `${slack.channel || resolved.destination}:${slack.ts}` : null,
      matchedBy: resolved.matchedBy,
      message: slack.message,
      status: "failed",
      summary
    };
  }

  return {
    destination: slack.channel || resolved.destination,
    externalId: slack.ts ? `${slack.channel || resolved.destination}:${slack.ts}` : null,
    matchedBy: resolved.matchedBy,
    message: slack.message,
    status: "sent",
    summary
  };
}

function summarizeAttempt(attempt: DeliveryAttempt) {
  return {
    artifactId: attempt.summary.artifactId,
    audience: attempt.summary.audience,
    destination: attempt.destination,
    matchedBy: attempt.matchedBy || null,
    message: attempt.message,
    periodEnd: attempt.summary.periodEnd,
    periodStart: attempt.summary.periodStart,
    repEmail: attempt.summary.repEmail || null,
    repName: attempt.summary.repName || null,
    repUserId: attempt.summary.repUserId || null,
    source: attempt.summary.source,
    status: attempt.status,
    title: attempt.summary.title
  };
}

export async function deliverSummaryToSlack(input: Partial<Args> = {}) {
  loadLocalEnv();
  const args: Args = {
    audience: input.audience || "manager",
    channel: input.channel ?? null,
    date: input.date || currentCoachDate(),
    dryRun: input.dryRun ?? false,
    period: input.period || "daily",
    rep: input.rep ?? null
  };
  const repTargets = args.audience === "rep" ? loadSlackRepTargets(ROOT) : {};

  if (!isSlackConfigured()) {
    throw new Error("SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN is required.");
  }
  if (args.audience === "rep" && !Object.keys(repTargets).length) {
    throw new Error("Rep summary delivery requires SLACK_REP_TARGETS_FILE or SLACK_REP_TARGETS_JSON.");
  }

  const summaries = await loadSummaries(args);
  if (args.dryRun) {
    const preview = summaries.map((summary) => {
      const resolved = resolveDestination(args, summary, repTargets);
      return {
        artifactId: summary.artifactId,
        audience: summary.audience,
        destination: resolved.destination,
        matchedBy: resolved.matchedBy || null,
        periodEnd: summary.periodEnd,
        periodStart: summary.periodStart,
        preview: toPlainText(summary.contentMarkdown).slice(0, 300),
        repEmail: summary.repEmail || null,
        repName: summary.repName || null,
        repUserId: summary.repUserId || null,
        source: summary.source,
        title: summary.title
      };
    });

    return {
      audience: args.audience,
      deliveries: preview,
      dryRun: true,
      ok: true,
      period: args.period
    };
  }

  const attempts: DeliveryAttempt[] = [];
  for (const summary of summaries) {
    const attempt = await sendSummary(summary, args, repTargets);
    attempts.push(attempt);
    await recordSlackEvent(attempt);
  }

  const report = {
    audience: args.audience,
    deliveries: attempts.map(summarizeAttempt),
    failed: attempts.filter((attempt) => attempt.status === "failed").length,
    ok: attempts.every((attempt) => attempt.status === "sent"),
    period: args.period,
    sent: attempts.filter((attempt) => attempt.status === "sent").length,
    skipped: attempts.filter((attempt) => attempt.status === "skipped").length
  };

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await deliverSummaryToSlack(args);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
