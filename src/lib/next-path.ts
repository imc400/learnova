import { z } from "zod";
import { eq } from "drizzle-orm";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db } from "@/db";
import { nextPathSuggestions, learningPaths } from "@/db/schema";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS, MAX_TOKENS } from "@/lib/ai/models";
import type { Intake } from "@/lib/ai/schemas";

/*
  "Siguiente paso": la ruta que viene DESPUÉS de completar una, generada a
  medida desde lo aprendido (la ventaja única de Aulia: no hay catálogo, la
  siguiente ruta no existe hasta que el estudiante la pide).
  - Una sugerencia por ruta completada (UNIQUE sourcePathId), congelada para
    ser consistente entre la card y el correo.
  - Cacheable cross-usuario por skeletonCacheKey: la misma ruta canónica
    produce la misma sugerencia → Haiku se paga UNA vez por esqueleto.
  - Fallback determinista si Haiku falla: nunca rompe el hito.
*/

export const nextPathSuggestionSchema = z.object({
  topic: z.string().min(2).describe("tema de la siguiente ruta, corto y concreto"),
  goal: z
    .string()
    .min(3)
    .describe("meta de la siguiente ruta en 1 frase, continuando lo aprendido"),
  level: z.enum(["principiante", "intermedio", "avanzado"]),
  reasons: z
    .array(z.string())
    .describe("2-3 razones 'Porque dominaste X' citando módulos REALES completados"),
});
export type NextPathSuggestion = z.infer<typeof nextPathSuggestionSchema>;

const NEXT_PATH_INSTRUCTIONS = `Eres el mentor de Aulia. El estudiante COMPLETÓ una ruta. Propón LA siguiente ruta ideal (una sola) que continúe naturalmente lo aprendido hacia un nivel superior o una especialización valiosa.
Reglas:
- topic corto y buscable; goal concreto y motivador (español de Chile, cálido).
- level: un paso adelante del actual (principiante→intermedio→avanzado; si ya es avanzado, especialización).
- reasons: 2-3, citando TÍTULOS REALES de módulos completados ("Porque dominaste …").
- NO repitas temas que el estudiante ya cursó (te paso su lista).`;

function nextLevel(level: string): "principiante" | "intermedio" | "avanzado" {
  if (level === "principiante") return "intermedio";
  return "avanzado";
}

/** Normaliza un tema para comparar ("Fotografía" ≈ "fotografia"): minúsculas,
 *  sin diacríticos, espacios colapsados. Solo para detectar colisiones. */
