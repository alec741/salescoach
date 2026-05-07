import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["rep", "manager", "admin"]);
export const periodType = pgEnum("period_type", ["daily", "weekly", "monthly", "quarterly"]);
export const targetStatus = pgEnum("target_status", ["active", "completed", "archived"]);
export const actionStatus = pgEnum("action_status", ["open", "completed", "dismissed"]);
export const ingestionStatus = pgEnum("ingestion_status", ["running", "succeeded", "failed"]);
export const reviewStatus = pgEnum("review_status", ["reviewed", "reopened"]);
export const coachingSessionStatus = pgEnum("coaching_session_status", ["draft", "prepared", "assigned", "completed"]);

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: text("auth_user_id").unique(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull().default("rep"),
    closeUserId: text("close_user_id").unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    emailIdx: uniqueIndex("app_users_email_idx").on(table.email),
    closeUserIdx: index("app_users_close_user_idx").on(table.closeUserId)
  })
);

export const managerRepAssignments = pgTable(
  "manager_rep_assignments",
  {
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    repUserId: uuid("rep_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    assignmentIdx: uniqueIndex("manager_rep_assignment_idx").on(table.managerUserId, table.repUserId)
  })
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    closeCallId: text("close_call_id").notNull().unique(),
    leadId: text("lead_id"),
    contactId: text("contact_id"),
    repUserId: uuid("rep_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    closeUserId: text("close_user_id"),
    activityAt: timestamp("activity_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    direction: text("direction"),
    status: text("status"),
    disposition: text("disposition"),
    summaryText: text("summary_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    activityIdx: index("calls_activity_at_idx").on(table.activityAt),
    repActivityIdx: index("calls_rep_activity_idx").on(table.repUserId, table.activityAt),
    closeCallIdx: uniqueIndex("calls_close_call_idx").on(table.closeCallId)
  })
);

export const callScorecards = pgTable(
  "call_scorecards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    graderProvider: text("grader_provider").notNull(),
    overallScore: numeric("overall_score", { precision: 4, scale: 2 }).notNull(),
    openingScore: numeric("opening_score", { precision: 4, scale: 2 }).notNull(),
    qualificationScore: numeric("qualification_score", { precision: 4, scale: 2 }).notNull(),
    discoveryScore: numeric("discovery_score", { precision: 4, scale: 2 }).notNull(),
    quantificationScore: numeric("quantification_score", { precision: 4, scale: 2 }).notNull(),
    solutionToPainScore: numeric("solution_to_pain_score", { precision: 4, scale: 2 }).notNull(),
    featureDumpControlScore: numeric("feature_dump_control_score", { precision: 4, scale: 2 }).notNull(),
    closeOrNextStepScore: numeric("close_or_next_step_score", { precision: 4, scale: 2 }).notNull(),
    complianceScore: numeric("compliance_score", { precision: 4, scale: 2 }).notNull(),
    leadSegment: text("lead_segment"),
    topStrength: text("top_strength").notNull(),
    biggestCoachingOpportunity: text("biggest_coaching_opportunity").notNull(),
    nextCallFocus: text("next_call_focus").notNull(),
    evidenceSummaryJson: jsonb("evidence_summary_json").notNull().default({}),
    gradedAt: timestamp("graded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    callIdx: uniqueIndex("call_scorecards_call_idx").on(table.callId),
    gradedAtIdx: index("call_scorecards_graded_at_idx").on(table.gradedAt)
  })
);

export const complianceFlags = pgTable(
  "compliance_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callScorecardId: uuid("call_scorecard_id")
      .notNull()
      .references(() => callScorecards.id, { onDelete: "cascade" }),
    flag: text("flag").notNull(),
    severity: text("severity").notNull().default("medium")
  },
  (table) => ({
    scorecardIdx: index("compliance_flags_scorecard_idx").on(table.callScorecardId)
  })
);

export const callReviews = pgTable(
  "call_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    status: reviewStatus("status").notNull().default("reviewed"),
    note: text("note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    callIdx: uniqueIndex("call_reviews_call_idx").on(table.callId),
    reviewerIdx: index("call_reviews_reviewer_idx").on(table.reviewerUserId)
  })
);

export const coachingSummaries = pgTable(
  "coaching_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repUserId: uuid("rep_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    periodType: periodType("period_type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    callsGraded: integer("calls_graded").notNull().default(0),
    averageScore: numeric("average_score", { precision: 4, scale: 2 }).notNull(),
    dimensionAveragesJson: jsonb("dimension_averages_json").notNull().default({}),
    strongestDimension: text("strongest_dimension").notNull(),
    weakestDimension: text("weakest_dimension").notNull(),
    weakestScoreDimension: text("weakest_score_dimension"),
    primaryFocusDimension: text("primary_focus_dimension"),
    focusRationale: text("focus_rationale"),
    primaryFocus: text("primary_focus").notNull(),
    nextCallFocus: text("next_call_focus").notNull(),
    summaryMarkdown: text("summary_markdown").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    repPeriodIdx: uniqueIndex("coaching_summaries_rep_period_idx").on(
      table.repUserId,
      table.periodType,
      table.periodStart,
      table.periodEnd
    )
  })
);

export const coachingTargets = pgTable("coaching_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  repUserId: uuid("rep_user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  dimension: text("dimension").notNull(),
  targetScore: numeric("target_score", { precision: 4, scale: 2 }).notNull(),
  periodType: periodType("period_type").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: targetStatus("status").notNull().default("active")
});

export const coachingActionItems = pgTable(
  "coaching_action_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repUserId: uuid("rep_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    sourcePeriodStart: date("source_period_start").notNull(),
    sourcePeriodEnd: date("source_period_end").notNull(),
    dimension: text("dimension").notNull(),
    actionText: text("action_text").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    status: actionStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    repStatusIdx: index("coaching_action_items_rep_status_idx").on(table.repUserId, table.status)
  })
);

export const managerCoachingSessions = pgTable(
  "manager_coaching_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerUserId: uuid("manager_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    repUserId: uuid("rep_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    sessionDate: date("session_date").notNull(),
    status: coachingSessionStatus("status").notNull().default("draft"),
    focusDimension: text("focus_dimension"),
    actionText: text("action_text"),
    notes: text("notes"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    repDateUniqueIdx: uniqueIndex("manager_coaching_sessions_rep_date_idx").on(table.repUserId, table.sessionDate),
    managerDateIdx: index("manager_coaching_sessions_manager_date_idx").on(table.managerUserId, table.sessionDate)
  })
);

export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportType: text("report_type").notNull(),
    periodType: periodType("period_type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    repUserId: uuid("rep_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    managerUserId: uuid("manager_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    storagePath: text("storage_path"),
    contentMarkdown: text("content_markdown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    storagePathIdx: uniqueIndex("report_artifacts_storage_path_idx").on(table.storagePath)
  })
);

export const reportArtifactEvents = pgTable(
  "report_artifact_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportArtifactId: uuid("report_artifact_id").references(() => reportArtifacts.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    reportEventIdx: index("report_artifact_events_report_event_idx").on(table.reportArtifactId, table.createdAt)
  })
);

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: ingestionStatus("status").notNull().default("running"),
  callsSeen: integer("calls_seen").notNull().default(0),
  callsImported: integer("calls_imported").notNull().default(0),
  callsGraded: integer("calls_graded").notNull().default(0),
  errorMessage: text("error_message")
});
