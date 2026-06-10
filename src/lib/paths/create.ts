import { db } from "@/db";
import { learningPaths } from "@/db/schema";
import type { Intake } from "@/lib/ai/schemas";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { slugify } from "@/lib/utils";

/** Valores de inserción de una ruta nueva (compartido action ↔ webhook). */
export function buildPathInsertValues(args: {
  userId: string;
  intake: Intake;
  sourcePathId?: string | null;
}) {
  const { intake } = args;
  return {
    userId: args.userId,
    title: intake.topic,
    slug: `${slugify(intake.topic)}-${Math.random().toString(36).slice(2, 7)}`,
    goal: intake.goal,
    topic: intake.topic,
    level: intake.level,
    language: intake.language,
    status: "generating" as const,
    intake,
    sourcePathId: args.sourcePathId ?? null,
  };
}

/**
 * Crea la ruta y dispara su generación. Punto ÚNICO de creación: lo usan el
 * flujo gratuito (action del wizard) y el webhook de pago (intent pagado).
 */
export async function createPathRecord(args: {
  userId: string;
  intake: Intake;
  sourcePathId?: string | null;
}): Promise<{ id: string }> {
  const [path] = await db
    .insert(learningPaths)
    .values(buildPathInsertValues(args))
    .returning({ id: learningPaths.id });
  if (!path) throw new Error("No se pudo crear la ruta.");

  await enqueuePathGeneration(path.id);
  return path;
}
