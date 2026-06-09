CREATE TYPE "public"."email_type" AS ENUM('welcome', 'module_ready', 'module_learned', 'path_completed', 'streak_at_risk', 'weekly_recap', 'reengagement');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'claimed', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"outbox_id" uuid,
	"type" "email_type" NOT NULL,
	"subject" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "email_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"unsubscribed_all" boolean DEFAULT false NOT NULL,
	"allow_module_ready" boolean DEFAULT true NOT NULL,
	"allow_learned" boolean DEFAULT true NOT NULL,
	"allow_streak" boolean DEFAULT true NOT NULL,
	"allow_weekly_recap" boolean DEFAULT true NOT NULL,
	"allow_reengagement" boolean DEFAULT true NOT NULL,
	"max_per_week" integer DEFAULT 3 NOT NULL,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"unsub_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_unsub_token_unique" UNIQUE("unsub_token")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_outbox_id_email_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_user_sent_idx" ON "email_log" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "email_log_provider_idx" ON "email_log" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_user_type_dedupe_idx" ON "email_outbox" USING btree ("user_id","type","dedupe_key");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "email_prefs_read_owner" ON "email_preferences" FOR SELECT USING (user_id = auth.uid());--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.email_outbox, public.email_preferences, public.email_log FROM anon, authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, locale, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'es'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.email_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;--> statement-breakpoint
UPDATE public.profiles p SET email = u.email FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;--> statement-breakpoint
INSERT INTO public.email_preferences (user_id) SELECT id FROM public.profiles ON CONFLICT (user_id) DO NOTHING;
