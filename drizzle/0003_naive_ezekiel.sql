CREATE TYPE "public"."coaching_session_status" AS ENUM('draft', 'prepared', 'assigned', 'completed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('reviewed', 'reopened');--> statement-breakpoint
CREATE TABLE "call_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"status" "review_status" DEFAULT 'reviewed' NOT NULL,
	"note" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_coaching_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_user_id" uuid,
	"rep_user_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"status" "coaching_session_status" DEFAULT 'draft' NOT NULL,
	"focus_dimension" text,
	"action_text" text,
	"notes" text,
	"prepared_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_artifact_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_artifact_id" uuid,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_reviews" ADD CONSTRAINT "call_reviews_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_reviews" ADD CONSTRAINT "call_reviews_reviewer_user_id_app_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_coaching_sessions" ADD CONSTRAINT "manager_coaching_sessions_manager_user_id_app_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_coaching_sessions" ADD CONSTRAINT "manager_coaching_sessions_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifact_events" ADD CONSTRAINT "report_artifact_events_report_artifact_id_report_artifacts_id_fk" FOREIGN KEY ("report_artifact_id") REFERENCES "public"."report_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifact_events" ADD CONSTRAINT "report_artifact_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_reviews_call_idx" ON "call_reviews" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_reviews_reviewer_idx" ON "call_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_coaching_sessions_rep_date_idx" ON "manager_coaching_sessions" USING btree ("rep_user_id","session_date");--> statement-breakpoint
CREATE INDEX "manager_coaching_sessions_manager_date_idx" ON "manager_coaching_sessions" USING btree ("manager_user_id","session_date");--> statement-breakpoint
CREATE INDEX "report_artifact_events_report_event_idx" ON "report_artifact_events" USING btree ("report_artifact_id","created_at");