function normalizeTopic(topic: string): string {
  return topic
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Fallback determinista: mismo tema, nivel siguiente. Nunca falla. */
function deterministicSuggestion(args: {
  topic: string;
  level: string;
  lastModuleTitle?: string;
}): NextPathSuggestion {
  const lvl = nextLevel(args.level);
  const isMax = args.level === "avanzado";
  return {
    topic: isMax && args.lastModuleTitle
      ? `${args.topic}: ${args.lastModuleTitle}`
      : `${args.topic} ${lvl}`,
    goal: isMax
      ? `Especializarme en ${args.lastModuleTitle ?? args.topic} y llevarlo a nivel experto`
      : `Profundizar en ${args.topic}: pasar de ${args.level} a ${lvl} con práctica real`,
    level: lvl,
    reasons: [`Porque completaste tu ruta de ${args.topic}`],
  };
}

/**
 * Devuelve (o genera y persiste) la sugerencia de siguiente ruta para una
 * ruta completada. Idempotente por UNIQUE(sourcePathId). Nunca lanza.
 */
export async function getOrCreateNextPathSuggestion(args: {
  userId: string;
  sourcePathId: string;
}): Promise<NextPathSuggestion | null> {
  try {
    // 0) ¿Ya existe? (congelada para card + correo)
    const [existing] = await db
      .select()
      .from(nextPathSuggestions)
      .where(eq(nextPathSuggestions.sourcePathId, args.sourcePathId))
      .limit(1);
    if (existing) {
      return {
        topic: existing.topic,
        goal: existing.goal,
        level: existing.level,
        reasons: existing.reasons,
      };
    }

    const [path] = await db
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.id, args.sourcePathId))
      .limit(1);
    if (!path) return null;

    // Temas que el usuario YA cursó: insumo del prompt de Haiku Y del guard
    // del caché cross-usuario (sin esto, el HIT puede ofrecerle por triplicado
    // —card, correo, profesor de cierre— una ruta que ya tiene).
    const previous = await db
      .select({ topic: learningPaths.topic })
      .from(learningPaths)
      .where(eq(learningPaths.userId, args.userId));
    const previousTopics = new Set(previous.map((p) => normalizeTopic(p.topic)));

    // 1) Caché cross-usuario por esqueleto (misma ruta canónica = misma sugerencia).
    let suggestion: NextPathSuggestion | null = null;
    let source = "cache";
    let collidedWithHistory = false;
    if (path.skeletonCacheKey) {
      const [cached] = await db
        .select()
        .from(nextPathSuggestions)
        .where(eq(nextPathSuggestions.skeletonCacheKey, path.skeletonCacheKey))
        .limit(1);
      if (cached && previousTopics.has(normalizeTopic(cached.topic))) {
        // La sugerencia canónica colisiona con su historial: cae al camino
        // Haiku (que recibe la lista de exclusión). Las reasons del caché eran
        // seguras, pero el topic repetido quema el upsell estrella.
        collidedWithHistory = true;
        console.log(
          `[next-path] HIT descartado: "${cached.topic}" ya cursado por el usuario — regenerando con exclusión`,
        );
      } else if (cached) {
        suggestion = {
          topic: cached.topic,
          goal: cached.goal,
          level: cached.level,
          reasons: cached.reasons,
        };
      }
    }

    // 2) Haiku con contexto real (módulos completados + temas previos).
    if (!suggestion) {
      source = "haiku";
      try {
        const { modules } = await import("@/db/schema");
        const mods = await db
          .select({ title: modules.title })
          .from(modules)
          .where(eq(modules.pathId, args.sourcePathId))
          .orderBy(modules.orderIndex);
        const intake = (path.intake ?? {}) as Partial<Intake>;

        const client = getAnthropic();
        const res = await client.messages.parse({
          model: MODELS.ranker,
          max_tokens: MAX_TOKENS.ranker,
          system: cachedSystem(NEXT_PATH_INSTRUCTIONS),
          output_config: { format: zodOutputFormat(nextPathSuggestionSchema) },
          messages: [
            {
              role: "user",
              content: [
                `RUTA COMPLETADA: ${path.title} (tema: ${path.topic}, nivel: ${path.level})`,
                `Meta original del estudiante: ${path.goal}`,
                intake.priorExperience ? `Experiencia previa: ${intake.priorExperience}` : "",
                `Módulos dominados: ${mods.map((m) => m.title).join(" · ")}`,
                `Temas YA cursados (no repetir): ${[...new Set(previous.map((p) => p.topic))].join(", ")}`,
                `Idioma: ${path.language}`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        });
        if (res.parsed_output) suggestion = res.parsed_output;
      } catch (e) {
        console.error("[next-path] Haiku falló, uso fallback:", e);
      }
    }

    // 3) Fallback determinista.
    if (!suggestion) {
      source = "deterministic";
      const { modules } = await import("@/db/schema");
      const mods = await db
        .select({ title: modules.title })
        .from(modules)
        .where(eq(modules.pathId, args.sourcePathId))
        .orderBy(modules.orderIndex);
      suggestion = deterministicSuggestion({
        topic: path.topic,
        level: path.level,
        lastModuleTitle: mods[mods.length - 1]?.title,
      });
    }

    // 4) Persistir (idempotente; carrera segura). Si la sugerencia se generó
    //    excluyendo el historial de ESTE usuario (colisión con el HIT), no se
    //    indexa como canónica del esqueleto: es personal, no cross-usuario.
    await db
      .insert(nextPathSuggestions)
      .values({
        userId: args.userId,
        sourcePathId: args.sourcePathId,
        skeletonCacheKey: collidedWithHistory ? null : path.skeletonCacheKey,
        topic: suggestion.topic,
        goal: suggestion.goal,
        level: suggestion.level,
        reasons: suggestion.reasons,
        source,
      })
      .onConflictDoNothing({ target: nextPathSuggestions.sourcePathId });

    return suggestion;
  } catch (e) {
    console.error("[next-path] getOrCreateNextPathSuggestion falló:", e);
    return null;
  }
}

/** URL de /app/crear precargada con la sugerencia ("ajustar antes de crear").
 *  `via` instrumenta el funnel de continuación (card | email | clase_cierre). */
export function nextPathUrl(
  s: NextPathSuggestion,
  fromPathId: string,
  via?: "card" | "email" | "clase_cierre",
): string {
  const params = new URLSearchParams({
    topic: s.topic,
    goal: s.goal,
    level: s.level,
    from: fromPathId,
  });
  if (via) params.set("via", via);
  return `/app/crear?${params.toString()}`;
}
