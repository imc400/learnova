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
    }),
  ),
});
export type GeneratedQuiz = z.infer<typeof quizSchema>;

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
