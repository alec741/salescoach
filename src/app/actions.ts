"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, hasDatabase } from "@/db/client";
import {
  appUsers,
  callReviews,
  calls,
  callScorecards,
  coachingActionItems,
  coachingSummaries,
  deliveryEvents,
  managerCoachingSessions,
  managerRepAssignments,
  reportArtifacts,
  reportArtifactEvents
} from "@/db/schema";
import { getCurrentAppUser } from "@/lib/data";
import { postSlackMessage } from "@/lib/slack";
import type { FeedbackEntityType, RubricKey, UserRole } from "@/lib/types";

type ActionResult = {
  ok: boolean;
  message: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const feedbackTableName = "coaching_feedback";
const feedbackTable = sql.raw(feedbackTableName);

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function asUuid(value: string | null | undefined) {
  return value && uuidPattern.test(value) ? value : null;
}

async function getActor(roleHint: UserRole = "manager") {
  if (!hasDatabase) return null;
  const user = await getCurrentAppUser(roleHint);
  return user || null;
}

async function authorize(allowedRoles: UserRole[], roleHint: UserRole = "manager") {
  const actor = await getActor(roleHint);
  const authIsConfigured = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
  if (authIsConfigured && !actor) {
    return { actor, result: { ok: false, message: "You must be signed in to perform this action." } };
  }
  if (actor && !allowedRoles.includes(actor.role)) {
    return { actor, result: { ok: false, message: "You do not have permission to perform this action." } };
  }
  return { actor, result: null };
}

async function canAccessRep(actor: Awaited<ReturnType<typeof getActor>>, repId: string | null | undefined) {
  const normalizedRepId = asUuid(repId);
  if (!actor || !normalizedRepId) return false;
  if (actor.role === "admin") return true;
  if (actor.role === "rep") return actor.id === normalizedRepId;
  const rows = await getDb()
    .select({ repUserId: managerRepAssignments.repUserId })
    .from(managerRepAssignments)
    .where(and(eq(managerRepAssignments.managerUserId, actor.id), eq(managerRepAssignments.repUserId, normalizedRepId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function repIdForCall(callId: string) {
  const rows = await getDb()
    .select({ repId: calls.repUserId })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  return rows[0]?.repId || null;
}

async function repIdForScorecard(scorecardId: string) {
  const rows = await getDb()
    .select({ repId: calls.repUserId })
    .from(callScorecards)
    .innerJoin(calls, eq(calls.id, callScorecards.callId))
    .where(eq(callScorecards.id, scorecardId))
    .limit(1);
  return rows[0]?.repId || null;
}

async function repIdForSummary(summaryId: string) {
  const rows = await getDb()
    .select({ repId: coachingSummaries.repUserId })
    .from(coachingSummaries)
    .where(eq(coachingSummaries.id, summaryId))
    .limit(1);
  return rows[0]?.repId || null;
}

function requireDatabase(): ActionResult | null {
  if (hasDatabase) return null;
  return {
    ok: false,
    message: "DATABASE_URL is not configured, so this action cannot persist yet."
  };
}

function revalidateAppPaths() {
  for (const path of ["/manager", "/rep", "/rep/calls", "/rep/summaries", "/manager/reports", "/settings/users"]) {
    revalidatePath(path);
  }
}

function revalidateCoachingPaths(repId?: string | null) {
  revalidateAppPaths();
  if (repId) revalidatePath(`/manager/reps/${repId}`);
}

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (((result as { rows?: T[] }).rows) || []) as T[];
  }
  return [];
}

async function feedbackTableExists() {
  const rows = rowsFromExecute<{ exists: boolean }>(
    await getDb().execute(sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = ${feedbackTableName}
      ) as "exists"
    `)
  );
  return Boolean(rows[0]?.exists);
}

function buildManagerSessionNotes(input: {
  focusDimension: RubricKey;
  actionText: string;
  whyItMatters?: string;
  managerNote?: string;
  suggestedFocusDimension?: RubricKey;
  suggestedActionText?: string;
}) {
  const normalizedSuggestedAction = normalizeText(input.suggestedActionText || input.actionText);
  const normalizedCurrentAction = normalizeText(input.actionText);
  const normalizedSuggestedDimension = input.suggestedFocusDimension || input.focusDimension;
  const focusDecision =
    normalizedSuggestedDimension === input.focusDimension && normalizedSuggestedAction === normalizedCurrentAction ? "accepted" : "edited";

  return {
    focusDecision,
    notes: JSON.stringify({
      focusDecision,
      whyItMatters: normalizeText(input.whyItMatters) || null,
      managerNote: normalizeText(input.managerNote) || null,
      suggestedFocusDimension: normalizedSuggestedDimension,
      suggestedActionText: normalizedSuggestedAction
    })
  };
}

export async function markCallReviewedAction(callId: string): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["rep", "manager", "admin"], "manager");
  if (result) return result;
  if (!(await canAccessRep(actor, await repIdForCall(callId)))) {
    return { ok: false, message: "You do not have access to review this call." };
  }
  const reviewerUserId = asUuid(actor?.id);
  const now = new Date();

  await db
    .insert(callReviews)
    .values({
      callId,
      reviewerUserId,
      status: "reviewed",
      reviewedAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: callReviews.callId,
      set: {
        reviewerUserId,
        status: "reviewed",
        reviewedAt: now,
        updatedAt: now
      }
    });

  revalidatePath("/rep/calls");
  revalidatePath("/manager");
  return { ok: true, message: "Call review status saved." };
}

export async function saveCoachingFeedbackAction(input: {
  entityType: FeedbackEntityType;
  entityId: string;
  repId?: string | null;
  usefulnessRating: number;
  feedbackText?: string | null;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const entityId = asUuid(input.entityId);
  if (!entityId) {
    return { ok: false, message: "Feedback target ID must be a UUID." };
  }

  const { actor, result } = await authorize(["rep", "manager", "admin"], "rep");
  if (result) return result;
  const targetRepId =
    input.entityType === "scorecard" ? await repIdForScorecard(entityId) : await repIdForSummary(entityId);
  if (!(await canAccessRep(actor, targetRepId))) {
    return { ok: false, message: "You do not have access to leave feedback on this coaching item." };
  }
  if (!(await feedbackTableExists())) {
    return {
      ok: false,
      message: `Feedback storage is not available yet. Create public.${feedbackTableName} as documented in docs/coaching-feedback-table.md.`
    };
  }

  const db = getDb();
  const actorUserId = asUuid(actor?.id);
  const actorRole = actor?.role || "manager";
  const actorName = actor?.displayName || actor?.email || `${actorRole} user`;
  const actorKey = actorUserId || `${actorRole}:${actor?.email || actorName}`;
  const repUserId = asUuid(targetRepId || input.repId);
  const usefulnessRating = Math.max(1, Math.min(5, Math.round(Number(input.usefulnessRating) || 0)));
  const feedbackText = normalizeText(input.feedbackText);
  const sentiment = usefulnessRating >= 4 ? "useful" : usefulnessRating <= 2 ? "not_useful" : "edited";

  await db.execute(sql`
    insert into ${feedbackTable} (
      entity_type,
      entity_id,
      feedback_type,
      rep_user_id,
      target_rep_user_id,
      actor_key,
      actor_user_id,
      actor_name,
      actor_role,
      sentiment,
      usefulness_rating,
      feedback_text,
      accepted,
      created_at,
      updated_at
    )
    values (
      ${input.entityType},
      cast(${entityId} as uuid),
      ${input.entityType},
      ${repUserId ? sql`cast(${repUserId} as uuid)` : sql`null`},
      ${repUserId ? sql`cast(${repUserId} as uuid)` : sql`null`},
      ${actorKey},
      ${actorUserId ? sql`cast(${actorUserId} as uuid)` : sql`null`},
      ${actorName},
      ${actorRole},
      ${sentiment},
      ${usefulnessRating},
      ${feedbackText},
      ${usefulnessRating >= 4},
      now(),
      now()
    )
    on conflict (entity_type, entity_id, actor_key)
    do update
      set actor_user_id = excluded.actor_user_id,
          actor_name = excluded.actor_name,
          actor_role = excluded.actor_role,
          sentiment = excluded.sentiment,
          usefulness_rating = excluded.usefulness_rating,
          feedback_text = excluded.feedback_text,
          accepted = excluded.accepted,
          updated_at = now()
  `);

  revalidateCoachingPaths(repUserId || input.repId || null);
  return {
    ok: true,
    message: `${actorRole === "manager" ? "Manager" : "Rep"} feedback saved for this ${input.entityType}.`
  };
}

export async function saveUserMappingAction(input: {
  userId: string;
  role: UserRole;
  closeUserId?: string | null;
  managerUserId?: string | null;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const { result } = await authorize(["admin"], "admin");
  if (result) return result;

  const db = getDb();
  const now = new Date();
  const closeUserId = input.closeUserId?.trim() || null;

  await db
    .update(appUsers)
    .set({
      role: input.role,
      closeUserId,
      active: true,
      updatedAt: now
    })
    .where(eq(appUsers.id, input.userId));

  await db.delete(managerRepAssignments).where(eq(managerRepAssignments.repUserId, input.userId));

  if (input.role === "rep" && input.managerUserId && asUuid(input.managerUserId)) {
    await db
      .insert(managerRepAssignments)
      .values({
        managerUserId: input.managerUserId,
        repUserId: input.userId
      })
      .onConflictDoNothing();
  }

  revalidateAppPaths();
  return { ok: true, message: "User mapping saved." };
}

export async function deactivateUserAction(userId: string): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const { result } = await authorize(["admin"], "admin");
  if (result) return result;

  const db = getDb();
  await db.delete(managerRepAssignments).where(eq(managerRepAssignments.repUserId, userId));
  await db.delete(managerRepAssignments).where(eq(managerRepAssignments.managerUserId, userId));
  await db
    .update(appUsers)
    .set({
      active: false,
      updatedAt: new Date()
    })
    .where(eq(appUsers.id, userId));

  revalidateAppPaths();
  return { ok: true, message: "User deactivated." };
}

export async function markOneOnOnePreparedAction(input: {
  repId: string;
  focusDimension: RubricKey;
  actionText: string;
  whyItMatters?: string;
  managerNote?: string;
  suggestedFocusDimension?: RubricKey;
  suggestedActionText?: string;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["manager", "admin"], "manager");
  if (result) return result;
  if (!(await canAccessRep(actor, input.repId))) {
    return { ok: false, message: "You do not have access to prepare coaching for this rep." };
  }
  const managerUserId = asUuid(actor?.id);
  const sessionDate = todayIsoDate();
  const now = new Date();
  const sessionNotes = buildManagerSessionNotes(input);

  await db
    .insert(managerCoachingSessions)
    .values({
      managerUserId,
      repUserId: input.repId,
      sessionDate,
      status: "prepared",
      focusDimension: input.focusDimension,
      actionText: input.actionText,
      notes: sessionNotes.notes,
      preparedAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [managerCoachingSessions.repUserId, managerCoachingSessions.sessionDate],
      set: {
        managerUserId,
        status: "prepared",
        focusDimension: input.focusDimension,
        actionText: input.actionText,
        notes: sessionNotes.notes,
        preparedAt: now,
        updatedAt: now
      }
    });

  revalidateCoachingPaths(input.repId);
  return {
    ok: true,
    message: `1:1 preparation saved with ${sessionNotes.focusDecision === "accepted" ? "accepted" : "edited"} focus.`
  };
}

export async function assignFocusAction(input: {
  repId: string;
  focusDimension: RubricKey;
  actionText: string;
  whyItMatters: string;
  managerNote?: string;
  suggestedFocusDimension?: RubricKey;
  suggestedActionText?: string;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["manager", "admin"], "manager");
  if (result) return result;
  if (!(await canAccessRep(actor, input.repId))) {
    return { ok: false, message: "You do not have access to assign coaching for this rep." };
  }
  const managerUserId = asUuid(actor?.id);
  const sessionDate = todayIsoDate();
  const now = new Date();
  const sessionNotes = buildManagerSessionNotes(input);

  await db
    .insert(managerCoachingSessions)
    .values({
      managerUserId,
      repUserId: input.repId,
      sessionDate,
      status: "assigned",
      focusDimension: input.focusDimension,
      actionText: input.actionText,
      notes: sessionNotes.notes,
      assignedAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [managerCoachingSessions.repUserId, managerCoachingSessions.sessionDate],
      set: {
        managerUserId,
        status: "assigned",
        focusDimension: input.focusDimension,
        actionText: input.actionText,
        notes: sessionNotes.notes,
        assignedAt: now,
        updatedAt: now
      }
    });

  const existingAction = await db
    .select({ id: coachingActionItems.id })
    .from(coachingActionItems)
    .where(
      and(
        eq(coachingActionItems.repUserId, input.repId),
        eq(coachingActionItems.sourcePeriodStart, sessionDate),
        eq(coachingActionItems.sourcePeriodEnd, sessionDate),
        eq(coachingActionItems.status, "open")
      )
    )
    .orderBy(desc(coachingActionItems.createdAt))
    .limit(1);

  if (existingAction[0]) {
    await db
      .update(coachingActionItems)
      .set({
        dimension: input.focusDimension,
        actionText: input.actionText,
        whyItMatters: input.whyItMatters
      })
      .where(eq(coachingActionItems.id, existingAction[0].id));
  } else {
    await db.insert(coachingActionItems).values({
      repUserId: input.repId,
      sourcePeriodStart: sessionDate,
      sourcePeriodEnd: sessionDate,
      dimension: input.focusDimension,
      actionText: input.actionText,
      whyItMatters: input.whyItMatters,
      status: "open"
    });
  }

  revalidateCoachingPaths(input.repId);
  return {
    ok: true,
    message: `Focus ${sessionNotes.focusDecision === "accepted" ? "accepted" : "edited"} and assigned.`
  };
}

export async function completeCoachingActionAction(actionId: string): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const { actor, result } = await authorize(["rep", "manager", "admin"], "rep");
  if (result) return result;

  const db = getDb();
  const actionRows = await db
    .select({
      id: coachingActionItems.id,
      repId: coachingActionItems.repUserId
    })
    .from(coachingActionItems)
    .where(eq(coachingActionItems.id, actionId))
    .limit(1);

  const action = actionRows[0];
  if (!action) {
    return { ok: false, message: "Coaching action not found." };
  }
  if (!(await canAccessRep(actor, action.repId))) {
    return { ok: false, message: "You do not have access to complete this coaching action." };
  }

  await db
    .update(coachingActionItems)
    .set({
      status: "completed",
      completedAt: new Date()
    })
    .where(eq(coachingActionItems.id, actionId));

  revalidateCoachingPaths(action.repId);
  return { ok: true, message: "Coaching action marked completed." };
}

export async function recordReportEventAction(input: {
  reportId?: string;
  eventType: "regenerate_requested" | "send_requested";
  message?: string;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const { actor, result } = await authorize(["manager", "admin"], "manager");
  if (result) return result;
  const reportId = input.reportId && asUuid(input.reportId) ? input.reportId : null;
  if (reportId) {
    const reportRows = await getDb()
      .select({
        repUserId: reportArtifacts.repUserId,
        managerUserId: reportArtifacts.managerUserId
      })
      .from(reportArtifacts)
      .where(eq(reportArtifacts.id, reportId))
      .limit(1);
    const report = reportRows[0];
    if (!report) return { ok: false, message: "Report not found." };
    const canAccessReport =
      actor?.role === "admin" ||
      (actor?.role === "manager" &&
        ((report.managerUserId && report.managerUserId === actor.id) ||
          (!report.managerUserId && (!report.repUserId || (await canAccessRep(actor, report.repUserId))))));
    if (!canAccessReport) {
      return { ok: false, message: "You do not have access to this report." };
    }
  }

  await getDb().insert(reportArtifactEvents).values({
    reportArtifactId: reportId,
    actorUserId: asUuid(actor?.id),
    eventType: input.eventType,
    message: input.message || null
  });

  if (input.eventType === "send_requested" && process.env.SLACK_MANAGER_CHANNEL_ID) {
    const slack = await postSlackMessage({
      channel: process.env.SLACK_MANAGER_CHANNEL_ID,
      text: input.message || "Coaching report packet is ready for review."
    });
    await getDb().insert(deliveryEvents).values({
      channel: "slack",
      audience: "manager",
      status: slack.ok ? "sent" : "failed",
      reportArtifactId: reportId,
      managerUserId: asUuid(actor?.id),
      destination: process.env.SLACK_MANAGER_CHANNEL_ID,
      payloadJson: {
        event_type: input.eventType,
        message: input.message || "Coaching report packet is ready for review."
      },
      errorMessage: slack.ok ? null : slack.message,
      sentAt: slack.ok ? new Date() : null
    });
    if (!slack.ok) {
      return { ok: false, message: `Report send request recorded, but ${slack.message}` };
    }
  }

  revalidatePath("/manager/reports");
  return {
    ok: true,
    message: input.eventType === "send_requested" ? "Report send request recorded." : "Report regeneration request recorded."
  };
}
