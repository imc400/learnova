"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/db";
import { learningPaths, opsIncidents } from "@/db/schema";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { runReconciliation, type ReconcileReport } from "@/lib/ops/reconcile";

/*
  Acciones de operación (E-P1.3):
  - retryGenerationAction: el botón "Reintentar" que la UI de failed promete
    hace meses y no existía. runPathGeneration es idempotente y resume vía
    lesson_content_cache — el reintento es gratis de ofrecer.
  - adminReplayPathAction / adminRunReconcileAction / resolveIncidentAction:
    el panel de salud del admin (replay por fila + reconciliación a demanda).
*/

type ActionResult = { ok: true } | { ok: false; error: string };

/** Reintento de generación por el DUEÑO de la ruta (botón en generating-state). */
export async function retryGenerationAction(pathId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "No autorizado" };

    const [path] = await db
      .select({
        id: learningPaths.id,
        status: learningPaths.status,
        progress: learningPaths.generationProgress,
        updatedAt: learningPaths.updatedAt,
      })
      .from(learningPaths)
      .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, user.id)))
      .limit(1);
    if (!path) return { ok: false, error: "Ruta no encontrada" };

    // Estados elegibles: failed, o ready incompleta y quieta >30 min (no
    // interferir con una generación que avanza bien).
    const readyIncompleta =
      path.status === "ready" &&
      path.progress < 100 &&
      Date.now() - path.updatedAt.getTime() > 30 * 60 * 1000;
    if (path.status !== "failed" && !readyIncompleta) {
      return { ok: false, error: "La ruta no está en un estado reintetable" };
    }

    if (path.status === "failed") {
      await db
        .update(learningPaths)
        .set({ status: "generating", generationStartedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(learningPaths.id, pathId), eq(learningPaths.status, "failed")));
    }
    await enqueuePathGeneration(pathId);
    revalidatePath(`/app/rutas/${pathId}`);
    return { ok: true };
  } catch (e) {
    console.error("[ops] retryGenerationAction:", e);
    return { ok: false, error: "No pudimos re-encolar — intenta de nuevo o escríbenos a hola@aulia.ai" };
  }
}

/** Replay desde el admin (sin ownership): failed, draft, colgada o incompleta. */
export async function adminReplayPathAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const pathId = String(formData.get("pathId") ?? "");
  if (!pathId) return;
  try {
    // failed → volver a generating para que la UI del alumno muestre progreso.
    await db
      .update(learningPaths)
      .set({ status: "generating", generationStartedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(learningPaths.id, pathId), eq(learningPaths.status, "failed")));
    await enqueuePathGeneration(pathId);
  } catch (e) {
    console.error("[ops] adminReplayPathAction:", e);
  }
  revalidatePath("/app/admin");
}

/** Corre la reconciliación completa a demanda (botón del panel de salud). */
export async function adminRunReconcileAction(): Promise<ReconcileReport | null> {
  await requireAdmin();
  try {
    const report = await runReconciliation();
    revalidatePath("/app/admin");
    return report;
  } catch (e) {
    console.error("[ops] adminRunReconcileAction:", e);
    return null;
  }
}

/** Variante para <form action>: Next exige Promise<void> en formularios. */
export async function adminRunReconcileFormAction(): Promise<void> {
  await adminRunReconcileAction();
}

/** Marca un incidente como resuelto (apaga el banner rojo del admin). */
export async function resolveIncidentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const incidentId = String(formData.get("incidentId") ?? "");
  if (!incidentId) return;
  try {
    await db
      .update(opsIncidents)
      .set({ resolvedAt: sql`now()` })
      .where(eq(opsIncidents.id, incidentId));
  } catch (e) {
    console.error("[ops] resolveIncidentAction:", e);
  }
  revalidatePath("/app/admin");
}
