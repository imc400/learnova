ALTER TABLE "homework_items" ADD COLUMN "resources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "proposed_modules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "source" text DEFAULT 'plan' NOT NULL;