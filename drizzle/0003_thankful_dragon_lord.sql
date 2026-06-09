CREATE TYPE "public"."achievement_kind" AS ENUM('deterministic', 'surprise');--> statement-breakpoint
CREATE TYPE "public"."xp_source" AS ENUM('lesson_completed', 'quiz_passed', 'quiz_perfect', 'module_completed', 'path_completed', 'achievement');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"kind" "achievement_kind" DEFAULT 'deterministic' NOT NULL,
	"xp_reward" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "xp_source" NOT NULL,
	"ref_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "total_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "current_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "longest_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_active_day" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "streak_freezes" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_code_idx" ON "achievements" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_user_ach_idx" ON "user_achievements" USING btree ("user_id","achievement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_user_source_ref_idx" ON "xp_events" USING btree ("user_id","source","ref_id");--> statement-breakpoint
CREATE INDEX "xp_events_user_week_idx" ON "xp_events" USING btree ("user_id","week_start");--> statement-breakpoint
ALTER TABLE "xp_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "achievements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_achievements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "xp_events_read_owner" ON "xp_events" FOR SELECT USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "achievements_read_all" ON "achievements" FOR SELECT USING (auth.role() = 'authenticated');--> statement-breakpoint
CREATE POLICY "user_achievements_read_owner" ON "user_achievements" FOR SELECT USING (user_id = auth.uid());--> statement-breakpoint
INSERT INTO "achievements" ("code", "title", "description", "icon", "kind", "xp_reward") VALUES
  ('first_lesson',  'Primer paso',      'Completaste tu primera lección',              'footprints', 'deterministic', 15),
  ('first_module',  'Módulo dominado',  'Completaste tu primer módulo entero',         'flag',       'deterministic', 30),
  ('first_path',    'Ruta conquistada', 'Terminaste tu primera ruta completa',         'trophy',     'deterministic', 100),
  ('five_quizzes',  'Mente afilada',    'Aprobaste 5 quizzes',                         'brain',      'deterministic', 40),
  ('perfect_quiz',  'Impecable',        'Obtuviste 100% en un quiz',                   'sparkles',   'deterministic', 25),
  ('streak_7',      'Semana constante', 'Aprendiste 7 días seguidos',                  'flame',      'deterministic', 50),
  ('streak_30',     'Hábito de acero',  'Aprendiste 30 días seguidos',                 'medal',      'deterministic', 150),
  ('polymath',      'Curiosidad infinita', 'Completaste lecciones en 2 rutas distintas', 'compass',   'surprise',      30)
ON CONFLICT ("code") DO NOTHING;