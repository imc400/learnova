CREATE TABLE "youtube_search_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"query" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"video_ids" jsonb NOT NULL,
	"times_reused" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_search_cache_key_idx" ON "youtube_search_cache" USING btree ("cache_key");