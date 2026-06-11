import { z } from "zod";

/** Respuestas del cuestionario inicial (intake).
 *  OJO seguridad: este schema parsea input del CLIENTE (funnel/wizard). Lo
 *  que decide el cacheKey canónico (canonical_topic, variant) NO vive aquí —
 *  se lee server-side desde route_intents (lo persiste el wizard, Track B);
 *  si viniera en el intake un cliente podría envenenar el canon compartido. */
export const intakeSchema = z.object({
  topic: z.string().min(2),
  goal: z.string().min(3),
  level: z.enum(["principiante", "intermedio", "avanzado"]),
  priorExperience: z.string().optional(),
  weeklyHours: z.number().int().positive().max(80).optional(),
  language: z.string().default("es"),
});
export type Intake = z.infer<typeof intakeSchema>;

/** Esqueleto de la ruta (lo genera Opus). */
export const lessonStubSchema = z.object({
  title: z.string(),
  // El campo más load-bearing del pipeline: guía la query de video, el
  // coverage gate de Gemini Y el contenido de la lección (A-P1.5c).
  summary: z
    .string()
    .describe(
      "2-3 frases concretas: qué sabrá HACER el estudiante al terminar; menciona el medio/herramienta de la ruta — este texto guía la curación del video de apoyo y el coverage gate",
    ),
  estimatedMinutes: z.number().int().min(5).max(15),
});

export const moduleStubSchema = z.object({
  title: z.string(),
  objective: z.string(),
  description: z.string(),
  // Andamiaje declarado (A-P1.5b): alimenta el contexto acumulado entre
  // lecciones. Nullable: esqueletos cacheados pre-cambio no lo traen.
  buildsOn: z
    .string()
    .nullable()
    .describe(
      "qué habilidad o concepto del módulo ANTERIOR usa y extiende este módulo (null solo en el primer módulo)",
    ),
  lessons: z.array(lessonStubSchema),
});

export const pathSkeletonSchema = z.object({
  title: z.string(),
  summary: z.string(),
  // Arco del curso (A-P1.5b): se inyecta en el contexto de cada lección para
  // que las 24 lecciones cuenten UNA historia. Nullable por esqueletos viejos.
  narrativeThread: z
    .string()
    .nullable()
    .describe(
      "el arco del curso en 1-2 frases: de dónde parte el estudiante, por dónde pasa y qué es capaz de hacer al final",
    ),
  level: z.enum(["principiante", "intermedio", "avanzado"]),
  estimatedHours: z.number(),
  // 5-7 módulos (A-P1.5d): el SDK valida client-side → violación = error
  // detectable en vez de ruta deforme silenciosa.
  modules: z.array(moduleStubSchema).min(5).max(7),
});
export type PathSkeleton = z.infer<typeof pathSkeletonSchema>;

/** Contenido de una lección (lo genera Sonnet).
 *  Nota A-P2: se eliminó `videoSearchQuery` — era vestigial (el video se
 *  elige ANTES de escribir la lección, desde los stubs; nadie leía el campo
 *  y el prompt le dedicaba su bloque más largo). */
export const lessonContentSchema = z.object({
  intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  keyTakeaways: z.array(z.string()),
  practice: z.string(),
  /** Guía del video (solo cuando se proveyó digest del video; si no, null). */
  videoGuide: z
    .union([
      z.object({
        intro: z
          .string()
          .describe("1-2 frases: qué verá el estudiante en el video y cómo complementa esta lección"),
        moments: z
          .array(
            z.object({
              timestampSeconds: z.number().describe("segundo EXACTO tomado del digest"),
              label: z.string().describe("qué pasa en ese momento, 3-8 palabras"),
            }),
          )
          .describe("2-4 momentos clave del video, SOLO con timestamps del digest"),
      }),
      z.null(),
    ])
    .describe("null si NO se entregó digest del video"),
});
export type LessonContent = z.infer<typeof lessonContentSchema>;

/** Cuestionario (lo genera Sonnet).
 *  A-P2: 'open' fuera del enum — con structured outputs es imposible por
 *  construcción (antes el prompt lo prohibía por súplica). El caller además
 *  post-valida que correctOptionIds ⊆ options[].id y no esté vacío. */
export const quizSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(["single", "multiple"]),
      prompt: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })),
      correctOptionIds: z.array(z.string()),
      explanation: z.string(),
      grounding: z
        .object({
          source: z
            .enum(["video", "lesson", "both"])
            .describe("de dónde sale la respuesta: el video, el texto de la lección, o ambos"),
          timestampSeconds: z
            .union([z.number(), z.null()])
            .describe("segundo del video donde se responde (SOLO si source incluye video y el dato viene de un ancla del digest; si no, null)"),
        })
        .describe("anclaje verificable de la pregunta"),
    }),
  ),
});
export type GeneratedQuiz = z.infer<typeof quizSchema>;

/** Queries de video por lección, derivadas de los stubs del módulo (Haiku batch). */
export const videoQueriesSchema = z.object({
  queries: z.array(
    z.object({
      lessonIndex: z.number().int(),
      query: z
        .string()
        .describe("búsqueda de YouTube corta (3-6 palabras) en el idioma del estudiante"),
    }),
  ),
});
export type VideoQueries = z.infer<typeof videoQueriesSchema>;

/** Ranking de videos (lo hace Haiku con metadatos oficiales). */
export const videoRankingSchema = z.object({
  ranked: z.array(
    z.object({
      videoId: z.string(),
      score: z.number(),
      language: z.string(),
      reason: z.string(),
    }),
  ),
});
export type VideoRanking = z.infer<typeof videoRankingSchema>;

/** Overlay de personalización por ruta (A-P0.3, Opción A del fundador):
 *  se guarda en learning_paths.route_intro + modules.personal_note —
 *  NUNCA en lesson_content_cache ni skeleton_cache. */
export const routeOverlaySchema = z.object({
  routeIntro: z
    .string()
    .describe("2-3 frases conectando la meta y experiencia del estudiante con el recorrido de la ruta"),
  moduleNotes: z.array(
    z.object({
      moduleIndex: z
        .number()
        .int()
        .describe("índice 0-based del módulo en el temario recibido"),
      note: z.string().describe("1 frase: «Para tu meta: …»"),
    }),
  ),
});
export type RouteOverlay = z.infer<typeof routeOverlaySchema>;

/** Contenido de un correo de avance (lo genera Haiku, anclado a datos reales). */
export const emailContentSchema = z.object({
  subject: z.string().describe("Asunto corto y cálido en el idioma del usuario, sin clickbait"),
  intro: z.string().describe("1-2 frases cálidas que celebran el hito concreto"),
  bullets: z
    .array(z.string())
    .describe("3-5 puntos de lo aprendido, SOLO con los títulos/datos provistos"),
  cta: z.string().describe("Frase corta del botón hacia el siguiente paso"),
});
export type EmailContent = z.infer<typeof emailContentSchema>;
