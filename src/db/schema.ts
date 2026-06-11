import { sql } from "drizzle-orm";
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
  primaryKey,
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
export const paymentProvider = pgEnum("payment_provider", [
  "flow",
  "stripe",
  "mercadopago",
]);
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
  "class_summary",
  "class_reminder",
  // Ciclo de vida de ingresos (gateados por LIFECYCLE_EMAILS_ENABLED):
  // aviso de renovación Pro D-3/D0 y recuperación de carro T+1h/T+24h.
  "pro_expiring",
  "cart_recovery",
]);
export const liveSessionStatus = pgEnum("live_session_status", [
  "scheduled",
  "in_progress",
  "completed",
  "missed",
  "canceled",
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
  // WhatsApp para avisos de ruta lista y remarketing (capturado en el wizard).
  phone: text("phone"),
  // Acceso al dashboard /app/admin (complementado por env.ADMIN_EMAILS).
  isAdmin: boolean("is_admin").default(false).notNull(),
  // Customer de Flow (cobro recurrente de la suscripción Pro).
  flowCustomerId: text("flow_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Intents de ruta (embudo + carro abandonado) ----------
// El wizard completo se guarda AQUÍ antes del paywall: si el usuario no paga,
// tenemos tema + contacto para remarketing; si paga, el webhook crea la ruta.
export const routeIntents = pgTable(
  "route_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    topic: text("topic").notNull(),
    level: text("level").notNull(),
    language: text("language").default("es").notNull(),
    goal: text("goal").notNull(),
    priorExperience: text("prior_experience"),
    weeklyHours: integer("weekly_hours"),
    phone: text("phone"),
    // pending_payment → paid (webhook) | bypassed (paywall off / Pro / admin)
    status: text("status").default("pending_payment").notNull(),
    // Preview REAL para el paywall (Haiku): títulos de módulos + gancho.
    preview: jsonb("preview").$type<{
      modules: string[];
      hook: string;
      metaDisplay: string;
    }>(),
    pathId: uuid("path_id").references(() => learningPaths.id, {
      onDelete: "set null",
    }),
    amountClp: integer("amount_clp"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    sourcePathId: uuid("source_path_id"), // métrica "Siguiente paso"
    // Tema normalizado por el topicCheck del wizard (sin typos/acentos, slug
    // corto). Es el eje del cacheKey canónico: sin él, "Fotografía" y
    // "fotografia" generan dos canones distintos y pagan Opus dos veces.
    canonicalTopic: text("canonical_topic"),
    // Arquetipo de meta (hobby|trabajo|emprender…): NO faceta la key del caché
    // (decisión fundador: esqueleto goal-neutral + overlay), pero habilita
    // analítica de conversión y el cambio a facetado sería 1 línea después.
    goalArchetype: text("goal_archetype"),
    // Respuestas crudas del wizard (hoy se aplanan en 2 strings y se pierde
    // toda señal discreta: re-facetar caché, analítica, brief del profesor).
    wizardAnswers: jsonb("wizard_answers"),
    // Fecha/evento objetivo del estudiante. La columna existe para el plan de
    // ritmo per-usuario, pero NO se pregunta en el wizard (decisión fundador).
    deadline: text("deadline"),
    // Atribución del funnel de continuación: card | email | clase_cierre.
    clickedVia: text("clicked_via"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("route_intents_user_idx").on(t.userId, t.createdAt),
    statusIdx: index("route_intents_status_idx").on(t.status, t.createdAt),
  }),
);

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

// ---------- Caché de CONTENIDO de lección (canónico por esqueleto) ----------
// Extiende el patrón skeleton_cache al contenido: cada usuario del mismo
// tema+nivel+idioma reutiliza las lecciones y quizzes ya generados (el mayor
// ahorro de la plataforma: ~USD 1.5-2 de Sonnet por ruta repetida, y la
// generación pasa de minutos a segundos). El contenido es canónico — lo
// personal vive en el overlay (plan de intake), nunca aquí.
export const lessonContentCache = pgTable(
  "lesson_content_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull(), // = skeleton_cache.cache_key
    moduleIndex: integer("module_index").notNull(),
    lessonIndex: integer("lesson_index").notNull(),
    version: integer("version").default(1).notNull(),
    content: jsonb("content").notNull(), // LessonContent (incl. videoGuide canónico)
    quiz: jsonb("quiz"), // GeneratedQuiz (preguntas listas para insertar)
    // IDs de los videos curados+verificados del canónico (rank asc). En HIT se
    // re-consultan los metadatos frescos vía videos.list (1 unidad/50) — así la
    // videoGuide SIEMPRE corresponde al video mostrado y cumplimos los 30 días.
    videoIds: jsonb("video_ids").$type<string[]>(),
    // --- Salud del canon (gate de calidad A-P0.1) ---
    // El canon se sirve a N ventas futuras: si se cacheó degradado (sin quiz,
    // sin digest, video rechazado) hay que poder detectarlo y repararlo sin
    // adivinar. Estas columnas son el diagnóstico; el gate decide con ellas.
    // Video al que la videoGuide/quiz están ancladas. Si en un HIT el video
    // vivo difiere de este id, la guía NO corresponde → re-anclar, no copiar.
    anchoredVideoId: text("anchored_video_id"),
    // Query de búsqueda que produjo el video ancla (insumo de reanchorLesson
    // y del backfill: re-curar sin re-generar toda la lección).
    videoQuery: text("video_query"),
    hadDigest: boolean("had_digest"), // ¿hubo digest de Gemini al generar?
    coverage: real("coverage"), // score del coverage gate del video ancla
    videoCount: integer("video_count"), // candidatos verificados al cachear
    quizOk: boolean("quiz_ok"), // ¿el quiz se generó y validó?
    // Terminología que el video ancla introdujo (digest.terminology, top 5).
    // El vocab del contexto acumulado (A-P0.2) se reconstruye DESDE AQUÍ en
    // cache-hit/resume: sin esta columna, las lecciones canónicas generadas
    // tras un resume salían con vocabulario vacío (dependía del historial de
    // runs, no del esqueleto).
    terminology: jsonb("terminology").$type<string[]>(),
    // false = lección canónica SIN video verificado (gate rechazó o cuota):
    // honesto en BD para que el HIT no "promueva" un video jamás verificado.
    anchored: boolean("anchored").default(true).notNull(),
    timesReused: integer("times_reused").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqLesson: uniqueIndex("lesson_content_cache_key_idx").on(
      t.cacheKey,
      t.moduleIndex,
      t.lessonIndex,
      t.version,
    ),
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
    // Strikes de reconciliación (paso 4 de src/lib/ops/reconcile.ts): cuántas
    // veces el cron re-encoló esta generación colgada. runPathGeneration
    // resetea generation_started_at en CADA run, así que un umbral por minutos
    // jamás se cruza si el re-run sí arranca y vuelve a morir; este contador
    // NO se resetea entre runs → >=2 strikes = failed real (sin loop de
    // re-enqueues quemando tokens y cuota de YouTube). La reconciliación lo
    // vuelve a 0 al marcar failed para que el "Reintentar" manual parta limpio.
    generationRequeues: integer("generation_requeues").default(0).notNull(),
    totalLessons: integer("total_lessons"),
    intake: jsonb("intake"), // respuestas del cuestionario inicial
    skeletonCacheKey: text("skeleton_cache_key"), // de qué esqueleto derivó
    estimatedHours: real("estimated_hours"),
    isTemplate: boolean("is_template").default(false).notNull(),
    // Overlay de personalización (decisión fundador, Opción A): el esqueleto y
    // las lecciones son canónicos goal-neutral; lo "hecho para ti" vive AQUÍ.
    // 2-3 frases (modelo barato) conectando la meta del estudiante con la ruta.
    routeIntro: text("route_intro"),
    // Métrica norte del "Siguiente paso": de qué ruta completada nació esta.
    sourcePathId: uuid("source_path_id"),
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
    // 'plan' = del esqueleto original; 'teacher' = agregado por el profesor IA
    // post-clase en base al feedback del alumno (la ruta se moldea).
    source: text("source").default("plan").notNull(),
    // Overlay por módulo (par de learning_paths.route_intro): nota personal de
    // 1 frase «Para tu meta: …». NUNCA va al caché canónico.
    personalNote: text("personal_note"),
    // Sesión de clase que originó el módulo (source='teacher'): dedupe
    // determinístico de extend-path — reintentos at-least-once de Trigger.dev
    // no deben duplicar el módulo propuesto en vivo.
    sourceSessionId: text("source_session_id"),
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
    // Summary del stub del esqueleto (qué sabrá HACER el estudiante). Hoy se
    // descarta tras insertar; reanchorLesson lo necesita para re-curar video
    // sin re-generar la lección (sin él usa el título, mucho más pobre).
    stubSummary: text("stub_summary"),
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

// ---------- Ratings de módulos (feedback loop de calidad) ----------
// Binario (up/down): Netflix midió +200% de volumen vs estrellas, y el flag de
// regeneración del canónico necesita volumen rápido. Único por user+module.
export const moduleRatings = pgTable(
  "module_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    moduleId: uuid("module_id")
      .references(() => modules.id, { onDelete: "cascade" })
      .notNull(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    rating: text("rating").notNull(), // 'up' | 'down'
    reason: text("reason"), // chip opcional en thumbs-down (video|texto|quiz|nivel)
    comment: text("comment"), // texto libre opcional
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqUserModule: uniqueIndex("module_ratings_user_module_idx").on(
      t.userId,
      t.moduleId,
    ),
    moduleIdx: index("module_ratings_module_idx").on(t.moduleId),
  }),
);

// ---------- Sugerencia de "Siguiente paso" (post-ruta completada) ----------
// Una por ruta completada (la genera el hito y queda congelada, consistente
// con el correo). Cacheable cross-usuario por skeletonCacheKey.
export const nextPathSuggestions = pgTable(
  "next_path_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    sourcePathId: uuid("source_path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    skeletonCacheKey: text("skeleton_cache_key"),
    topic: text("topic").notNull(),
    goal: text("goal").notNull(),
    level: pathLevel("level").notNull(),
    reasons: jsonb("reasons").$type<string[]>().default([]).notNull(),
    source: text("source").default("haiku").notNull(), // haiku|deterministic|cache
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqSourcePath: uniqueIndex("next_path_suggestions_source_idx").on(
      t.sourcePathId,
    ),
    skeletonIdx: index("next_path_suggestions_skeleton_idx").on(
      t.skeletonCacheKey,
    ),
  }),
);

// ---------- Clases en vivo con profesor IA ----------
// Persona del profesor: UNA por esqueleto canónico (compartida entre usuarios
// del mismo tema, como el contenido). La voz/LLM viven en ElevenLabs; la
// identidad pedagógica vive aquí (lock-in bajo, migrable a LiveKit).
export const routeAgents = pgTable(
  "route_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull(), // = skeleton_cache.cache_key
    name: text("name").notNull(), // "Profe Valentina"
    specialty: text("specialty").notNull(),
    style: text("style").notNull(), // estilo pedagógico en 1-2 frases
    greeting: text("greeting").notNull(), // saludo de marca
    systemPrompt: text("system_prompt").notNull(), // persona + arco NSSA
    elevenlabsAgentId: text("elevenlabs_agent_id"), // agente creado vía API
    voiceId: text("voice_id"),
    approved: boolean("approved").default(false).notNull(), // curaduría del fundador
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ cacheKeyUniq: uniqueIndex("route_agents_cache_key_idx").on(t.cacheKey) }),
);

