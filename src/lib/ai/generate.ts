import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, cachedSystem } from "./client";
import { MODELS, MAX_TOKENS } from "./models";
import {
  SYSTEM_PEDAGOGY,
  LESSON_INSTRUCTIONS,
  QUIZ_INSTRUCTIONS,
  EMAIL_PROGRESS_INSTRUCTIONS,
  VIDEO_QUERIES_INSTRUCTIONS,
  LESSON_VIDEO_ANCHOR_INSTRUCTIONS,
} from "./prompts";
import {
  pathSkeletonSchema,
  lessonContentSchema,
  quizSchema,
  emailContentSchema,
  videoQueriesSchema,
  type Intake,
  type PathSkeleton,
  type LessonContent,
  type GeneratedQuiz,
  type EmailContent,
  type VideoQueries,
} from "./schemas";
import type { VideoDigest } from "@/lib/video/insights";

/** Contexto compacto del digest para inyectar en prompts (controla tokens). */
function digestContext(digest: VideoDigest): string {
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return [
    "DIGEST DEL VIDEO DE APOYO (datos REALES del video; única fuente para timestamps):",
    "Temario: " + digest.outline.map((o) => `[${mm(o.timestampSeconds)}|${o.timestampSeconds}s] ${o.topic}`).join(" · "),
    "Terminología del creador: " + digest.terminology.slice(0, 10).join(", "),
    "Conceptos: " + digest.keyConcepts.slice(0, 8).join(", "),
    digest.coverageNotes ? "NO cubre (compleméntalo en la lección): " + digest.coverageNotes : "",
    "Anclas citables: " + digest.quizAnchors.slice(0, 8).map((a) => `[${a.timestampSeconds}s] ${a.fact}`).join(" · "),
    `Idioma del audio: ${digest.audioLanguage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

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
          "Devuelve EXACTAMENTE 5–7 módulos, cada uno con 3–4 lecciones (MÁXIMO ~24 lecciones en total). Currículum enfocado y de alta calidad, NO exhaustivo: prioriza lo esencial para lograr la meta. Títulos de lección específicos y accionables.",
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

/** NIVEL 2 — Sonnet 4.6 genera el contenido de una lección.
 *  Si llega videoDigest, la lección se genera ANCLADA al video en esta misma
 *  llamada (terminología del creador, orden compatible, videoGuide con minutos
 *  reales) — nunca una re-pasada (costaría doble). */
export async function generateLessonContent(args: {
  pathTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
  videoDigest?: VideoDigest | null;
}): Promise<LessonContent> {
  const client = getAnthropic();
  const hasDigest = !!args.videoDigest;
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: MAX_TOKENS.generator,
    system: cachedSystem(
      `${SYSTEM_PEDAGOGY}\n\n${LESSON_INSTRUCTIONS}\n\n${LESSON_VIDEO_ANCHOR_INSTRUCTIONS}`,
    ),
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
          hasDigest
            ? digestContext(args.videoDigest!)
            : "SIN digest de video disponible → videoGuide debe ser null.",
          "",
          "Genera el contenido de esta lección y una buena query para buscar su video de apoyo en YouTube.",
        ].join("\n"),
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  const content = res.parsed_output;
  // Cinturón y tirantes: sin digest no puede existir videoGuide; con digest,
  // cada momento debe corresponder a un timestamp real (±60s de outline/anchors).
  if (!hasDigest) return { ...content, videoGuide: null };
  if (content.videoGuide) {
    const valid = new Set([
      ...args.videoDigest!.outline.map((o) => o.timestampSeconds),
      ...args.videoDigest!.quizAnchors.map((a) => a.timestampSeconds),
      ...args.videoDigest!.examples.map((e) => e.timestampSeconds),
    ]);
    const near = (t: number) => [...valid].some((v) => Math.abs(v - t) <= 60);
    const moments = content.videoGuide.moments.filter((m) => near(m.timestampSeconds));
    content.videoGuide = moments.length ? { ...content.videoGuide, moments } : null;
  }
  return content;
}

/** NIVEL 3 — Haiku deriva las queries de video de TODO un módulo en 1 llamada
 *  (desde los stubs del esqueleto: el video se elige ANTES de escribir la lección). */
export async function generateVideoQueries(args: {
  moduleTitle: string;
  moduleObjective: string;
  lessons: { index: number; title: string; summary: string }[];
  language: string;
}): Promise<VideoQueries> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: MAX_TOKENS.ranker,
    system: cachedSystem(VIDEO_QUERIES_INSTRUCTIONS),
    output_config: { format: zodOutputFormat(videoQueriesSchema) },
    messages: [
      {
        role: "user",
        content: [
          `Módulo: ${args.moduleTitle} — Objetivo: ${args.moduleObjective}`,
          `Idioma del estudiante: ${args.language}`,
          "Lecciones:",
          ...args.lessons.map((l) => `${l.index}. ${l.title} — ${l.summary}`),
        ].join("\n"),
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/**
 * NIVEL 3 — Haiku 4.5 redacta el correo de avance ("esto aprendiste").
 * Grounding duro: el contexto trae SOLO títulos/datos reales; el caller
 * post-valida que los bullets no contradigan los datos antes de enviar.
 */
export async function generateProgressEmail(args: {
  kind: "module_learned" | "path_completed";
  pathTitle: string;
  moduleTitle?: string;
  lessonTitles: string[];
  quizzesPassed: number;
  progressPct: number;
  language: string;
  firstName?: string | null;
}): Promise<EmailContent> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: MAX_TOKENS.ranker,
    system: cachedSystem(EMAIL_PROGRESS_INSTRUCTIONS),
    output_config: { format: zodOutputFormat(emailContentSchema) },
    messages: [
      {
        role: "user",
        content: [
          args.kind === "path_completed"
            ? `HITO: el estudiante COMPLETÓ la ruta entera "${args.pathTitle}".`
            : `HITO: el estudiante completó el módulo "${args.moduleTitle}" de la ruta "${args.pathTitle}".`,
          args.firstName ? `Nombre del estudiante: ${args.firstName}` : "",
          `Lecciones completadas en este hito (títulos REALES, única fuente para los bullets):`,
          ...args.lessonTitles.map((t) => `- ${t}`),
          args.quizzesPassed > 0
            ? `Quizzes aprobados en este tramo: ${args.quizzesPassed}`
            : "Sin datos de quizzes (no felicitar por quizzes).",
          `Avance total de la ruta: ${args.progressPct}%`,
          `Idioma: ${args.language}`,
          "",
          "Redacta el correo de celebración.",
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

/** NIVEL 2 — Sonnet 4.6 genera un cuestionario para una lección.
 *  Corre DESPUÉS de la lección: recibe su contenido final + las anclas del
 *  video, para que las preguntas evalúen lo que el estudiante realmente vio. */
export async function generateQuiz(args: {
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
  lessonContent?: LessonContent | null;
  videoDigest?: VideoDigest | null;
  videoDurationSeconds?: number | null;
}): Promise<GeneratedQuiz> {
  const client = getAnthropic();
  const anchors = args.videoDigest?.quizAnchors ?? [];
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: MAX_TOKENS.generator,
    system: cachedSystem(`${SYSTEM_PEDAGOGY}\n\n${QUIZ_INSTRUCTIONS}`),
    output_config: { format: zodOutputFormat(quizSchema) },
    messages: [
      {
        role: "user",
        content: [
          `Lección: ${args.lessonTitle}`,
          `Resumen: ${args.lessonSummary}`,
          `Nivel: ${args.level} · Idioma: ${args.language}`,
          args.lessonContent
            ? "\nCONTENIDO FINAL DE LA LECCIÓN:\n" +
              args.lessonContent.intro +
              "\n" +
              args.lessonContent.sections.map((s) => `## ${s.heading}\n${s.body}`).join("\n") +
              "\nPuntos clave: " +
              args.lessonContent.keyTakeaways.join("; ")
            : "",
          anchors.length
            ? "\nANCLAS DEL VIDEO (únicos timestamps válidos):\n" +
              anchors.map((a) => `[${a.timestampSeconds}s] ${a.fact} → ${a.questionIdea}`).join("\n")
            : "\nSIN anclas de video → todas las preguntas con source 'lesson' y timestampSeconds null.",
          "\nGenera el cuestionario.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  // Post-validación de grounding (hallazgo del spike: timestamps alucinados):
  // un timestamp es válido solo si está ±60s de un ancla real y dentro del video.
  const quiz = res.parsed_output;
  const validTs = new Set(anchors.map((a) => a.timestampSeconds));
  const maxTs = args.videoDurationSeconds ? args.videoDurationSeconds + 5 : Infinity;
  for (const q of quiz.questions) {
    const t = q.grounding.timestampSeconds;
    const grounded =
      t !== null &&
      t >= 0 &&
      t <= maxTs &&
      [...validTs].some((v) => Math.abs(v - t) <= 60);
    if (q.grounding.source !== "lesson" && !grounded) {
      q.grounding = { source: "lesson", timestampSeconds: null };
    } else if (q.grounding.source === "lesson") {
      q.grounding.timestampSeconds = null;
    }
  }
  return quiz;
}
