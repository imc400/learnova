ALTER TABLE "profiles" ADD COLUMN "leaderboard_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "leaderboard_alias" text;--> statement-breakpoint
CREATE INDEX "xp_events_week_user_idx" ON "xp_events" USING btree ("week_start","user_id");