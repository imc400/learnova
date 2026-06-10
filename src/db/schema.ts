import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
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
export const xpSource = pgEnum("xp_source", [
  "lesson_completed",
  "quiz_passed",
  "quiz_perfect",
  "module_completed",
  "path_completed",
  "achievement",
]);
export const achievementKind = pgEnum("achievement_kind", [
  "deterministic",
  "surprise",
]);
export const emailType = pgEnum("email_type", [
  "welcome",
  "module_ready",
  "module_learned",
  "path_completed",
  "streak_at_risk",
  "weekly_recap",
  "reengagement",
]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "claimed",
  "sent",
  "skipped",
  "failed",
]);

// ---------- Perfiles ----------
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // = auth.users.id
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  locale: text("locale").default("es-CL").notNull(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  // Gamificación (agregados; la verdad granular vive en xp_events).
  totalXp: integer("total_xp").default(0).notNull(),
  level: integer("level").default(1).notNull(),
  currentStreak: integer("current_streak").default(0).notNull(),
  longestStreak: integer("longest_streak").default(0).notNull(),
  lastActiveDay: date("last_active_day"), // día (TZ del usuario) de la última actividad
  streakFreezes: integer("streak_freezes").default(2).notNull(), // perdón de racha
  // Email: copiado desde auth.users por handle_new_user (evita leer auth.* en cada envío).
  email: text("email"),
  // Comunidad/leaderboard: visible por defecto con opt-out de 1 clic; el alias
  // reemplaza al nombre de pila si el usuario lo prefiere. NUNCA se expone PII.
  leaderboardVisible: boolean("leaderboard_visible").default(true).notNull(),
  leaderboardAlias: text("leaderboard_alias"),
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

// ---------- Insights de video (digest de Gemini, cacheado por videoId) ----------
// Output de Gemini/Haiku (NO metadatos crudos de la Data API → sin regla de 30
// días). Se calcula UNA vez por video en la vida de la plataforma y se comparte
// entre rutas y usuarios. source distingue el proveedor (gemini | metadata).
export const videoInsights = pgTable(
  "video_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    language: text("language").default("es").notNull(), // idioma del digest
    source: text("source").default("gemini").notNull(), // gemini | metadata
    digest: jsonb("digest").notNull(), // VideoDigest (outline, anchors, coverage…)
    audioLanguage: text("audio_language"),
    durationSeconds: integer("duration_seconds"),
    model: text("model"),
    timesReused: integer("times_reused").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    videoUniq: uniqueIndex("video_insights_video_lang_idx").on(
      t.youtubeVideoId,
      t.language,
    ),
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
    lessonIdx: index("progress_lesson_idx").on(t.lessonId), // cascadas de borrado
    pathUserIdx: index("progress_path_user_idx").on(t.pathId, t.userId), // conteos por ruta
  }),
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
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
  },
  (t) => ({
    userIdx: index("quiz_attempts_user_idx").on(t.userId), // contadores de logros
    quizIdx: index("quiz_attempts_quiz_idx").on(t.quizId), // cascadas de borrado
  }),
);

// ---------- Gamificación ----------
// Ledger append-only de XP. El índice único (user, source, ref) es la garantía
// de idempotencia: recompletar una lección o reaprobar un quiz no duplica XP
// (clave porque Trigger.dev y los reintentos de actions son at-least-once).
export const xpEvents = pgTable(
  "xp_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    source: xpSource("source").notNull(),
    refId: uuid("ref_id").notNull(), // lessonId / quizId / moduleId / pathId / achievementId
    points: integer("points").notNull(),
    weekStart: date("week_start").notNull(), // lunes de la semana (para ligas/recaps)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqSourceRef: uniqueIndex("xp_events_user_source_ref_idx").on(
      t.userId,
      t.source,
      t.refId,
    ),
    userWeekIdx: index("xp_events_user_week_idx").on(t.userId, t.weekStart),
    weekUserIdx: index("xp_events_week_user_idx").on(t.weekStart, t.userId), // ranking semanal
  }),
);

// Catálogo de logros (semilla en la migración). Pocos y significativos.
export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // p.ej. "first_lesson", "streak_7"
    title: text("title").notNull(),
    description: text("description").notNull(),
    icon: text("icon").notNull(), // nombre de ícono lucide
    kind: achievementKind("kind").default("deterministic").notNull(),
    xpReward: integer("xp_reward").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ codeUniq: uniqueIndex("achievements_code_idx").on(t.code) }),
);

export const userAchievements = pgTable(
  "user_achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    achievementId: uuid("achievement_id")
      .references(() => achievements.id, { onDelete: "cascade" })
      .notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqUserAch: uniqueIndex("user_achievements_user_ach_idx").on(
      t.userId,
      t.achievementId,
    ),
  }),
);

// ---------- Motor de correos por avance ----------
// Outbox transaccional + cola idempotente. Se inserta en la MISMA transacción
// que el progreso (sin dual-write); UNIQUE(user,type,dedupe) hace que los
// reintentos at-least-once de Trigger.dev resulten en effectively-once.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    type: emailType("type").notNull(),
    dedupeKey: text("dedupe_key").notNull(), // moduleId/pathId/semana-ISO/fecha
    payload: jsonb("payload"), // contexto crudo del avance (ids+títulos+scores), NO el cuerpo
    status: outboxStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqDedupe: uniqueIndex("email_outbox_user_type_dedupe_idx").on(
      t.userId,
      t.type,
      t.dedupeKey,
    ),
    statusIdx: index("email_outbox_status_idx").on(t.status, t.createdAt),
  }),
);

// Preferencias y opt-out granular (CAN-SPAM/GDPR) + frequency cap + timezone.
export const emailPreferences = pgTable("email_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  unsubscribedAll: boolean("unsubscribed_all").default(false).notNull(),
  allowModuleReady: boolean("allow_module_ready").default(true).notNull(),
  allowLearned: boolean("allow_learned").default(true).notNull(),
  allowStreak: boolean("allow_streak").default(true).notNull(),
  allowWeeklyRecap: boolean("allow_weekly_recap").default(true).notNull(),
  allowReengagement: boolean("allow_reengagement").default(true).notNull(),
  maxPerWeek: integer("max_per_week").default(3).notNull(),
  timezone: text("timezone").default("America/Santiago").notNull(),
  unsubToken: uuid("unsub_token").defaultRandom().notNull().unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Registro de envíos + métricas de entregabilidad (webhooks de Resend).
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    outboxId: uuid("outbox_id").references(() => emailOutbox.id, {
      onDelete: "set null",
    }),
    type: emailType("type").notNull(),
    subject: text("subject"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
  },
  (t) => ({
    userSentIdx: index("email_log_user_sent_idx").on(t.userId, t.sentAt),
    providerIdx: index("email_log_provider_idx").on(t.providerMessageId),
  }),
);

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
export type XpEvent = typeof xpEvents.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
