import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, calls, callScorecards, complianceFlags, reportArtifacts } from "../../src/db/schema";

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
  scores: Record<string, number>;
  overall_score: number;
  top_strength: string;
  biggest_coaching_opportunity: string;
  next_call_focus: string;
  compliance_flags?: string[];
  evidence_summary?: Record<string, unknown>;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const defaultPath = path.join(process.cwd(), "data", "coach", "codex-review", "2026-05-06-over-10min", "codex-scorecards.jsonl");
  return {
    file: fileIndex >= 0 ? args[fileIndex + 1] : defaultPath,
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

function emailForRep(scorecard: Scorecard) {
  const source = scorecard.rep_name || scorecard.rep_id || "unknown-rep";
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
      displayName: scorecard.rep_name || "Unknown Rep",
      role: "rep",
      closeUserId: scorecard.rep_id || null,
      active: true
    })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: {
        displayName: scorecard.rep_name || "Unknown Rep",
        closeUserId: scorecard.rep_id || null,
        active: true
      }
    })
    .returning({ id: appUsers.id });
  return inserted[0].id;
}

async function importScorecard(scorecard: Scorecard) {
  const db = getDb();
  const repUserId = await upsertRep(scorecard);
  const activityAt = new Date(scorecard.activity_at || scorecard.date_created || Date.now());

  const insertedCall = await db
    .insert(calls)
    .values({
      closeCallId: scorecard.call_id,
      leadId: scorecard.lead_id || null,
      contactId: null,
      repUserId,
      closeUserId: scorecard.rep_id || null,
      activityAt,
      durationSeconds: Math.round(scorecard.duration_seconds || (scorecard.duration_minutes || 0) * 60),
      direction: scorecard.direction || null,
      status: scorecard.status || null,
      disposition: null,
      summaryText: String(scorecard.evidence_summary?.concise_call_readout || "")
    })
    .onConflictDoUpdate({
      target: calls.closeCallId,
      set: {
        repUserId,
        closeUserId: scorecard.rep_id || null,
        activityAt,
        durationSeconds: Math.round(scorecard.duration_seconds || (scorecard.duration_minutes || 0) * 60),
        summaryText: String(scorecard.evidence_summary?.concise_call_readout || "")
      }
    })
    .returning({ id: calls.id });

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
      leadSegment: scorecard.lead_segment || null,
      topStrength: scorecard.top_strength,
      biggestCoachingOpportunity: scorecard.biggest_coaching_opportunity,
      nextCallFocus: scorecard.next_call_focus,
      evidenceSummaryJson: scorecard.evidence_summary || {}
    })
    .onConflictDoUpdate({
      target: callScorecards.callId,
      set: {
        graderProvider: scorecard.grader_provider,
        overallScore: String(scorecard.overall_score),
        nextCallFocus: scorecard.next_call_focus,
        evidenceSummaryJson: scorecard.evidence_summary || {}
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

async function main() {
  const args = parseArgs();
  const scorecards = readJsonl(args.file);
  for (const scorecard of scorecards) {
    await importScorecard(scorecard);
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

  console.log(JSON.stringify({ ok: true, imported_scorecards: scorecards.length, file: args.file }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