// Sesiones de clase (agendadas y on-demand). El cupo se mide en MINUTOS
// (sum(duration_sec)) server-side ANTES de emitir credenciales.
export const liveSessions = pgTable(
  "live_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    status: liveSessionStatus("status").default("scheduled").notNull(),
    kind: text("kind").default("class").notNull(), // class | induction
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec").default(0).notNull(),
    conversationId: text("conversation_id"), // id de ElevenLabs
    summary: jsonb("summary"), // destilado post-clase (Haiku)
    // Módulos que el profesor propuso EN VIVO (client tool agregar_modulo);
    // al cerrar la clase se generan de verdad vía extend-path.
    proposedModules: jsonb("proposed_modules")
      .$type<{ title: string; reason: string }[]>()
      .default([])
      .notNull(),
    exitTicket: text("exit_ticket"), // respuesta metacognitiva del cierre
    reminderRunIds: jsonb("reminder_run_ids").$type<string[]>(), // para cancelar al reagendar
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("live_sessions_user_idx").on(t.userId, t.createdAt),
    statusIdx: index("live_sessions_status_idx").on(t.status, t.scheduledAt),
  }),
);

// Tareas asignadas por el profesor (el loop: la tarea de hoy es el entrance
// ticket de la próxima clase).
export const homeworkItems = pgTable(
  "homework_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => liveSessions.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    task: text("task").notNull(),
    kind: text("kind").default("retrieval").notNull(), // retrieval | aplicada
    // Recursos INTERNOS de apoyo (links a lecciones de la ruta — jamás
    // URLs externas inventadas por la IA).
    resources: jsonb("resources")
      .$type<{ title: string; href: string }[]>()
      .default([])
      .notNull(),
    done: boolean("done").default(false).notNull(),
    reviewedInSessionId: uuid("reviewed_in_session_id").references(
      () => liveSessions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userPathIdx: index("homework_user_path_idx").on(t.userId, t.pathId, t.done),
  }),
);

