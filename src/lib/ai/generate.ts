import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  getAnthropic,
  cachedSharedSystem,
  trackUsage,
  type AiTracking,
} from "./client";
import { MODELS, MAX_TOKENS } from "./models";
import {
  SYSTEM_PEDAGOGY,
  GENERATOR_SHARED_SYSTEM,
  LESSON_INSTRUCTIONS,
  QUIZ_INSTRUCTIONS,
  EMAIL_PROGRESS_INSTRUCTIONS,
  VIDEO_QUERIES_INSTRUCTIONS,
  LESSON_VIDEO_ANCHOR_INSTRUCTIONS,
  ROUTE_OVERLAY_INSTRUCTIONS,
} from "./prompts";
import {
  pathSkeletonSchema,
  moduleStubSchema,
  lessonContentSchema,
  quizSchema,
  emailContentSchema,
  videoQueriesSchema,
  routeOverlaySchema,
  type Intake,
  type PathSkeleton,
  type LessonContent,
  type GeneratedQuiz,
  type EmailContent,
  type VideoQueries,
  type RouteOverlay,
} from "./schemas";
import type { VideoDigest } from "@/lib/video/insights";

/** Contexto compacto del digest para inyectar en prompts (controla tokens). */
function digestContext(
  digest: VideoDigest,
  durationSeconds?: number | null,
): string {
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return [
    "DIGEST DEL VIDEO DE APOYO (datos REALES del video; única fuente para timestamps):",
    durationSeconds
      ? `Duración total del video: ${mm(durationSeconds)} (${durationSeconds}s) — ningún timestamp puede superarla.`
      : "",
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
 *
 * `canonical: true` (Opción A, decisión fundador): el esqueleto va a la caché
 * compartida y lo cursarán estudiantes con metas distintas → se OMITEN
 * goal/priorExperience/weeklyHours del prompt. La personalización vive en el
 * overlay por ruta (generateRouteOverlay), nunca en el canon.
 *
 * `promisedModules` (B-P0.3, paywall honesto): el borrador de temario que el
 * comprador vio antes de pagar — el planner respeta su espíritu y cobertura.
 *
 * NOTA: sin thinking adaptativo POR DECISIÓN DEL FUNDADOR (costo). El
 * comentario antiguo que alegaba incompatibilidad con structured outputs era
 * técnicamente incorrecto: SÍ se combinan — si el fundador lo aprueba, basta
 * añadir `thinking: { type: "adaptive" }` aquí.
 * Sin `temperature`: Opus 4.8 eliminó los sampling params (la API responde
 * 400 si se envían).
 * Sin cache_control en el system: ~600 tokens < mínimo cacheable de Opus
 * (4096) — el marcador se ignoraría en silencio.
 */
export async function generatePathSkeleton(
  intake: Intake,
  opts?: {
    canonical?: boolean;
    promisedModules?: string[] | null;
    tracking?: AiTracking;
  },
): Promise<PathSkeleton> {
  const client = getAnthropic();
  const canonical = opts?.canonical === true;
  const res = await client.messages.parse({
    model: MODELS.planner,
    max_tokens: MAX_TOKENS.planner,
    system: SYSTEM_PEDAGOGY,
    output_config: {
      effort: "high",
      format: zodOutputFormat(pathSkeletonSchema),
    },
    messages: [
      {
        role: "user",
        content: [
          "Diseña una ruta de aprendizaje COMPLETA con estos datos del estudiante:",
          `- Tema: ${intake.topic}`,
          canonical
            ? "- Contexto: esta ruta es CANÓNICA para el tema y nivel — la cursarán estudiantes con metas distintas. Diseña para el caso de uso más común y valioso del tema, sin asumir una meta particular (la personalización se agrega aparte)."
            : `- Meta concreta: ${intake.goal}`,
          !canonical && intake.priorExperience
            ? `- Experiencia previa: ${intake.priorExperience}`
            : "",
          !canonical && intake.weeklyHours
            ? `- Tiempo disponible: ~${intake.weeklyHours} h/semana. Dimensiona la ruta para completarse en 4-8 semanas a ese ritmo: ajusta número de lecciones y minutos por lección, y reporta estimatedHours coherente con eso.`
            : "",
          `- Nivel: ${intake.level}`,
          `- Idioma de salida: ${intake.language}`,
          opts?.promisedModules?.length
            ? `\nAl estudiante se le mostró este borrador de temario antes de pagar — respeta su espíritu y cobertura (mejora títulos y orden si lo amerita):\n${opts.promisedModules.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
            : "",
          "",
          "Devuelve EXACTAMENTE 5–7 módulos, cada uno con 3–4 lecciones (MÁXIMO ~24 lecciones en total). Currículum enfocado y de alta calidad, NO exhaustivo: prioriza lo esencial. Títulos de lección específicos y accionables.",
          "Declara el narrativeThread (arco del curso) y, por módulo, buildsOn: qué del módulo anterior usa (null solo en el primero).",
          "El ÚLTIMO módulo es un PROYECTO INTEGRADOR: un proyecto concreto y mostrable que use habilidades de todos los módulos anteriores; sus lecciones son los pasos del proyecto.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  await trackUsage(
    { label: opts?.tracking?.label ?? "planner.skeleton", pathId: opts?.tracking?.pathId },
    MODELS.planner,
    res.usage,
  );
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/**
 * Módulo de REFUERZO diseñado post-clase: el profesor lo propuso en vivo en
 * base al feedback del alumno. Sonnet diseña UN módulo (3-4 lecciones) que
 * encaja con la ruta existente sin repetir lo ya cubierto.
 */
export async function generateModuleSkeleton(args: {
  pathTitle: string;
  goal: string;
  level: string;
  language: string;
  existingModules: string[];
  requestedTitle: string;
  reason: string;
  struggles?: string[];
  tracking?: AiTracking;
}): Promise<PathSkeleton["modules"][number]> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: 2500,
    temperature: 0.5,
    system: cachedSharedSystem(
      GENERATOR_SHARED_SYSTEM,
      "TAREA: diseñar UN módulo de refuerzo que encaje en una ruta existente (los datos vienen en el mensaje).",
    ),
    output_config: { format: zodOutputFormat(moduleStubSchema) },
    messages: [
      {
        role: "user",
        content: [
          `El profesor particular de la ruta "${args.pathTitle}" (nivel ${args.level}) decidió EN CLASE agregar un módulo de refuerzo para este alumno.`,
          `- Módulo pedido por el profesor: "${args.requestedTitle}"`,
          `- Por qué: ${args.reason}`,
          args.struggles?.length
            ? `- Dificultades recientes del alumno: ${args.struggles.join("; ")}`
            : "",
          `- Meta del alumno: ${args.goal}`,
          `- Módulos que la ruta YA tiene (no los repitas): ${args.existingModules.join(" · ")}`,
          `- Idioma de salida: ${args.language}`,
          "",
          "Diseña UN módulo con 3-4 lecciones específicas y accionables que ataquen exactamente esa necesidad. Resúmenes de lección concretos (sirven para curar el video de apoyo). buildsOn: qué de la ruta existente usa este módulo.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  await trackUsage(
    { label: args.tracking?.label ?? "generator.module_extend", pathId: args.tracking?.pathId },
    MODELS.generator,
    res.usage,
  );
  if (!res.parsed_output) {
    throw new Error("[ai] módulo de refuerzo: parsed_output null.");
  }
  return res.parsed_output;
}

/**
 * Detector de TEXTO CORTADO: cuando el modelo emite una comilla doble sin
 * escapar dentro de un string JSON, la decodificación restringida cierra el
 * campo ahí y el resto de la frase se pierde en silencio (caso real: 'como
 * cuando el médico te dice ' ← faltaba «aaah»). Heurística: un cuerpo sano
 * termina con puntuación de cierre; uno cortado termina en letra, coma,
 * paréntesis abierto o espacio.
 */
const HEALTHY_ENDING = /[.!?…)\]»>'"*_`:;%。！？]$/;
export function looksTruncated(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  return !HEALTHY_ENDING.test(t);
}

function truncatedFields(content: LessonContent): string[] {
  const bad: string[] = [];
  if (looksTruncated(content.intro)) bad.push("intro");
  content.sections.forEach((s, i) => {
    if (looksTruncated(s.body)) bad.push(`sección ${i + 1} (${s.heading})`);
  });
  if (looksTruncated(content.practice)) bad.push("practice");
  return bad;
}

/** NIVEL 2 — Sonnet 4.6 genera el contenido de una lección.
 *  - Si llega videoDigest, la lección se genera ANCLADA al video en esta misma
 *    llamada (terminología, orden compatible, videoGuide con minutos reales).
 *  - `courseContext` (A-P0.2): mapa de la ruta + lo ya enseñado + vocabulario
 *    + hermanas — determinístico por esqueleto, así que NO rompe el modelo de
 *    caché canónico (la lección N siempre se escribe con el mismo contexto).
 *  - System en dos bloques (A-P1.2): el compartido (>2048 tokens) se cachea
 *    5 min y lo leen TODAS las llamadas Sonnet de la ruta a ~0.1x. */
export async function generateLessonContent(args: {
  pathTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
  videoDigest?: VideoDigest | null;
  videoDurationSeconds?: number | null;
  courseContext?: string | null;
  tracking?: AiTracking;
}): Promise<LessonContent> {
  const client = getAnthropic();
  const hasDigest = !!args.videoDigest;
  const baseUser = [
    `Ruta: ${args.pathTitle}`,
    `Módulo: ${args.moduleTitle} — Objetivo: ${args.moduleObjective}`,
    `Lección: ${args.lessonTitle}`,
    `Resumen esperado: ${args.lessonSummary}`,
    `Nivel: ${args.level} · Idioma: ${args.language}`,
    args.courseContext ? `\n${args.courseContext}` : "",
    "",
    hasDigest
      ? digestContext(args.videoDigest!, args.videoDurationSeconds)
      : "SIN digest de video disponible → videoGuide debe ser null.",
    "",
    "Genera el contenido de esta lección.",
  ]
    .filter(Boolean)
    .join("\n");

  let content: LessonContent | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.parse({
      model: MODELS.generator,
      max_tokens: MAX_TOKENS.generator,
      // Contenido canónico que verán N compradores → varianza baja (A-P1.8).
      temperature: 0.5,
      system: cachedSharedSystem(
        GENERATOR_SHARED_SYSTEM,
        `${LESSON_INSTRUCTIONS}\n\n${LESSON_VIDEO_ANCHOR_INSTRUCTIONS}`,
      ),
      output_config: { format: zodOutputFormat(lessonContentSchema) },
      messages: [
        {
          role: "user",
          content:
            attempt === 0
              ? baseUser
              : `${baseUser}\n\nIMPORTANTE: el intento anterior quedó con frases CORTADAS por usar comillas dobles. NO uses comillas dobles (") en ningún texto — solo 'simples', «latinas» o *cursiva* — y termina cada sección con puntuación final.`,
        },
      ],
    });
    await trackUsage(
      { label: args.tracking?.label ?? "generator.lesson", pathId: args.tracking?.pathId },
      MODELS.generator,
      res.usage,
    );
    if (!res.parsed_output) {
      throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
    }
    content = res.parsed_output;
    const bad = truncatedFields(content);
    if (!bad.length) break;
    console.warn(
      `[ai] lección "${args.lessonTitle}": texto cortado en ${bad.join(", ")} (intento ${attempt + 1})`,
    );
  }
  if (!content) throw new Error("[ai] generación de lección falló.");
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
 *  (desde los stubs del esqueleto: el video se elige ANTES de escribir la
 *  lección). temperature 0.2: queries deterministas = mejores hits en la caché
 *  de búsquedas de YouTube. */
export async function generateVideoQueries(args: {
  routeTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  lessons: { index: number; title: string; summary: string }[];
  language: string;
  level?: string;
  tracking?: AiTracking;
}): Promise<VideoQueries> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: MAX_TOKENS.ranker,
    temperature: 0.2,
    // System corto (~300 tokens < mínimo Haiku 4096): sin cache_control.
    system: VIDEO_QUERIES_INSTRUCTIONS,
    output_config: { format: zodOutputFormat(videoQueriesSchema) },
    messages: [
      {
        role: "user",
        content: [
          `RUTA (define el medio/herramienta de TODAS las queries): ${args.routeTitle}`,
          `Módulo: ${args.moduleTitle} — Objetivo: ${args.moduleObjective}`,
          `Idioma del estudiante: ${args.language}`,
          args.level ? `Nivel del estudiante: ${args.level}` : "",
          "Lecciones:",
          ...args.lessons.map((l) => `${l.index}. ${l.title} — ${l.summary}`),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  await trackUsage(
    { label: args.tracking?.label ?? "ranker.video_queries", pathId: args.tracking?.pathId },
    MODELS.ranker,
    res.usage,
  );
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/**
 * Overlay de personalización por ruta (A-P0.3, Opción A): UNA llamada Haiku
 * (~$0.005/ruta) que conecta la meta REAL del comprador con el temario
 * canónico. Se guarda en learning_paths.route_intro + modules.personal_note.
 * JAMÁS entra al caché canónico.
 */
export async function generateRouteOverlay(args: {
  routeTitle: string;
  narrativeThread?: string | null;
  modules: { index: number; title: string; objective: string }[];
  goal: string;
  priorExperience?: string | null;
  level: string;
  language: string;
  tracking?: AiTracking;
}): Promise<RouteOverlay> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: 1500,
    temperature: 0.5,
    system: ROUTE_OVERLAY_INSTRUCTIONS,
    output_config: { format: zodOutputFormat(routeOverlaySchema) },
    messages: [
      {
        role: "user",
        content: [
          `TEMARIO CANÓNICO de la ruta "${args.routeTitle}" (nivel ${args.level}):`,
          args.narrativeThread ? `Arco del curso: ${args.narrativeThread}` : "",
          ...args.modules.map((m) => `${m.index}. ${m.title} — ${m.objective}`),
          "",
          `META declarada del estudiante: ${args.goal}`,
          args.priorExperience ? `Experiencia previa: ${args.priorExperience}` : "Experiencia previa: ninguna declarada.",
          `Idioma: ${args.language}`,
          "",
          "Escribe routeIntro y una nota personal por módulo (moduleIndex = el número mostrado).",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  await trackUsage(
    { label: args.tracking?.label ?? "overlay.route", pathId: args.tracking?.pathId },
    MODELS.ranker,
    res.usage,
  );
  if (!res.parsed_output) {
    throw new Error("[ai] overlay: parsed_output null.");
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
  tracking?: AiTracking;
}): Promise<EmailContent> {
  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: MAX_TOKENS.ranker,
    system: EMAIL_PROGRESS_INSTRUCTIONS,
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
  await trackUsage(
    { label: args.tracking?.label ?? "ranker.progress_email", pathId: args.tracking?.pathId },
    MODELS.ranker,
    res.usage,
  );
  if (!res.parsed_output) {
    throw new Error("[ai] parsed_output null (posible refusal o JSON inválido).");
  }
  return res.parsed_output;
}

/** NIVEL 2 — Sonnet 4.6 genera un cuestionario para una lección.
 *  Corre DESPUÉS de la lección: recibe su contenido final + las anclas del
 *  video, para que las preguntas evalúen lo que el estudiante realmente vio.
 *  `reviewContext` (A-P0.2): takeaways de módulos anteriores → 1 pregunta de
 *  repaso espaciado por quiz. */
export async function generateQuiz(args: {
  lessonTitle: string;
  lessonSummary: string;
  level: string;
  language: string;
  lessonContent?: LessonContent | null;
  videoDigest?: VideoDigest | null;
  videoDurationSeconds?: number | null;
  reviewContext?: string | null;
  tracking?: AiTracking;
}): Promise<GeneratedQuiz> {
  const client = getAnthropic();
  const anchors = args.videoDigest?.quizAnchors ?? [];
  const res = await client.messages.parse({
    model: MODELS.generator,
    max_tokens: MAX_TOKENS.generator,
    temperature: 0.5,
    system: cachedSharedSystem(GENERATOR_SHARED_SYSTEM, QUIZ_INSTRUCTIONS),
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
          args.reviewContext ? `\n${args.reviewContext}` : "",
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
  await trackUsage(
    { label: args.tracking?.label ?? "generator.quiz", pathId: args.tracking?.pathId },
    MODELS.generator,
    res.usage,
  );
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
  // Post-validación de respuestas (A-P2): una pregunta sin respuesta correcta
  // marcable (ids fantasma o lista vacía) no puede llegar a producción.
  const validQuestions = quiz.questions.filter((q) => {
    const optionIds = new Set(q.options.map((o) => o.id));
    const ok =
      q.correctOptionIds.length > 0 &&
      q.correctOptionIds.every((id) => optionIds.has(id)) &&
      q.options.length >= 2;
    if (!ok) {
      console.warn(`[ai] quiz "${args.lessonTitle}": pregunta descartada (correctOptionIds inválidos).`);
    }
    return ok;
  });
  if (!validQuestions.length) {
    throw new Error("[ai] quiz sin preguntas válidas tras post-validación.");
  }
  return { questions: validQuestions };
}
