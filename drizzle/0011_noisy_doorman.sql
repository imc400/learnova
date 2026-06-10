CREATE TYPE "public"."live_session_status" AS ENUM('scheduled', 'in_progress', 'completed', 'missed', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'class_summary';--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'class_reminder';--> statement-breakpoint
CREATE TABLE "homework_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"task" text NOT NULL,
	"kind" text DEFAULT 'retrieval' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"reviewed_in_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"status" "live_session_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"conversation_id" text,
	"summary" jsonb,
	"exit_ticket" text,
	"reminder_run_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"name" text NOT NULL,
	"specialty" text NOT NULL,
	"style" text NOT NULL,
	"greeting" text NOT NULL,
	"system_prompt" text NOT NULL,
	"elevenlabs_agent_id" text,
	"voice_id" text,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homework_items" ADD CONSTRAINT "homework_items_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_items" ADD CONSTRAINT "homework_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_items" ADD CONSTRAINT "homework_items_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_items" ADD CONSTRAINT "homework_items_reviewed_in_session_id_live_sessions_id_fk" FOREIGN KEY ("reviewed_in_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_user_path_idx" ON "homework_items" USING btree ("user_id","path_id","done");--> statement-breakpoint
CREATE UNIQUE INDEX "learner_profiles_user_path_idx" ON "learner_profiles" USING btree ("user_id","path_id");--> statement-breakpoint
CREATE INDEX "live_sessions_user_idx" ON "live_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "live_sessions_status_idx" ON "live_sessions" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_agents_cache_key_idx" ON "route_agents" USING btree ("cache_key");