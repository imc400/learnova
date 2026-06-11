import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { wizardQuestionsCache } from "@/db/schema";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";
import { slugify } from "@/lib/utils";

/*
  Intake adaptativo: Haiku diseña 2-3 preguntas ESPECÍFICAS del tema para
  personalizar la ruta (meta, experiencia, contexto/equipo). Catálogo de
  componentes CERRADO (single/multi/text) — la UI solo sabe renderizar esos.

  CRÍTICO para la economía del caché: las respuestas enriquecen goal y
  priorExperience del intake, pero JAMÁS tocan topic/level/language — el
  cacheKey canónico (skeleton + lesson_content) sigue intacto. Las DOS
  excepciones legítimas, por diseño:
  - `level` puede corregirse ANTES de crear el intent vía calibración
    (levelSignal de la pregunta de experiencia): es uno de los ejes de la key.
  - `variant` (medio físico/software: celular vs cámara, Excel vs Sheets) SÍ
    faceta la key — es la dimensión donde fragmentar es correcto, porque
    cambia qué contenido es verdadero (lo consume Track A en run.ts).
*/

/** Arquetipos cerrados de meta. NO facetan la key del caché (decisión
 *  fundador: esqueleto goal-neutral + overlay); habilitan analítica y dejarían
 *  el facetado por meta a 1 línea de distancia si se decide después. */
export const GOAL_ARCHETYPES = [
  "trabajo",
  "emprender",
  "hobby",
  "academico",
  "otro",
] as const;
export type GoalArchetype = (typeof GOAL_ARCHETYPES)[number];

export const LEVELS = ["principiante", "intermedio", "avanzado"] as const;

export const wizardOptionSchema = z.object({
  text: z.string().max(70).describe("La opción visible, máx 60 caracteres"),
  archetype: z
    .enum(GOAL_ARCHETYPES)
    .nullable()
    .default(null)
    .describe(
      "SOLO en la pregunta de meta: arquetipo de esa meta (trabajo|emprender|hobby|academico|otro). null en las demás preguntas",
    ),
  levelSignal: z
    .enum(LEVELS)
    .nullable()
    .default(null)
    .describe(
      "SOLO en la pregunta de experiencia: el nivel REAL que revela elegir esta opción (ej. 'nunca lo he intentado' → principiante). null si la opción no dice nada del nivel",
    ),
  variant: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "SOLO en la pregunta de medio/equipo: slug corto del medio, ej. 'celular', 'camara-reflex', 'excel', 'guitarra-acustica'. null en las demás preguntas",
    ),
});
export type WizardOption = z.infer<typeof wizardOptionSchema>;

export const wizardQuestionSchema = z.object({
  id: z.string().describe("slug corto único, ej: meta, equipo, experiencia"),
  label: z.string().describe("La pregunta, cercana y concreta, en el idioma pedido"),
  kind: z.enum(["single", "multi", "text"]),
  options: z
    .array(wizardOptionSchema)
    .max(6)
    .default([])
    .describe("Opciones concretas y específicas del tema (vacío si kind=text)"),
  placeholder: z
    .string()
    .nullable()
    .default(null)
    .describe("Ejemplo de respuesta si kind=text"),
  mapsTo: z
    .enum(["goal", "priorExperience"])
    .describe("A qué campo del intake alimenta la respuesta"),
});
export type WizardQuestion = z.infer<typeof wizardQuestionSchema>;

/** Gate de viabilidad + tema canónico — viaja en la MISMA llamada de
 *  preguntas (cero costo extra). El canonicalTopic es la base del cacheKey
 *  canónico (Track A): sin él, "Fotografía" y "fotografia" pagan Opus 2×. */
export const topicCheckSchema = z.object({
  verdict: z.enum(["ok", "ambiguo", "muy_amplio", "inviable", "inseguro"]),
  canonicalTopic: z
    .string()
    .describe(
      "tema normalizado: sin typos, sin acentos inconsistentes, desambiguado, formato slug corto ej. 'fotografia-celular'",
    ),
  note: z
    .string()
    .nullable()
    .describe(
      "si no es 'ok': 1 frase para el estudiante (sugerir reformulación o pedir precisión)",
    ),
});
export type TopicCheck = z.infer<typeof topicCheckSchema>;

export const wizardSchema = z.object({
  topicCheck: topicCheckSchema,
  questions: z.array(wizardQuestionSchema).min(2).max(3),
});
export type WizardPayload = z.infer<typeof wizardSchema>;

/** Lo que las respuestas estructuradas del wizard persisten en el intent
 *  (route_intents.wizard_answers). Hoy todo se aplana en 2 strings; esto
 *  conserva la señal discreta: analítica de metas, brief del profesor y
 *  re-facetado del caché sin re-preguntar. */
