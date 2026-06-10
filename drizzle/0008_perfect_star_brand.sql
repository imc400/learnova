CREATE TABLE "lesson_content_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"module_index" integer NOT NULL,
	"lesson_index" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"quiz" jsonb,
	"times_reused" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_content_cache_key_idx" ON "lesson_content_cache" USING btree ("cache_key","module_index","lesson_index","version");