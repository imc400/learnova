CREATE TABLE "route_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"level" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"goal" text NOT NULL,
	"prior_experience" text,
	"weekly_hours" integer,
	"phone" text,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"path_id" uuid,
	"amount_clp" integer,
	"paid_at" timestamp with time zone,
	"source_path_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "route_intents" ADD CONSTRAINT "route_intents_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_intents" ADD CONSTRAINT "route_intents_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_intents_user_idx" ON "route_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "route_intents_status_idx" ON "route_intents" USING btree ("status","created_at");