export const wizardAnswerSchema = z.object({
  id: z.string().max(60),
  label: z.string().max(200),
  kind: z.enum(["single", "multi", "text"]),
  mapsTo: z.enum(["goal", "priorExperience"]),
  selected: z.array(z.string().max(140)).max(8),
  other: z.string().max(300).nullable(),
});
export const wizardAnswersSchema = z.array(wizardAnswerSchema).max(6);
export type WizardAnswer = z.infer<typeof wizardAnswerSchema>;

/** Forma del jsonb route_intents.wizard_answers. `variant` vive aquí (no hay
 *  columna propia): Track A lo lee para facetar la key de lecciones. */
export interface WizardAnswersPayload {
  variant: string | null;
  answers: WizardAnswer[];
}

const WIZARD_INSTRUCTIONS = `Eres el diseñador de admisión de Aulia, una plataforma de rutas de aprendizaje personalizadas. Dado un TEMA y un NIVEL, primero evalúa el tema y luego diseña 2-3 preguntas cortas para personalizar la ruta de este estudiante.

Reglas:
0. Antes de diseñar preguntas, evalúa el TEMA (topicCheck): si es dañino/ilegal usa verdict "inseguro"; si es inviable de aprender con videos y práctica guiada, "inviable"; si es tan ambiguo que la ruta podría salir del dominio equivocado (ej. "python" serpiente vs lenguaje), "ambiguo"; si abarca una disciplina completa imposible de cubrir ("toda la medicina"), "muy_amplio". Decláralo y diseña las preguntas igualmente para la interpretación más caritativa. En "ambiguo", la PRIMERA pregunta DEBE desambiguar. En canonicalTopic entrega el tema normalizado (sin typos ni acentos, desambiguado) como slug corto, ej. "fotografia-celular".
1. La PRIMERA pregunta siempre indaga la meta concreta (mapsTo: "goal", kind: "single") con 4-5 opciones que sean metas REALES y específicas de ese tema — no genéricas. Ej. para "fotografía con celular": "Tomar mejores fotos de mis productos para vender", "Fotografiar a mi familia y viajes", etc. Cada opción de ESTA pregunta declara su "archetype" (trabajo|emprender|hobby|academico|otro).
2. Incluye UNA pregunta de experiencia previa (mapsTo: "priorExperience", kind: "single" o "text") con opciones que describan puntos de partida típicos en ese tema. Cada opción declara "levelSignal": el nivel real que esa respuesta revela (null si no dice nada del nivel).
3. Si el tema tiene un medio físico o de software relevante (equipo, instrumento, programa, presupuesto), la pregunta por él es OBLIGATORIA (mapsTo: "goal", kind: "single" o "multi") — es la única respuesta que cambia QUÉ videos le sirven. Ej.: ¿celular o cámara?, ¿guitarra acústica o eléctrica?, ¿Excel o Google Sheets? Cada opción declara "variant": slug corto del medio (ej. "celular", "camara-reflex", "excel"). Si el tema no tiene medio (historia, inglés conversacional), omite la pregunta.
4. Opciones de máximo 60 caracteres, mutuamente excluyentes en "single". Nada de "Otro" (la UI lo agrega sola).
5. Todo en el idioma indicado, tuteando, tono cercano chileno-neutro (sin modismos fuertes).
6. Máximo 3 preguntas: cada una debe ganarse su lugar — si no cambia la ruta, no va.`;

/* ----------------------------- Normalización ----------------------------- */

// Palabras que no aportan identidad al tema: "aprender guitarra desde cero"
// y "guitarra" deben caer al MISMO slug (y por tanto al mismo canon).
const TOPIC_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "con", "para", "por", "en", "y", "o", "u", "a", "mi", "mis", "tu", "tus",
  "su", "sus", "que", "como", "desde", "cero", "aprender", "curso", "clases",
  "basico", "the", "to", "for", "learn",
]);

/**
 * Slug determinista de un tema: NFD + sin diacríticos + minúsculas + colapso
 * de espacios + sin stopwords. Es el fallback de canonicalTopic cuando Haiku
 * no respondió, y la base de la key de wizard_questions_cache. Track A usa la
 * MISMA política en run.ts cuando el intent no trae canonical_topic.
 */
export function normalizeTopicSlug(topic: string): string {
  const words = slugify(topic)
    .split("-")
    .filter((w) => w && !TOPIC_STOPWORDS.has(w));
  const slug = words.join("-");
  return (slug || slugify(topic) || "tema").slice(0, 80);
}

