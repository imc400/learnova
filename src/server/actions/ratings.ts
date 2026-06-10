"use server";

import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { moduleRatings, modules, learningPaths } from "@/db/schema";

const VALID_REASONS = new Set(["video", "texto", "quiz", "nivel"]);

/**
 * Puntúa un módulo (👍/👎) con razón y comentario opcionales. Upsert por
 * (user, module): re-puntuar actualiza. Valida propiedad de la ruta.
 * El agregado por módulo canónico alimenta el loop de calidad del contenido.
 */
export async function rateModuleAction(args: {
  moduleId: string;
  rating: "up" | "down";
  reason?: string | null;
  comment?: string | null;
}): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  if (args.rating !== "up" && args.rating !== "down") {
    throw new Error("Rating inválido");
  }

  // Propiedad: el módulo debe pertenecer a una ruta del usuario.
  const [ctx] = await db
    .select({ moduleId: modules.id, pathId: learningPaths.id })
    .from(modules)
    .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
    .where(and(eq(modules.id, args.moduleId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!ctx) throw new Error("Módulo no encontrado");

  const reason =
    args.reason && VALID_REASONS.has(args.reason) ? args.reason : null;
  const comment = args.comment ? String(args.comment).slice(0, 500) : null;

  await db
    .insert(moduleRatings)
    .values({
      userId: user.id,
      moduleId: ctx.moduleId,
      pathId: ctx.pathId,
      rating: args.rating,
      reason,
      comment,
    })
    .onConflictDoUpdate({
      target: [moduleRatings.userId, moduleRatings.moduleId],
      set: { rating: args.rating, reason, comment, updatedAt: new Date() },
    });

  return { ok: true };
}
