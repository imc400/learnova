import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";

/*
  Intake adaptativo: Haiku diseña 3-4 preguntas ESPECÍFICAS del tema para
  personalizar la ruta (meta, experiencia, contexto/equipo). Catálogo de
  componentes CERRADO (single/multi/text) — la UI solo sabe renderizar esos.

  CRÍTICO para la economía del caché: las respuestas enriquecen goal y
  priorExperience del intake, pero JAMÁS tocan topic/level/language — el
  cacheKey canónico (skeleton + lesson_content) sigue intacto.
*/

export const wizardQuestionSchema = z.object({
  id: z.string().describe("slug corto único, ej: meta, equipo, experiencia"),
  label: z.string().describe("La pregunta, cercana y concreta, en el idioma pedido"),
  kind: z.enum(["single", "multi", "text"]),
  options: z
    .array(z.string().max(70))
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

export const wizardSchema = z.object({
  questions: z.array(wizardQuestionSchema).min(3).max(4),
});

export type WizardQuestion = z.infer<typeof wizardQuestionSchema>;

const WIZARD_INSTRUCTIONS = `Eres el diseñador de admisión de Aulia, una plataforma de rutas de aprendizaje personalizadas. Dado un TEMA y un NIVEL, diseña 3-4 preguntas cortas para personalizar la ruta de este estudiante.

Reglas:
1. La PRIMERA pregunta siempre indaga la meta concreta (mapsTo: "goal", kind: "single") con 4-5 opciones que sean metas REALES y específicas de ese tema — no genéricas. Ej. para "fotografía con celular": "Tomar mejores fotos de mis productos para vender", "Fotografiar a mi familia y viajes", etc.
2. Incluye UNA pregunta de experiencia previa (mapsTo: "priorExperience", kind: "single" o "text") con opciones que describan puntos de partida típicos en ese tema.
3. Si el tema tiene contexto material o de herramientas relevante (equipo, instrumento, software, presupuesto), pregunta por él (mapsTo: "goal", kind: "single" o "multi") — esa respuesta afecta qué videos le sirven. Ej.: ¿celular o cámara?, ¿guitarra acústica o eléctrica?, ¿Excel o Google Sheets?
4. Opciones de máximo 60 caracteres, mutuamente excluyentes en "single". Nada de "Otro" (la UI lo agrega sola).
5. Todo en el idioma indicado, tuteando, tono cercano chileno-neutro (sin modismos fuertes).
6. Máximo 4 preguntas: cada una debe ganarse su lugar — si no cambia la ruta, no va.`;

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

const PREVIEW_INSTRUCTIONS = `Eres el diseñador instruccional de Aulia. Con el tema, nivel y meta del estudiante, esboza el ÍNDICE de su ruta personalizada: 5-7 títulos de módulos específicos y accionables (como capítulos de un temario real, no genéricos) más una frase-gancho que conecte SU meta con el resultado. Idioma del estudiante. Es el adelanto que verá antes de pagar: debe sentirse hecho exactamente para él/ella.`;

/**
 * Adelanto REAL de la ruta para el paywall (Haiku, ~1 s, ~$0.001). El índice
 * definitivo lo hace Opus tras el pago; este preview es honesto pero barato.
 */
export async function generateRoutePreview(args: {
  topic: string;
  level: string;
  goal: string;
  language: string;
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
          content: `Tema: ${args.topic}\nNivel: ${args.level}\nMeta del estudiante: ${args.goal}\nIdioma: ${args.language}\nEsboza el índice de su ruta.`,
        },
      ],
    });
    return res.parsed_output ?? null;
  } catch (e) {
    console.error("[wizard] preview falló (el paywall usa fallback):", e);
    return null;
  }
}

/** Genera las preguntas adaptativas para un tema (Haiku, ~1-2 s). */
export async function generateWizardQuestions(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<{ questions: WizardQuestion[]; adaptive: boolean }> {
  try {
    const client = getAnthropic();
    const res = await client.messages.parse({
      model: MODELS.ranker,
      max_tokens: 1200,
      system: cachedSystem(WIZARD_INSTRUCTIONS),
      output_config: { format: zodOutputFormat(wizardSchema) },
      messages: [
        {
          role: "user",
          content: [
            `Tema: ${args.topic}`,
            `Nivel declarado: ${args.level}`,
            `Idioma de las preguntas: ${args.language}`,
            "Diseña las preguntas de admisión.",
          ].join("\n"),
        },
      ],
    });
    if (res.parsed_output) {
      return { questions: res.parsed_output.questions, adaptive: true };
    }
  } catch (e) {
    console.error("[wizard] Haiku falló, uso preguntas de respaldo:", e);
  }
  return { questions: fallbackQuestions(args.topic), adaptive: false };
}
