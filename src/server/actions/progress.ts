"use server";

import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths } from "@/db/schema";

export interface GenProgress {
  status: string;
  generationProgress: number;
  generationStep: string | null;
  totalLessons: number | null;
  generationStartedAt: string | null;
}

/**
 * Fallback de polling para el progreso de generación (cuando Supabase Realtime
 * no conecta: red corporativa, etc.). Lectura mínima, valida dueño.
 */
export async function getGenerationProgress(
  pathId: string,
): Promise<GenProgress | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [row] = await db
    .select({
      status: learningPaths.status,
      generationProgress: learningPaths.generationProgress,
      generationStep: learningPaths.generationStep,
      totalLessons: learningPaths.totalLessons,
      generationStartedAt: learningPaths.generationStartedAt,
    })
    .from(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, user.id)))
    .limit(1);

  if (!row) return null;
  return {
    status: row.status,
    generationProgress: row.generationProgress,
    generationStep: row.generationStep,
    totalLessons: row.totalLessons,
    generationStartedAt: row.generationStartedAt
      ? row.generationStartedAt.toISOString()
      : null,
  };
}