// Memoria del alumno por ruta (merge tras cada clase, no append infinito).
export const learnerProfiles = pgTable(
  "learner_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    pathId: uuid("path_id")
      .references(() => learningPaths.id, { onDelete: "cascade" })
      .notNull(),
    profile: jsonb("profile").notNull(), // fortalezas, trabas, preferencias, últimaClase
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqUserPath: uniqueIndex("learner_profiles_user_path_idx").on(t.userId, t.pathId),
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
  // Cancelación al final del período: el acceso se conserva hasta period_end.
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Contabilidad de cobros únicos: rutas Y meses de Pro manual (kind).
export const pathPurchases = pgTable("path_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  pathId: uuid("path_id").references(() => learningPaths.id, {
    onDelete: "set null",
  }),
  // route = una ruta · pro_month = 30 días de Pro (cobro único, sin PAT)
  kind: text("kind").default("route").notNull(),
  provider: paymentProvider("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  amount: real("amount").notNull(),
  currency: text("currency").default("USD").notNull(),
  status: paymentStatus("status").default("pending").notNull(),
  // Atribución de la compra (paywall_intent | planes_limite | planes_clases |
  // dashboard_banner | perfil_renovacion | profesores_upsell | post_clase |
  // quiz_trabado): sin esto no se puede optimizar ningún CTA de Pro.
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Ops y observabilidad (migración fundacional IA) ----------

// Ledger de uso de la API de Anthropic (res.usage por llamada). Responde las
// preguntas de negocio que hoy son fe: costo real por ruta fresca vs cacheada,
// % de cache-hit de prompts (>0 por primera vez) y el insumo del kill-switch
// de costo diario (AI_DISABLED).
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(), // etapa: planner | lesson | quiz | ranker | wizard | overlay…
    // Nullable: el wizard y las llamadas del funnel ocurren antes de que
    // exista una ruta. set null para no perder el costo si se borra la ruta.
    pathId: uuid("path_id").references(() => learningPaths.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheRead: integer("cache_read").default(0).notNull(), // cache_read_input_tokens
    cacheWrite: integer("cache_write").default(0).notNull(), // cache_creation_input_tokens
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index("ai_usage_created_idx").on(t.createdAt), // costo del día (admin)
    pathIdx: index("ai_usage_path_idx").on(t.pathId), // costo por ruta p50-p95
  }),
);

