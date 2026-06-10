import { z } from "zod";

/** Respuestas del cuestionario inicial (intake). */
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
  summary: z.string(),
  estimatedMinutes: z.number().int(),
});

export const moduleStubSchema = z.object({
  title: z.string(),
  objective: z.string(),
  description: z.string(),
  lessons: z.array(lessonStubSchema),
});

export const pathSkeletonSchema = z.object({
  title: z.string(),
  summary: z.string(),
  level: z.enum(["principiante", "intermedio", "avanzado"]),
  estimatedHours: z.number(),
  modules: z.array(moduleStubSchema),
});
export type PathSkeleton = z.infer<typeof pathSkeletonSchema>;

/** Contenido de una lección (lo genera Sonnet). */
export const lessonContentSchema = z.object({
  intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  keyTakeaways: z.array(z.string()),
  practice: z.string(),
  /** Query óptima para buscar el video de apoyo en YouTube. */
  videoSearchQuery: z
    .string()
    .describe(
      "Búsqueda de YouTube CORTA (3-6 palabras) en el idioma del estudiante, sin jerga en inglés ni signos de puntuación, optimizada para encontrar un buen tutorial en ese idioma.",
    ),
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

/** Cuestionario (lo genera Sonnet). */
export const quizSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(["single", "multiple", "open"]),
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
