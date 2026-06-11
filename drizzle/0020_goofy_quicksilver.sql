ALTER TABLE "learning_paths" ADD COLUMN "generation_requeues" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_content_cache" ADD COLUMN "terminology" jsonb;