// Incidentes operativos (alertFounder los inserta además de correo/WhatsApp):
// banner rojo en admin + historial. El UNIQUE por hora es el dedupe — una
// ráfaga del mismo fallo no spamea al fundador ni llena la tabla.
export const opsIncidents = pgTable(
  "ops_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    severity: text("severity").default("critical").notNull(), // critical | warning
    title: text("title").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    // date_trunc sobre timestamptz no es IMMUTABLE (depende de la TZ de la
    // sesión); anclamos a UTC para que Postgres acepte la expresión en el
    // índice y el bucket horario sea estable.
    uniqTitleHour: uniqueIndex("ops_incidents_title_hour_idx").on(
      t.title,
      sql`date_trunc('hour', ${t.createdAt} at time zone 'utc')`,
    ),
    openIdx: index("ops_incidents_open_idx").on(t.resolvedAt, t.createdAt),
  }),
);

// Cuota diaria de APIs externas (YouTube: 100 u./search, 1 u./details).
// Con 10K unidades/día el techo es ~4 rutas frescas: el contador alimenta el
// circuit-breaker (umbral 8.500 → encolar backfill, no buscar), la alerta al
// 80% y la evidencia para pedir aumento de cuota a Google.
export const quotaUsage = pgTable("quota_usage", {
  day: date("day").primaryKey(),
  youtubeUnits: integer("youtube_units").default(0).notNull(),
  // Conteo de requests a Gemini (digests): distinción 429 vs 400 (E-P2).
  geminiRequests: integer("gemini_requests").default(0).notNull(),
});

