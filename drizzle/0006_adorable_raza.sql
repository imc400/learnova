CREATE TABLE "video_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_video_id" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"source" text DEFAULT 'gemini' NOT NULL,
	"digest" jsonb NOT NULL,
	"audio_language" text,
	"duration_seconds" integer,
	"model" text,
	"times_reused" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "video_insights_video_lang_idx" ON "video_insights" USING btree ("youtube_video_id","language");