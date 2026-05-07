CREATE TYPE "public"."action_status" AS ENUM('open', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('daily', 'weekly', 'monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."target_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rep', 'manager', 'admin');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'rep' NOT NULL,
	"close_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_users_email_unique" UNIQUE("email"),
	CONSTRAINT "app_users_close_user_id_unique" UNIQUE("close_user_id")
);
--> statement-breakpoint
CREATE TABLE "call_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"grader_provider" text NOT NULL,
	"overall_score" numeric(4, 2) NOT NULL,
	"opening_score" numeric(4, 2) NOT NULL,
	"qualification_score" numeric(4, 2) NOT NULL,
	"discovery_score" numeric(4, 2) NOT NULL,
	"quantification_score" numeric(4, 2) NOT NULL,
	"solution_to_pain_score" numeric(4, 2) NOT NULL,
	"feature_dump_control_score" numeric(4, 2) NOT NULL,
	"close_or_next_step_score" numeric(4, 2) NOT NULL,
	"compliance_score" numeric(4, 2) NOT NULL,
	"lead_segment" text,
	"top_strength" text NOT NULL,
	"biggest_coaching_opportunity" text NOT NULL,
	"next_call_focus" text NOT NULL,
	"evidence_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"close_call_id" text NOT NULL,
	"lead_id" text,
	"contact_id" text,
	"rep_user_id" uuid,
	"close_user_id" text,
	"activity_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"direction" text,
	"status" text,
	"disposition" text,
	"summary_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_close_call_id_unique" UNIQUE("close_call_id")
);
--> statement-breakpoint
CREATE TABLE "coaching_action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rep_user_id" uuid NOT NULL,
	"source_period_start" date NOT NULL,
	"source_period_end" date NOT NULL,
	"dimension" text NOT NULL,
	"action_text" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"status" "action_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coaching_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rep_user_id" uuid NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"calls_graded" integer DEFAULT 0 NOT NULL,
	"average_score" numeric(4, 2) NOT NULL,
	"dimension_averages_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strongest_dimension" text NOT NULL,
	"weakest_dimension" text NOT NULL,
	"primary_focus" text NOT NULL,
	"next_call_focus" text NOT NULL,
	"summary_markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rep_user_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"target_score" numeric(4, 2) NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "target_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_scorecard_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"calls_seen" integer DEFAULT 0 NOT NULL,
	"calls_imported" integer DEFAULT 0 NOT NULL,
	"calls_graded" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "manager_rep_assignments" (
	"manager_user_id" uuid NOT NULL,
	"rep_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"rep_user_id" uuid,
	"manager_user_id" uuid,
	"storage_path" text,
	"content_markdown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_scorecards" ADD CONSTRAINT "call_scorecards_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_action_items" ADD CONSTRAINT "coaching_action_items_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_summaries" ADD CONSTRAINT "coaching_summaries_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_targets" ADD CONSTRAINT "coaching_targets_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_flags" ADD CONSTRAINT "compliance_flags_call_scorecard_id_call_scorecards_id_fk" FOREIGN KEY ("call_scorecard_id") REFERENCES "public"."call_scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_rep_assignments" ADD CONSTRAINT "manager_rep_assignments_manager_user_id_app_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_rep_assignments" ADD CONSTRAINT "manager_rep_assignments_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_manager_user_id_app_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_email_idx" ON "app_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "app_users_close_user_idx" ON "app_users" USING btree ("close_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_scorecards_call_idx" ON "call_scorecards" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_scorecards_graded_at_idx" ON "call_scorecards" USING btree ("graded_at");--> statement-breakpoint
CREATE INDEX "calls_activity_at_idx" ON "calls" USING btree ("activity_at");--> statement-breakpoint
CREATE INDEX "calls_rep_activity_idx" ON "calls" USING btree ("rep_user_id","activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_close_call_idx" ON "calls" USING btree ("close_call_id");--> statement-breakpoint
CREATE INDEX "coaching_action_items_rep_status_idx" ON "coaching_action_items" USING btree ("rep_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coaching_summaries_rep_period_idx" ON "coaching_summaries" USING btree ("rep_user_id","period_type","period_start","period_end");--> statement-breakpoint
CREATE INDEX "compliance_flags_scorecard_idx" ON "compliance_flags" USING btree ("call_scorecard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_rep_assignment_idx" ON "manager_rep_assignments" USING btree ("manager_user_id","rep_user_id");