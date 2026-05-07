"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/db/client";
import {
  appUsers,
  callReviews,
  coachingActionItems,
  managerCoachingSessions,
  managerRepAssignments,
  reportArtifactEvents
} from "@/db/schema";
import { getCurrentAppUser } from "@/lib/data";
import { postSlackMessage } from "@/lib/slack";
import type { RubricKey, UserRole } from "@/lib/types";

type ActionResult = {
  ok: boolean;
  message: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function asUuid(value: string | null | undefined) {
  return value && uuidPattern.test(value) ? value : null;
}

async function getActor(roleHint: UserRole = "manager") {
  if (!hasDatabase) return null;
  const user = await getCurrentAppUser(roleHint);
  return user && asUuid(user.id) ? user : null;
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

export async function markCallReviewedAction(callId: string): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["rep", "manager", "admin"], "manager");
  if (result) return result;
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

  await getDb()
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
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["manager", "admin"], "manager");
  if (result) return result;
  const managerUserId = asUuid(actor?.id);
  const sessionDate = todayIsoDate();
  const now = new Date();

  await db
    .insert(managerCoachingSessions)
    .values({
      managerUserId,
      repUserId: input.repId,
      sessionDate,
      status: "prepared",
      focusDimension: input.focusDimension,
      actionText: input.actionText,
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
        preparedAt: now,
        updatedAt: now
      }
    });

  revalidatePath(`/manager/reps/${input.repId}`);
  return { ok: true, message: "1:1 preparation saved." };
}

export async function assignFocusAction(input: {
  repId: string;
  focusDimension: RubricKey;
  actionText: string;
  whyItMatters: string;
}): Promise<ActionResult> {
  const dbMissing = requireDatabase();
  if (dbMissing) return dbMissing;

  const db = getDb();
  const { actor, result } = await authorize(["manager", "admin"], "manager");
  if (result) return result;
  const managerUserId = asUuid(actor?.id);
  const sessionDate = todayIsoDate();
  const now = new Date();

  await db
    .insert(managerCoachingSessions)
    .values({
      managerUserId,
      repUserId: input.repId,
      sessionDate,
      status: "assigned",
      focusDimension: input.focusDimension,
      actionText: input.actionText,
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
        assignedAt: now,
        updatedAt: now
      }
    });

  await db.insert(coachingActionItems).values({
    repUserId: input.repId,
    sourcePeriodStart: sessionDate,
    sourcePeriodEnd: sessionDate,
    dimension: input.focusDimension,
    actionText: input.actionText,
    whyItMatters: input.whyItMatters,
    status: "open"
  });

  revalidatePath(`/manager/reps/${input.repId}`);
  revalidatePath("/manager");
  return { ok: true, message: "Focus assigned and action item created." };
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
  await getDb().insert(reportArtifactEvents).values({
    reportArtifactId: input.reportId && asUuid(input.reportId) ? input.reportId : null,
    actorUserId: asUuid(actor?.id),
    eventType: input.eventType,
    message: input.message || null
  });

  if (input.eventType === "send_requested" && process.env.SLACK_MANAGER_CHANNEL_ID) {
    const slack = await postSlackMessage({
      channel: process.env.SLACK_MANAGER_CHANNEL_ID,
      text: input.message || "Coaching report packet is ready for review."
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
