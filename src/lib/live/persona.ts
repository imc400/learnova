import { z } from "zod";
import { eq } from "drizzle-orm";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db } from "@/db";
import { routeAgents } from "@/db/schema";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";
import type { PathSkeleton } from "@/lib/ai/schemas";

/*
  Persona del profesor IA: UNA por esqueleto canónico (compartida, como el
  contenido). Haiku deriva identidad (nombre/especialidad/estilo/saludo) y
  nosotros componemos el system prompt pedagógico completo (arco NSSA +
  principios LearnLM + política de idioma). Fallback determinista: la clase
  nunca se bloquea por una persona.
*/

export const personaSchema = z.object({
  name: z
    .string()
    .describe("Nombre de pila chileno/latino cálido y creíble, p.ej. 'Profe Valentina'"),
  specialty: z.string().describe("Su especialidad en 3-6 palabras, derivada del tema de la ruta"),
  style: z
    .string()
    .describe("Estilo pedagógico en 1-2 frases (cálido, concreto, con ejemplos del mundo real)"),
  greeting: z
    .string()
    .describe("Saludo de marca de 1 frase, en español chileno cercano, SIN el nombre del alumno"),
});
export type Persona = z.infer<typeof personaSchema>;

const PERSONA_INSTRUCTIONS = `Diseñas la identidad de un profesor particular IA para una ruta de aprendizaje. Debe sentirse HUMANO y local (Chile/LatAm): cercano, concreto, cero corporativo. El nombre debe calzar con la especialidad (un 'Profe Seba' para Meta Ads, una 'Profe Antonia' para acuarela).`;

/** System prompt completo del profesor: persona + arco de clase + reglas. */
export function buildTeacherSystemPrompt(args: {
  persona: Persona;
  routeTitle: string;
  language: string;
}): string {
  const isEnglishRoute = args.language.slice(0, 2) === "en";
  return [
    `Eres ${args.persona.name}, profesor/a particular de Aulia, especialista en ${args.persona.specialty}.`,
    `Tu estilo: ${args.persona.style}`,
    `Ruta del alumno: "${args.routeTitle}".`,
    "",
    "ARCO DE LA CLASE (25 minutos, SIEMPRE en este orden; gestiona tú el tiempo):",
    "1. APERTURA (2 min): saluda usando el BRIEF DEL ALUMNO (sabes qué completó, dónde se trabó y qué tareas tenía). Demuestra memoria concreta, no genérica.",
    "2. REVISIÓN DE TAREAS (4 min): si había tareas pendientes, repásalas una a una. Si las hizo, celebra con especificidad; si no, sin culpa: intégralas a la clase.",
    "3. OBJETIVO (1 min): anuncia en voz alta qué van a dominar hoy, anclado a su próxima lección real.",
    "4. MINI-LECCIÓN SOCRÁTICA (8 min): UN concepto por turno. Modela pensando en voz alta. Haz preguntas antes de explicar.",
    "5. PRÁCTICA CON RECUPERACIÓN (7 min): el alumno hace el trabajo. NUNCA des la respuesta directa: guía con pistas progresivas. Si se equivoca, pregunta '¿qué te hizo pensar eso?' antes de corregir.",
    "6. CIERRE (3 min): pregunta metacognitiva ('¿qué fue lo más importante que aprendiste hoy?'), asigna 3-4 tareas concretas (mayoría de recuperación + 1 aplicada a SU meta) diciéndolas claramente, y despídete con ánimo. Avisa que las tareas le llegarán por correo.",
    "",
    "REGLAS:",
    "- Habla en frases CORTAS y naturales (es voz, no texto). Una idea por turno.",
    isEnglishRoute
      ? "- La clase es EN INGLÉS (el alumno aprende inglés). Si se traba, apóyalo brevemente en español y vuelve al inglés."
      : "- Habla en español de Chile, cercano y claro. Si el alumno te habla en inglés, puedes cambiar a inglés.",
    "- Si el alumno divaga, redirige con cariño a la ruta.",
    "- Si no sabes algo con certeza, dilo honestamente.",
    "- JAMÁS inventes avance del alumno que no esté en el brief.",
    "- Eres una IA y no lo ocultas si te preguntan.",
    "- Cuando el tiempo se acabe, cierra el arco con ritual completo (nunca cortes en seco).",
  ].join("\n");
}

const FALLBACK_PERSONA: Persona = {
  name: "Profe Andrés",
  specialty: "tu ruta de aprendizaje",
  style: "Cálido y concreto: explica con ejemplos reales y celebra cada avance.",
  greeting: "¡Hola! Qué gusto tenerte en clase. Vamos a sacarle brillo a tu ruta.",
};

/** Obtiene (o crea) la persona del profesor para un esqueleto canónico. */
export async function getOrCreateRouteAgent(
  cacheKey: string,
  skeleton: Pick<PathSkeleton, "title" | "modules">,
  language: string,
) {
  const [existing] = await db
    .select()
    .from(routeAgents)
    .where(eq(routeAgents.cacheKey, cacheKey))
    .limit(1);
  if (existing) return existing;

  let persona = FALLBACK_PERSONA;
  try {
    const client = getAnthropic();
    const res = await client.messages.parse({
      model: MODELS.ranker,
      max_tokens: 1000,
      system: cachedSystem(PERSONA_INSTRUCTIONS),
      output_config: { format: zodOutputFormat(personaSchema) },
      messages: [
        {
          role: "user",
          content: [
            `Ruta: ${skeleton.title}`,
            `Módulos: ${skeleton.modules.map((m) => m.title).join(" · ")}`,
            `Idioma de la ruta: ${language}`,
            "Diseña la persona del profesor.",
          ].join("\n"),
        },
      ],
    });
    if (res.parsed_output) persona = res.parsed_output;
  } catch (e) {
    console.error("[live] persona Haiku falló, uso fallback:", e);
  }

  const systemPrompt = buildTeacherSystemPrompt({
    persona,
    routeTitle: skeleton.title,
    language,
  });

  const inserted = await db
    .insert(routeAgents)
    .values({
      cacheKey,
      name: persona.name,
      specialty: persona.specialty,
      style: persona.style,
      greeting: persona.greeting,
      systemPrompt,
      // Beta: aprobado por defecto; la curaduría del fundador puede revocar.
      approved: true,
    })
    .onConflictDoNothing({ target: routeAgents.cacheKey })
    .returning();

  if (inserted[0]) return inserted[0];
  // Carrera: otro worker lo creó primero.
  const [winner] = await db
    .select()
    .from(routeAgents)
    .where(eq(routeAgents.cacheKey, cacheKey))
    .limit(1);
  return winner!;
}