// Rate limiting de ventana fija en Postgres (sin Redis): una sola query
// INSERT … ON CONFLICT … count = count + 1 RETURNING. Consumidores: funnel
// público (wizard/cuentas por IP) y /api/tutor.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(), // p.ej. "wizard:ip:1.2.3.4"
    window: timestamp("window", { withTimezone: true }).notNull(), // inicio de la ventana
    count: integer("count").default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.window] }),
  }),
);

// Caché de preguntas del wizard público por (canonicalTopic, level, language):
// el paso 1→2 se vuelve instantáneo en temas calientes (mejor conversión) y
// un bot deja de facturar Haiku ilimitado.
export const wizardQuestionsCache = pgTable(
  "wizard_questions_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull(),
    questions: jsonb("questions").notNull(), // wizardSchema completo (incl. topicCheck)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    cacheKeyUniq: uniqueIndex("wizard_questions_cache_key_idx").on(t.cacheKey),
  }),
);

// Cola de re-curación de video: cuando la cuota YouTube se agota o un rank 0
// muere (link-rot 2-strike), la lección entra aquí y el cron diario
// backfill-videos la drena vía reanchorLesson — en vez de cachear canon
// degradado o servir un video muerto.
export const videoBackfillQueue = pgTable(
  "video_backfill_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    reason: text("reason").notNull(), // quota_exceeded | link_rot | gate_rechazado
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    // El drain busca WHERE processed_at IS NULL ORDER BY created_at.
    pendingIdx: index("video_backfill_queue_pending_idx").on(
      t.processedAt,
      t.createdAt,
    ),
  }),
);

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
export type AiUsage = typeof aiUsage.$inferSelect;
export type OpsIncident = typeof opsIncidents.$inferSelect;
export type VideoBackfillItem = typeof videoBackfillQueue.$inferSelect;
