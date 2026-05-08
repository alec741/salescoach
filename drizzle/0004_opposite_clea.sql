CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."feedback_sentiment" AS ENUM('useful', 'not_useful', 'inaccurate', 'accepted', 'edited', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."pipeline_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "call_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"close_lead_id" text,
	"close_opportunity_id" text,
	"pipeline_name" text,
	"status_label" text,
	"status_type" text,
	"value" numeric(12, 2),
	"value_period" text,
	"won" boolean DEFAULT false NOT NULL,
	"lost" boolean DEFAULT false NOT NULL,
	"close_date" date,
	"opportunity_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_type" text NOT NULL,
	"call_scorecard_id" uuid,
	"coaching_summary_id" uuid,
	"action_item_id" uuid,
	"actor_user_id" uuid,
	"target_rep_user_id" uuid,
	"sentiment" "feedback_sentiment" NOT NULL,
	"original_focus_dimension" text,
	"edited_focus_dimension" text,
	"note" text,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"audience" text NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"report_artifact_id" uuid,
	"call_scorecard_id" uuid,
	"rep_user_id" uuid,
	"manager_user_id" uuid,
	"destination" text,
	"external_id" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"status" "pipeline_job_status" DEFAULT 'queued' NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"profile_version" text,
	"prompt_version" text,
	"model_provider" text,
	"model_name" text,
	"rubric_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "rubric_version_id" uuid;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "profile_version" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "focus_dimension" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "call_type" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "outcome_type" text;--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD COLUMN "outcome_rationale" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "call_type" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "outcome_type" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "outcome_rationale" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "crm_outcome_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD COLUMN "summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD COLUMN "rubric_version_id" uuid;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "run_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "call_outcomes" ADD CONSTRAINT "call_outcomes_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_call_scorecard_id_call_scorecards_id_fk" FOREIGN KEY ("call_scorecard_id") REFERENCES "public"."call_scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_coaching_summary_id_coaching_summaries_id_fk" FOREIGN KEY ("coaching_summary_id") REFERENCES "public"."coaching_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_action_item_id_coaching_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."coaching_action_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_target_rep_user_id_app_users_id_fk" FOREIGN KEY ("target_rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_report_artifact_id_report_artifacts_id_fk" FOREIGN KEY ("report_artifact_id") REFERENCES "public"."report_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_call_scorecard_id_call_scorecards_id_fk" FOREIGN KEY ("call_scorecard_id") REFERENCES "public"."call_scorecards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_manager_user_id_app_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_outcomes_call_idx" ON "call_outcomes" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_outcomes_close_opportunity_idx" ON "call_outcomes" USING btree ("close_opportunity_id");--> statement-breakpoint
CREATE INDEX "call_outcomes_status_idx" ON "call_outcomes" USING btree ("status_type");--> statement-breakpoint
CREATE INDEX "coaching_feedback_scorecard_idx" ON "coaching_feedback" USING btree ("call_scorecard_id");--> statement-breakpoint
CREATE INDEX "coaching_feedback_summary_idx" ON "coaching_feedback" USING btree ("coaching_summary_id");--> statement-breakpoint
CREATE INDEX "coaching_feedback_rep_created_idx" ON "coaching_feedback" USING btree ("target_rep_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_events_report_idx" ON "delivery_events" USING btree ("report_artifact_id");--> statement-breakpoint
CREATE INDEX "delivery_events_scorecard_idx" ON "delivery_events" USING btree ("call_scorecard_id");--> statement-breakpoint
CREATE INDEX "delivery_events_rep_created_idx" ON "delivery_events" USING btree ("rep_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_events_external_idx" ON "delivery_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "pipeline_jobs_status_idx" ON "pipeline_jobs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_jobs_idempotency_idx" ON "pipeline_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_version_idx" ON "rubric_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "rubric_versions_active_idx" ON "rubric_versions" USING btree ("active");--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD CONSTRAINT "call_scorecards_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD CONSTRAINT "coaching_summaries_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE set null ON UPDATE no action;