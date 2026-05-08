import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, callOutcomes, calls, callScorecards, complianceFlags, reportArtifacts } from "../../src/db/schema";

type Scorecard = {
  grader_provider: string;
  call_id: string;
  lead_id?: string;
  rep_id?: string;
  rep_name?: string;
  direction?: string;
  status?: string;
  activity_at?: string;
  date_created?: string;
  duration_seconds?: number;
  duration_minutes?: number;
  lead_segment?: string;
  call_type?: string;
  outcome_type?: string;
  outcome_rationale?: string;
  model_name?: string;
  prompt_version?: string;
  profile_version?: string;
  scores: Record<string, number>;
  overall_score: number;
  top_strength: string;
  biggest_coaching_opportunity: string;
  next_call_focus: string;
  focus_dimension?: string;
  coachable_moment?: Record<string, unknown>;
  manager_coaching_note?: string;
  manager_action?: Record<string, unknown>;
  success_pattern?: Record<string, unknown>;
  rep_practice_drill?: string;
  compliance_flags?: string[];
  evidence_summary?: Record<string, unknown>;
};

type ExportedCloseCall = {
  id: string;
  contact_id?: string | null;
  disposition?: string | null;
  source?: string | null;
  close_context?: Record<string, unknown> | null;
  sales_filter?: { lead?: Record<string, unknown> | null } | null;
};

const salesReps = [
  "Bryton",
  "Josh",
  "Jen",
  "Janay",
  "Tanner",
  "Jonathan",
  "Shea",
  "Colton",
  "Greg",
  "Chris",
  "Alec"
];

function parseArgs() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const callsFileIndex = args.indexOf("--calls-file");
  const defaultPath = path.join(process.cwd(), "data", "coach", "codex-review", "2026-05-06-over-10min", "codex-scorecards.jsonl");
  return {
    file: fileIndex >= 0 ? args[fileIndex + 1] : defaultPath,
    callsFile: callsFileIndex >= 0 ? args[callsFileIndex + 1] : null,
    date: args.includes("--date") ? args[args.indexOf("--date") + 1] : "2026-05-06"
  };
}

function readJsonl(filePath: string): Scorecard[] {
  if (!fs.existsSync(filePath)) throw new Error(`Scorecard file does not exist: ${filePath}`);
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Scorecard);
}

function readCloseCallExports(filePath: string | null): ExportedCloseCall[] {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) throw new Error(`Close calls export does not exist: ${filePath}`);
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExportedCloseCall);
}

function buildCallIndex(rows: ExportedCloseCall[]) {
  return new Map(rows.filter((row) => row?.id).map((row) => [row.id, row]));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resolveCloseContext(scorecard: Scorecard, exportedCall: ExportedCloseCall | null) {
  const salesFilterLead = asObject(exportedCall?.sales_filter?.lead);
  return (
    asObject(scorecard.evidence_summary?.close_context) ||
    asObject(exportedCall?.close_context) ||
    (salesFilterLead
      ? {
          lead: {
            id: salesFilterLead.id || null,
            name: salesFilterLead.name || null,
            status_id: salesFilterLead.status_id || null,
            status_label: salesFilterLead.status_label || null
          },
          custom: asObject(salesFilterLead.custom) || {},
          opportunities: Array.isArray(salesFilterLead.opportunities) ? salesFilterLead.opportunities : [],
          opportunity_summary: asObject(salesFilterLead.opportunity_summary) || null
        }
      : null)
  );
}

function primaryOpportunity(closeContext: Record<string, unknown> | null) {
  const summary = asObject(closeContext?.opportunity_summary);
  const primary = asObject(summary?.primary_opportunity);
  if (primary) return primary;
  const opportunities = Array.isArray(closeContext?.opportunities) ? closeContext.opportunities : [];
  return asObject(opportunities[0]) || null;
}

function asDateOnly(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 10);
}

function canonicalRepName(scorecard: Scorecard) {
  const source = scorecard.rep_name || scorecard.rep_id || "Unknown Rep";
  const normalized = source.toLowerCase();
  return salesReps.find((name) => normalized.startsWith(name.toLowerCase())) || source;
}

function emailForRep(scorecard: Scorecard) {
  const source = canonicalRepName(scorecard);
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "");
  return `${slug}@enhancify.example`;
}

async function upsertRep(scorecard: Scorecard) {
  const db = getDb();
  const email = emailForRep(scorecard);
  const inserted = await db
    .insert(appUsers)
    .values({
      email,
      displayName: canonicalRepName(scorecard),
      role: "rep",
      closeUserId: scorecard.rep_id || null,
      active: true
    })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: {
        displayName: canonicalRepName(scorecard),
        closeUserId: scorecard.rep_id || null,
        active: true
      }
    })
    .returning({ id: appUsers.id });
  return inserted[0].id;
}