/** Sanea un slug de variant venido del cliente (catálogo abierto pero formato
 *  cerrado: minúsculas, a-z0-9 y guiones, 2-32 chars). */
export function sanitizeVariant(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const slug = slugify(raw).slice(0, 32).replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug : null;
}

/** topicCheck de respaldo (Haiku caído o preguntas fallback): nunca bloquea. */
export function fallbackTopicCheck(topic: string): TopicCheck {
  return { verdict: "ok", canonicalTopic: normalizeTopicSlug(topic), note: null };
}

/** Preguntas de respaldo si Haiku falla: el flujo NUNCA se bloquea. */
export function fallbackQuestions(topic: string): WizardQuestion[] {
  return [
    {
      id: "meta",
      label: `¿Para qué quieres aprender ${topic}?`,
      kind: "text",
      options: [],
      placeholder: "Ej: Quiero aplicarlo en mi trabajo / emprendimiento…",
      mapsTo: "goal",
    },
    {
      id: "experiencia",
      label: "¿Cuál es tu experiencia previa con este tema?",
      kind: "text",
      options: [],
      placeholder: "Ej: He visto algunos videos pero nunca lo he practicado.",
      mapsTo: "priorExperience",
    },
    {
      id: "contexto",
      label: "¿Hay algo de tu contexto que debamos considerar?",
      kind: "text",
      options: [],
      placeholder: "Ej: herramientas o equipo con el que cuentas, tiempo, etc.",
      mapsTo: "goal",
    },
  ];
}

/* ------------------------------- Preview -------------------------------- */

export const routePreviewSchema = z.object({
  modules: z
    .array(z.string().max(80))
    .min(5)
    .max(7)
    .describe("Títulos REALES y específicos de los módulos de la ruta, en orden pedagógico"),
  hook: z
    .string()
    .max(160)
    .describe("1 frase que conecta la meta del estudiante con lo que va a lograr — concreta, sin hype vacío"),
});
export type RoutePreview = z.infer<typeof routePreviewSchema>;

const PREVIEW_INSTRUCTIONS = `Eres el diseñador instruccional de Aulia. Con el tema, nivel y meta del estudiante, esboza el ÍNDICE de su ruta personalizada: 5-7 títulos de módulos específicos y accionables (como capítulos de un temario real, no genéricos) más una frase-gancho que conecte SU meta con el resultado. Si conoces su experiencia previa, el gancho debe unir su punto de partida con la meta. Idioma del estudiante. Es el adelanto que verá antes de pagar: debe sentirse hecho exactamente para él/ella.`;

/**
 * Adelanto REAL de la ruta para el paywall (Haiku, ~1 s, ~$0.001). El índice
 * definitivo lo hace Opus tras el pago; este preview es honesto pero barato.
 * Solo lo invoca el paywall (generación perezosa e idempotente en
 * pagar/page.tsx) — no volver a llamarlo desde las actions del funnel.
 */
export async function generateRoutePreview(args: {
  topic: string;
  level: string;
  goal: string;
  language: string;
  priorExperience?: string | null;
}): Promise<RoutePreview | null> {
  try {
    const client = getAnthropic();
    const res = await client.messages.parse({
      model: MODELS.ranker,
      max_tokens: 800,
      system: cachedSystem(PREVIEW_INSTRUCTIONS),
      output_config: { format: zodOutputFormat(routePreviewSchema) },
      messages: [
        {
          role: "user",
          content: [
            `Tema: ${args.topic}`,
            `Nivel: ${args.level}`,
            `Meta del estudiante: ${args.goal}`,
            ...(args.priorExperience?.trim()
              ? [`Experiencia previa (su punto de partida): ${args.priorExperience.trim().slice(0, 300)}`]
              : []),
            `Idioma: ${args.language}`,
            "Esboza el índice de su ruta.",
          ].join("\n"),
        },
      ],
    });
    return res.parsed_output ?? null;
  } catch (e) {
    console.error("[wizard] preview falló (el paywall usa fallback):", e);
    return null;
  }
}

/* ------------------------- Preguntas adaptativas ------------------------- */

export interface WizardQuestionsResult {
  questions: WizardQuestion[];
  topicCheck: TopicCheck;
  adaptive: boolean;
}

