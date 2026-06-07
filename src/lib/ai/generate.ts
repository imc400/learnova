import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, cachedSystem } from "./client";
import { MODELS, MAX_TOKENS } from "./models";
import {
  SYSTEM_PEDAGOGY,
  LESSON_INSTRUCTIONS,
  QUIZ_INSTRUCTIONS,
} from "./prompts";
import {
  pathSkeletonSchema,
  lessonContentSchema,
  quizSchema,
  type Intake,
  type PathSkeleton,
  type LessonContent,
  type GeneratedQuiz,
} from "./schemas";

/**
 * NIVEL 1 — Opus 4.8 planifica el esqueleto de la ruta.
 * System pedagógico cacheado (TTL 1h) = base de la "caché de cabeza gruesa".
 */
export async function generatePathSkeleton(
  intake: Intake,
): Promise<PathSkeleton> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.planner,
    max_tokens: MAX_TOKENS.planner,
    // NOTA: structured outputs (output_config.format) NO se combina con thinking
    // adaptativo — la API puede rechazar la combinación (riesgo de 400). Opus 4.8
    // sigue el esquema con effort alto sin thinking explícito.
    system: cachedSystem(SYSTEM_PEDAGOGY),
    output_config: {
      effort: "high",
      format: zodOutputFormat(pathSkeletonSchema),
    },
    messages: [
      {
        role: "user",
        content: [
          "Diseña una ruta de aprendizaje COMPLETA a medida con estos datos del estudiante:",
          `- Tema: ${intake.topic}`,
          `- Meta concreta: ${intake.goal}`,
          `- Nivel: ${intake.level}`,
          intake.priorExperience
            ? `- Experiencia previa: ${intake.priorExperience}`
            : "- Experiencia previa: ninguna declarada",
          intake.weeklyHours
            ? `- Tiempo disponible: ~${intake.weeklyHours} h/semana`
            : "",
          `- Idioma de salida: ${intake.language}`,
          "",
          "Devuelve 5–10 módulos, cada uno con 3–6 lecciones. Títulos de lección específicos y accionables.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/** NIVEL 2 — Sonnet 4.6 genera el contenido de una lección. */
export async function generateLessonContent(args: {
  pathTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
}): Promise<LessonContent> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: MAX_TOKENS.generator,
    system: cachedSystem(`${SYSTEM_PEDAGOGY}\n\n${LESSON_INSTRUCTIONS}`),
    output_config: { format: zodOutputFormat(lessonContentSchema) },
    messages: [
      {
        role: "user",
        content: [
          `Ruta: ${args.pathTitle}`,
          `Módulo: ${args.moduleTitle} — Objetivo: ${args.moduleObjective}`,
          `Lección: ${args.lessonTitle}`,
          `Resumen esperado: ${args.lessonSummary}`,
          `Nivel: ${args.level} · Idioma: ${args.language}`,
          "",
          "Genera el contenido de esta lección y una buena query para buscar su video de apoyo en YouTube.",
        ].join("\n"),
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/** NIVEL 2 — Sonnet 4.6 genera un cuestionario para una lección. */
export async function generateQuiz(args: {
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
}): Promise<GeneratedQuiz> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: MAX_TOKENS.generator,
    system: cachedSystem(`${SYSTEM_PEDAGOGY}\n\n${QUIZ_INSTRUCTIONS}`),
    output_config: { format: zodOutputFormat(quizSchema) },
    messages: [
      {
        role: "user",
        content: `Lección: ${args.lessonTitle}\nResumen: ${args.lessonSummary}\nNivel: ${args.level} · Idioma: ${args.language}\n\nGenera el cuestionario.`,
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}
