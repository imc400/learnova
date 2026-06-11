ALTER TYPE "public"."email_type" ADD VALUE 'pro_expiring';--> statement-breakpoint
ALTER TYPE "public"."email_type" ADD VALUE 'cart_recovery';--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"path_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read" integer DEFAULT 0 NOT NULL,
	"cache_write" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" text DEFAULT 'critical' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"youtube_units" integer DEFAULT 0 NOT NULL,
	"gemini_requests" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_pk" PRIMARY KEY("key","window")
);
--> statement-breakpoint
CREATE TABLE "video_backfill_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wizard_questions_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_paths" ADD COLUMN "route_intro" text;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "anchored_video_id" text;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "video_query" text;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "had_digest" boolean;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "coverage" real;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "video_count" integer;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "quiz_ok" boolean;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "anchored" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "stub_summary" text;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "personal_note" text;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "source_session_id" text;--> statement-breakpoint
ALTER TABLE "path_purchases" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "route_intents" ADD COLUMN "canonical_topic" text;--> statement-breakpoint
ALTER TABLE "route_intents" ADD COLUMN "goal_archetype" text;--> statement-breakpoint
ALTER TABLE "route_intents" ADD COLUMN "wizard_answers" jsonb;--> statement-breakpoint
ALTER TABLE "route_intents" ADD COLUMN "deadline" text;--> statement-breakpoint
ALTER TABLE "route_intents" ADD COLUMN "clicked_via" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_backfill_queue" ADD CONSTRAINT "video_backfill_queue_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_path_idx" ON "ai_usage" USING btree ("path_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_incidents_title_hour_idx" ON "ops_incidents" USING btree ("title",date_trunc('hour', "created_at" at time zone 'utc'));--> statement-breakpoint
CREATE INDEX "ops_incidents_open_idx" ON "ops_incidents" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "video_backfill_queue_pending_idx" ON "video_backfill_queue" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wizard_questions_cache_key_idx" ON "wizard_questions_cache" USING btree ("cache_key");