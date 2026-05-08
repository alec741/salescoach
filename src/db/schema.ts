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
export const pipelineJobStatus = pgEnum("pipeline_job_status", ["queued", "running", "succeeded", "failed", "skipped"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "sent", "failed", "skipped"]);
export const feedbackSentiment = pgEnum("feedback_sentiment", ["useful", "not_useful", "inaccurate", "accepted", "edited", "dismissed"]);

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

export const rubricVersions = pgTable(
  "rubric_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: text("version").notNull().unique(),
    profileVersion: text("profile_version"),
    promptVersion: text("prompt_version"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    rubricJson: jsonb("rubric_json").notNull().default({}),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    versionIdx: uniqueIndex("rubric_versions_version_idx").on(table.version),
    activeIdx: index("rubric_versions_active_idx").on(table.active)
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
    callType: text("call_type"),
    outcomeType: text("outcome_type"),
    outcomeRationale: text("outcome_rationale"),
    crmOutcomeJson: jsonb("crm_outcome_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
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
    rubricVersionId: uuid("rubric_version_id").references(() => rubricVersions.id, { onDelete: "set null" }),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    profileVersion: text("profile_version"),
    focusDimension: text("focus_dimension"),
    callType: text("call_type"),
    outcomeType: text("outcome_type"),
    outcomeRationale: text("outcome_rationale"),
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
    summaryJson: jsonb("summary_json").notNull().default({}),
    rubricVersionId: uuid("rubric_version_id").references(() => rubricVersions.id, { onDelete: "set null" }),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
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

export const callOutcomes = pgTable(
  "call_outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    closeLeadId: text("close_lead_id"),
    closeOpportunityId: text("close_opportunity_id"),
    pipelineName: text("pipeline_name"),
    statusLabel: text("status_label"),
    statusType: text("status_type"),
    value: numeric("value", { precision: 12, scale: 2 }),
    valuePeriod: text("value_period"),
    won: boolean("won").notNull().default(false),
    lost: boolean("lost").notNull().default(false),
    closeDate: date("close_date"),
    opportunityJson: jsonb("opportunity_json").notNull().default({}),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    callIdx: uniqueIndex("call_outcomes_call_idx").on(table.callId),
    closeOpportunityIdx: index("call_outcomes_close_opportunity_idx").on(table.closeOpportunityId),
    statusIdx: index("call_outcomes_status_idx").on(table.statusType)
  })
);

export const coachingFeedback = pgTable(
  "coaching_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    feedbackType: text("feedback_type").notNull(),
    callScorecardId: uuid("call_scorecard_id").references(() => callScorecards.id, { onDelete: "cascade" }),
    coachingSummaryId: uuid("coaching_summary_id").references(() => coachingSummaries.id, { onDelete: "cascade" }),
    actionItemId: uuid("action_item_id").references(() => coachingActionItems.id, { onDelete: "set null" }),
    repUserId: uuid("rep_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    actorKey: text("actor_key"),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    targetRepUserId: uuid("target_rep_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    sentiment: feedbackSentiment("sentiment").notNull(),
    usefulnessRating: integer("usefulness_rating"),
    feedbackText: text("feedback_text"),
    originalFocusDimension: text("original_focus_dimension"),
    editedFocusDimension: text("edited_focus_dimension"),
    note: text("note"),
    accepted: boolean("accepted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    entityActorIdx: uniqueIndex("coaching_feedback_entity_actor_idx").on(table.entityType, table.entityId, table.actorKey),
    scorecardIdx: index("coaching_feedback_scorecard_idx").on(table.callScorecardId),
    summaryIdx: index("coaching_feedback_summary_idx").on(table.coachingSummaryId),
    repCreatedIdx: index("coaching_feedback_rep_created_idx").on(table.targetRepUserId, table.createdAt)
  })
);

export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").notNull(),
    audience: text("audience").notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    reportArtifactId: uuid("report_artifact_id").references(() => reportArtifacts.id, { onDelete: "set null" }),
    callScorecardId: uuid("call_scorecard_id").references(() => callScorecards.id, { onDelete: "set null" }),
    repUserId: uuid("rep_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    managerUserId: uuid("manager_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    destination: text("destination"),
    externalId: text("external_id"),
    payloadJson: jsonb("payload_json").notNull().default({}),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true })
  },
  (table) => ({
    reportIdx: index("delivery_events_report_idx").on(table.reportArtifactId),
    scorecardIdx: index("delivery_events_scorecard_idx").on(table.callScorecardId),
    repCreatedIdx: index("delivery_events_rep_created_idx").on(table.repUserId, table.createdAt),
    externalIdx: index("delivery_events_external_idx").on(table.externalId)
  })
);

export const pipelineJobs = pgTable(
  "pipeline_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobType: text("job_type").notNull(),
    status: pipelineJobStatus("status").notNull().default("queued"),
    source: text("source").notNull().default("local"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payloadJson: jsonb("payload_json").notNull().default({}),
    resultJson: jsonb("result_json").notNull().default({}),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    jobStatusIdx: index("pipeline_jobs_status_idx").on(table.status, table.scheduledFor),
    idempotencyIdx: uniqueIndex("pipeline_jobs_idempotency_idx").on(table.idempotencyKey)
  })
);

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  runType: text("run_type").notNull().default("manual"),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  provider: text("provider"),
  modelName: text("model_name"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: ingestionStatus("status").notNull().default("running"),
  callsSeen: integer("calls_seen").notNull().default(0),
  callsImported: integer("calls_imported").notNull().default(0),
  callsGraded: integer("calls_graded").notNull().default(0),
  errorMessage: text("error_message")
});