/** Genera las preguntas adaptativas + topicCheck para un tema (Haiku, ~1-2 s). */
export async function generateWizardQuestions(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<WizardQuestionsResult> {
  try {
    const client = getAnthropic();
    const res = await client.messages.parse({
      model: MODELS.ranker,
      max_tokens: 1600,
      system: cachedSystem(WIZARD_INSTRUCTIONS),
      output_config: { format: zodOutputFormat(wizardSchema) },
      messages: [
        {
          role: "user",
          content: [
            `Tema: ${args.topic}`,
            `Nivel declarado: ${args.level}`,
            `Idioma de las preguntas: ${args.language}`,
            "Evalúa el tema y diseña las preguntas de admisión.",
          ].join("\n"),
        },
      ],
    });
    if (res.parsed_output) {
      return {
        questions: res.parsed_output.questions,
        topicCheck: res.parsed_output.topicCheck,
        adaptive: true,
      };
    }
  } catch (e) {
    console.error("[wizard] Haiku falló, uso preguntas de respaldo:", e);
  }
  return {
    questions: fallbackQuestions(args.topic),
    topicCheck: fallbackTopicCheck(args.topic),
    adaptive: false,
  };
}

/** Key de wizard_questions_cache. Determinista (no requiere IA): slug del
 *  tema + nivel + idioma. Dos typos distintos del mismo tema pueden producir
 *  2 filas — aceptable, la fila cuesta ~$0.001. */
function wizardCacheKey(args: { topic: string; level: string; language: string }): string {
  return `${normalizeTopicSlug(args.topic)}-${args.level}-${args.language}`;
}

/**
 * Preguntas con caché en BD (wizard_questions_cache): el paso 1→2 del funnel
 * se vuelve instantáneo en temas calientes y un bot deja de facturar Haiku
 * por request. El rate limit por IP es de Track E (src/lib/ratelimit.ts) y se
 * añade en la action pública — esta capa solo corta el costo repetido.
 */
export async function getWizardQuestions(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<WizardQuestionsResult> {
  const cacheKey = wizardCacheKey(args);

  try {
    const [hit] = await db
      .select({ payload: wizardQuestionsCache.questions })
      .from(wizardQuestionsCache)
      .where(eq(wizardQuestionsCache.cacheKey, cacheKey))
      .limit(1);
    if (hit) {
      const parsed = wizardSchema.safeParse(hit.payload);
      if (parsed.success) {
        return {
          questions: parsed.data.questions,
          topicCheck: parsed.data.topicCheck,
          adaptive: true,
        };
      }
      // Fila vieja/corrupta: se ignora y se regenera (el insert de abajo no
      // la pisa por el UNIQUE; la limpieza es tarea de ops, no del funnel).
    }
  } catch (e) {
    console.error("[wizard] lectura de wizard_questions_cache falló:", e);
  }

  const fresh = await generateWizardQuestions(args);
  if (fresh.adaptive) {
    try {
      await db
        .insert(wizardQuestionsCache)
        .values({
          cacheKey,
          questions: { topicCheck: fresh.topicCheck, questions: fresh.questions },
        })
        .onConflictDoNothing();
    } catch (e) {
      console.error("[wizard] escritura de wizard_questions_cache falló:", e);
    }
  }
  return fresh;
}

/**
 * Re-deriva el topicCheck en el SERVIDOR al crear el intent: el cliente jamás
 * manda canonicalTopic/verdict (sería envenenable — el canonicalTopic decide
 * bajo qué key se escribe el canon). Se busca en wizard_questions_cache por
 * el slug del tema en los 3 niveles (la calibración puede haber cambiado el
 * nivel después de pedir las preguntas). null = sin señal (preguntas
 * fallback): se usa normalizeTopicSlug y no se bloquea nada.
 */
export async function findTopicCheckForIntent(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<TopicCheck | null> {
  const slug = normalizeTopicSlug(args.topic);
  const keys = LEVELS.map((l) => `${slug}-${l}-${args.language}`);
  const preferred = `${slug}-${args.level}-${args.language}`;
  try {
    const rows = await db
      .select({
        cacheKey: wizardQuestionsCache.cacheKey,
        payload: wizardQuestionsCache.questions,
      })
      .from(wizardQuestionsCache)
      .where(inArray(wizardQuestionsCache.cacheKey, [...keys]));
    const row =
      rows.find((r) => r.cacheKey === preferred) ?? rows[0] ?? null;
    if (!row) return null;
    const parsed = wizardSchema.safeParse(row.payload);
    return parsed.success ? parsed.data.topicCheck : null;
  } catch (e) {
    console.error("[wizard] findTopicCheckForIntent falló:", e);
    return null;
  }
}

/** canonicalTopic listo para persistir en el intent: el de Haiku (saneado a
 *  slug — Haiku a veces devuelve texto con espacios) o el determinista. */
export function resolveCanonicalTopic(
  check: TopicCheck | null,
  topic: string,
): string {
  const fromCheck = check?.canonicalTopic?.trim()
    ? normalizeTopicSlug(check.canonicalTopic)
    : "";
  return fromCheck || normalizeTopicSlug(topic);
}
