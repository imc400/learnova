import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/*
  Esquema de datos de Aulia (Postgres / Supabase).
  Convenciones:
  - PKs uuid (defaultRandom).
  - profiles.id == auth.users.id de Supabase (sin FK cross-schema; lo enlaza un
    trigger en la migración SQL).
  - Todo cuelga del usuario para que las políticas RLS aíslen por usuario.
*/

// ---------- Enums ----------
export const pathLevel = pgEnum("path_level", [
  "principiante",
  "intermedio",
  "avanzado",
]);
export const pathStatus = pgEnum("path_status", [
  "draft",
  "generating",
  "ready",
  "failed",
]);
export const progressStatus = pgEnum("progress_status", [
  "not_started",
  "in_progress",
  "completed",
]);
export const questionType = pgEnum("question_type", [
  "single",
  "multiple",
  "open",
]);
export const tutorRole = pgEnum("tutor_role", ["user", "assistant"]);
export const planType = pgEnum("plan_type", ["free", "pro"]);
export const subStatus = pgEnum("sub_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
]);
export const paymentProvider = pgEnum("payment_provider", ["flow", "stripe"]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);

// ---------- Perfiles ----------
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // = auth.users.id
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  locale: text("locale").default("es-CL").notNull(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Caché de "cabeza gruesa" (esqueletos canónicos reutilizables) ----------
export const skeletonCache = pgTable(
  "skeleton_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull(), // p.ej. "python-principiante-es"
    topic: text("topic").notNull(),
    language: text("language").default("es").notNull(),
    level: pathLevel("level").notNull(),
    skeleton: jsonb("skeleton").notNull(), // plan curricular generado por Opus
    version: integer("version").default(1).notNull(),
    timesReused: integer("times_reused").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    cacheKeyIdx: uniqueIndex("skeleton_cache_key_idx").on(t.cacheKey, t.version),
  }),
);

// ---------- Caché de búsquedas de YouTube (conserva cuota de la API) ----------
export const youtubeSearchCache = pgTable(
  "youtube_search_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull(), // `${query normalizada}::${idioma}`
    query: text("query").notNull(),
    language: text("language").default("es").notNull(),
    // Solo IDs de video: las políticas de YouTube permiten almacenarlos a largo plazo.
    videoIds: jsonb("video_ids").$type<string[]>().notNull(),
    timesReused: integer("times_reused").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    cacheKeyIdx: uniqueIndex("youtube_search_cache_key_idx").on(t.cacheKey),
  }),
);

// ---------- Rutas de aprendizaje ----------
export const learningPaths = pgTable(
  "learning_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    goal: text("goal").notNull(), // lo que el usuario quiere lograr
    topic: text("topic").notNull(),
    language: text("language").default("es").notNull(),
    level: pathLevel("level").default("principiante").notNull(),
    status: pathStatus("status").default("draft").notNull(),
    generationProgress: integer("generation_progress").default(0).notNull(),
    generationStep: text("generation_step"),
    generationStartedAt: timestamp("generation_started_at", { withTimezone: true }),
    totalLessons: integer("total_lessons"),
    intake: jsonb("intake"), // respuestas del cuestionario inicial
    skeletonCacheKey: text("skeleton_cache_key"), // de qué esqueleto derivó
    estimatedHours: real("estimated_hours"),
    isTemplate: boolean("is_template").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("learning_paths_user_idx").on(t.userId),
    slugIdx: uniqueIndex("learning_paths_user_slug_idx").on(t.userId, t.slug),
  }),
);

// ---------- Módulos ----------
export const modules = pgTable(
  "modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    objective: text("objective"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pathIdx: index("modules_path_idx").on(t.pathId),
    orderUniq: uniqueIndex("modules_path_order_idx").on(t.pathId, t.orderIndex),
  }),
);

// ---------- Lecciones ----------
export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .references(() => modules.id, { onDelete: "cascade" })
      .notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    content: jsonb("content"), // bloques estructurados de la lección
    notes: text("notes"),
    estimatedMinutes: integer("estimated_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    moduleIdx: index("lessons_module_idx").on(t.moduleId),
    orderUniq: uniqueIndex("lessons_module_order_idx").on(t.moduleId, t.orderIndex),
  }),
);

// ---------- Candidatos de video de YouTube (principal + alternativas) ----------
export const videoCandidates = pgTable(
  "video_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title"),
    channelTitle: text("channel_title"),
    rank: integer("rank").default(0).notNull(), // 0 = principal, 1+ = respaldo
    score: real("score"),
    language: text("language"),
    durationSeconds: integer("duration_seconds"),
    reason: text("reason"), // justificación del ranking (Haiku)
    isActive: boolean("is_active").default(true).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    lessonIdx: index("video_candidates_lesson_idx").on(t.lessonId),
    rankUniq: uniqueIndex("video_candidates_lesson_rank_idx").on(
      t.lessonId,
      t.rank,
    ),
  }),
);

// ---------- Cuestionarios ----------
export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "cascade",
    }),
    moduleId: uuid("module_id").references(() => modules.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    lessonIdx: index("quizzes_lesson_idx").on(t.lessonId),
    lessonUniq: uniqueIndex("quizzes_lesson_uniq_idx").on(t.lessonId),
  }),
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quizId: uuid("quiz_id")
      .references(() => quizzes.id, { onDelete: "cascade" })
      .notNull(),
    orderIndex: integer("order_index").notNull(),
    type: questionType("type").default("single").notNull(),
    prompt: text("prompt").notNull(),
    options: jsonb("options"), // [{id, text}]
    correctAnswer: jsonb("correct_answer"), // ids correctos o rúbrica (open)
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    quizIdx: index("questions_quiz_idx").on(t.quizId),
    orderUniq: uniqueIndex("questions_quiz_order_idx").on(t.quizId, t.orderIndex),
  }),
);

// ---------- Progreso ----------
export const progress = pgTable(
  "progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    status: progressStatus("status").default("not_started").notNull(),
    score: real("score"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqUserLesson: uniqueIndex("progress_user_lesson_idx").on(
      t.userId,
      t.lessonId,
    ),
  }),
);

export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  quizId: uuid("quiz_id")
    .references(() => quizzes.id, { onDelete: "cascade" })
    .notNull(),
  answers: jsonb("answers"),
  score: real("score"),
  passed: boolean("passed").default(false).notNull(),
  feedback: jsonb("feedback"), // corrección por pregunta (Haiku)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Tutor de IA ----------
export const tutorConversations = pgTable("tutor_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  pathId: uuid("path_id").references(() => learningPaths.id, {
    onDelete: "cascade",
  }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tutorMessages = pgTable(
  "tutor_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => tutorConversations.id, { onDelete: "cascade" })
      .notNull(),
    role: tutorRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ convIdx: index("tutor_messages_conv_idx").on(t.conversationId) }),
);

// ---------- Monetización ----------
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  plan: planType("plan").default("free").notNull(),
  status: subStatus("status").default("active").notNull(),
  provider: paymentProvider("provider"),
  providerSubscriptionId: text("provider_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Compra única de una ruta ($19)
export const pathPurchases = pgTable("path_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  pathId: uuid("path_id").references(() => learningPaths.id, {
    onDelete: "set null",
  }),
  provider: paymentProvider("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  amount: real("amount").notNull(),
  currency: text("currency").default("USD").notNull(),
  status: paymentStatus("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Tipos inferidos para usar en la app ----------
export type Profile = typeof profiles.$inferSelect;
export type LearningPath = typeof learningPaths.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type VideoCandidate = typeof videoCandidates.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Progress = typeof progress.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
