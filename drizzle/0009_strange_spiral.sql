CREATE TABLE "module_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "next_path_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_path_id" uuid NOT NULL,
	"skeleton_cache_key" text,
	"topic" text NOT NULL,
	"goal" text NOT NULL,
	"level" "path_level" NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'haiku' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_paths" ADD COLUMN "source_path_id" uuid;--> statement-breakpoint
ALTER TABLE "module_ratings" ADD CONSTRAINT "module_ratings_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_ratings" ADD CONSTRAINT "module_ratings_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_ratings" ADD CONSTRAINT "module_ratings_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_path_suggestions" ADD CONSTRAINT "next_path_suggestions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_path_suggestions" ADD CONSTRAINT "next_path_suggestions_source_path_id_learning_paths_id_fk" FOREIGN KEY ("source_path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_ratings_user_module_idx" ON "module_ratings" USING btree ("user_id","module_id");--> statement-breakpoint
CREATE INDEX "module_ratings_module_idx" ON "module_ratings" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "next_path_suggestions_source_idx" ON "next_path_suggestions" USING btree ("source_path_id");--> statement-breakpoint
CREATE INDEX "next_path_suggestions_skeleton_idx" ON "next_path_suggestions" USING btree ("skeleton_cache_key");