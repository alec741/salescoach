ALTER TABLE "coaching_feedback" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "rep_user_id" uuid;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "actor_key" text;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "usefulness_rating" integer;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "feedback_text" text;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_rep_user_id_app_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coaching_feedback_entity_actor_idx" ON "coaching_feedback" USING btree ("entity_type","entity_id","actor_key");