async function importScorecard(scorecard: Scorecard, exportedCall: ExportedCloseCall | null = null) {
  const db = getDb();
  const repUserId = await upsertRep(scorecard);
  const activityAt = new Date(scorecard.activity_at || scorecard.date_created || Date.now());
  const closeContext = resolveCloseContext(scorecard, exportedCall);
  const evidenceSummaryBase: Record<string, unknown> = {
    ...(scorecard.evidence_summary || {}),
    coachable_moment: scorecard.coachable_moment || scorecard.evidence_summary?.coachable_moment || null,
    manager_coaching_note: scorecard.manager_coaching_note || scorecard.evidence_summary?.manager_coaching_note || null,
    manager_action: scorecard.manager_action || scorecard.evidence_summary?.manager_action || null,
    success_pattern: scorecard.success_pattern || scorecard.evidence_summary?.success_pattern || null,
    rep_practice_drill: scorecard.rep_practice_drill || scorecard.evidence_summary?.rep_practice_drill || null,
    focus_dimension: scorecard.focus_dimension || scorecard.evidence_summary?.focus_dimension || null,
    call_type: scorecard.call_type || scorecard.evidence_summary?.call_type || null,
    outcome_type: scorecard.outcome_type || scorecard.evidence_summary?.outcome_type || null,
    outcome_rationale: scorecard.outcome_rationale || scorecard.evidence_summary?.outcome_rationale || null
  };
  const evidenceSummary: Record<string, unknown> = closeContext
    ? { ...evidenceSummaryBase, close_context: closeContext }
    : evidenceSummaryBase;
  const callUpdateSet: {
    repUserId: string;
    closeUserId: string | null;
    activityAt: Date;
    durationSeconds: number;
    summaryText: string;
    callType: string | null;
    outcomeType: string | null;
    outcomeRationale: string | null;
    contactId?: string | null;
    disposition?: string | null;
  } = {
    repUserId,
    closeUserId: scorecard.rep_id || null,
    activityAt,
    durationSeconds: Math.round(scorecard.duration_seconds || (scorecard.duration_minutes || 0) * 60),
    summaryText: String(evidenceSummary.concise_call_readout || ""),
    callType: scorecard.call_type || (scorecard.evidence_summary?.call_type as string | undefined) || null,
    outcomeType: scorecard.outcome_type || (scorecard.evidence_summary?.outcome_type as string | undefined) || null,
    outcomeRationale:
      scorecard.outcome_rationale || (scorecard.evidence_summary?.outcome_rationale as string | undefined) || null
  };
  if (exportedCall) {
    callUpdateSet.contactId = exportedCall.contact_id || null;
    callUpdateSet.disposition = exportedCall.disposition || null;
  }

  const insertedCall = await db
    .insert(calls)
    .values({
      closeCallId: scorecard.call_id,
      leadId: scorecard.lead_id || null,
      contactId: exportedCall?.contact_id || null,
      repUserId,
      closeUserId: scorecard.rep_id || null,
      activityAt,
      durationSeconds: Math.round(scorecard.duration_seconds || (scorecard.duration_minutes || 0) * 60),
      direction: scorecard.direction || null,
      status: scorecard.status || null,
      disposition: exportedCall?.disposition || null,
      summaryText: String(evidenceSummary.concise_call_readout || ""),
      callType: scorecard.call_type || (scorecard.evidence_summary?.call_type as string | undefined) || null,
      outcomeType: scorecard.outcome_type || (scorecard.evidence_summary?.outcome_type as string | undefined) || null,
      outcomeRationale:
        scorecard.outcome_rationale || (scorecard.evidence_summary?.outcome_rationale as string | undefined) || null
    })
    .onConflictDoUpdate({
      target: calls.closeCallId,
      set: callUpdateSet
    })
    .returning({ id: calls.id });

  const opportunity = primaryOpportunity(closeContext);
  if (closeContext || opportunity) {
    await db
      .insert(callOutcomes)
      .values({
        callId: insertedCall[0].id,
        closeLeadId: scorecard.lead_id || (asObject(closeContext?.lead)?.id as string | undefined) || null,
        closeOpportunityId: (opportunity?.id as string | undefined) || null,
        pipelineName: (opportunity?.pipeline_name as string | undefined) || null,
        statusLabel: ((opportunity?.status_label || opportunity?.status_display_name) as string | undefined) || null,
        statusType: (opportunity?.status_type as string | undefined) || null,
        value: opportunity?.value === undefined || opportunity?.value === null ? null : String(opportunity.value),
        valuePeriod: (opportunity?.value_period as string | undefined) || null,
        won: Boolean(opportunity?.is_won || opportunity?.close_signal === "won"),
        lost: Boolean(opportunity?.is_lost || opportunity?.close_signal === "lost"),
        closeDate: asDateOnly(opportunity?.close_date),
        opportunityJson: closeContext || {}
      })
      .onConflictDoUpdate({
        target: callOutcomes.callId,
        set: {
          closeLeadId: scorecard.lead_id || (asObject(closeContext?.lead)?.id as string | undefined) || null,
          closeOpportunityId: (opportunity?.id as string | undefined) || null,
          pipelineName: (opportunity?.pipeline_name as string | undefined) || null,
          statusLabel: ((opportunity?.status_label || opportunity?.status_display_name) as string | undefined) || null,
          statusType: (opportunity?.status_type as string | undefined) || null,
          value: opportunity?.value === undefined || opportunity?.value === null ? null : String(opportunity.value),
          valuePeriod: (opportunity?.value_period as string | undefined) || null,
          won: Boolean(opportunity?.is_won || opportunity?.close_signal === "won"),
          lost: Boolean(opportunity?.is_lost || opportunity?.close_signal === "lost"),
          closeDate: asDateOnly(opportunity?.close_date),
          opportunityJson: closeContext || {},
          refreshedAt: new Date()
        }
      });
  }

  const insertedScorecard = await db
    .insert(callScorecards)
    .values({
      callId: insertedCall[0].id,
      graderProvider: scorecard.grader_provider,
      overallScore: String(scorecard.overall_score),
      openingScore: String(scorecard.scores.opening),
      qualificationScore: String(scorecard.scores.qualification),
      discoveryScore: String(scorecard.scores.discovery),
      quantificationScore: String(scorecard.scores.quantification),
      solutionToPainScore: String(scorecard.scores.solution_to_pain),
      featureDumpControlScore: String(scorecard.scores.feature_dump_control),
      closeOrNextStepScore: String(scorecard.scores.close_or_next_step),
      complianceScore: String(scorecard.scores.compliance),
      modelName: scorecard.model_name || (scorecard.evidence_summary?.model_name as string | undefined) || null,
      promptVersion: scorecard.prompt_version || (scorecard.evidence_summary?.prompt_version as string | undefined) || null,
      profileVersion: scorecard.profile_version || (scorecard.evidence_summary?.profile_version as string | undefined) || null,
      focusDimension: scorecard.focus_dimension || (scorecard.evidence_summary?.focus_dimension as string | undefined) || null,
      callType: scorecard.call_type || (scorecard.evidence_summary?.call_type as string | undefined) || null,
      outcomeType: scorecard.outcome_type || (scorecard.evidence_summary?.outcome_type as string | undefined) || null,
      outcomeRationale:
        scorecard.outcome_rationale || (scorecard.evidence_summary?.outcome_rationale as string | undefined) || null,
      leadSegment: scorecard.lead_segment || null,
      topStrength: scorecard.top_strength,
      biggestCoachingOpportunity: scorecard.biggest_coaching_opportunity,
      nextCallFocus: scorecard.next_call_focus,
      evidenceSummaryJson: evidenceSummary
    })
    .onConflictDoUpdate({
      target: callScorecards.callId,
      set: {
        graderProvider: scorecard.grader_provider,
        overallScore: String(scorecard.overall_score),
        modelName: scorecard.model_name || (scorecard.evidence_summary?.model_name as string | undefined) || null,
        promptVersion: scorecard.prompt_version || (scorecard.evidence_summary?.prompt_version as string | undefined) || null,
        profileVersion: scorecard.profile_version || (scorecard.evidence_summary?.profile_version as string | undefined) || null,
        focusDimension: scorecard.focus_dimension || (scorecard.evidence_summary?.focus_dimension as string | undefined) || null,
        callType: scorecard.call_type || (scorecard.evidence_summary?.call_type as string | undefined) || null,
        outcomeType: scorecard.outcome_type || (scorecard.evidence_summary?.outcome_type as string | undefined) || null,
        outcomeRationale:
          scorecard.outcome_rationale || (scorecard.evidence_summary?.outcome_rationale as string | undefined) || null,
        nextCallFocus: scorecard.next_call_focus,
        evidenceSummaryJson: evidenceSummary
      }
    })
    .returning({ id: callScorecards.id });

  await db.delete(complianceFlags).where(eq(complianceFlags.callScorecardId, insertedScorecard[0].id));
  if (scorecard.compliance_flags?.length) {
    await db.insert(complianceFlags).values(
      scorecard.compliance_flags.map((flag) => ({
        callScorecardId: insertedScorecard[0].id,
        flag,
        severity: "medium"
      }))
    );
  }
}

export type ImportScorecardsOptions = {
  file: string;
  callsFile?: string | null;
  date: string;
};

export async function importScorecardsFile(args: ImportScorecardsOptions) {
  const scorecards = readJsonl(args.file);
  const closeCalls = readCloseCallExports(args.callsFile || null);
  const callIndex = buildCallIndex(closeCalls);
  for (const scorecard of scorecards) {
    await importScorecard(scorecard, callIndex.get(scorecard.call_id) || null);
  }

  const db = getDb();
  await db
    .insert(reportArtifacts)
    .values({
      reportType: "coaching_packet",
      periodType: "daily",
      periodStart: args.date,
      periodEnd: args.date,
      storagePath: `output/pdf/daily/${args.date}/codex-over-10min/daily-coaching-packet.pdf`,
      contentMarkdown: null
    })
    .onConflictDoNothing();

  return {
    ok: true,
    imported_scorecards: scorecards.length,
    file: args.file,
    calls_file: args.callsFile,
    matched_close_calls: scorecards.filter((scorecard) => callIndex.has(scorecard.call_id)).length
  };
}

async function main() {
  const args = parseArgs();
  const result = await importScorecardsFile(args);
  console.log(JSON.stringify(result, null, 2));
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
