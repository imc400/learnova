import { task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { runPathGeneration } from "@/lib/generation/run";
import { db } from "@/db";
import { learningPaths } from "@/db/schema";
import { alertFounder } from "@/lib/ops/alert";

/** Job de generación de ruta (Opus → Sonnet → Haiku + curación de video). */
export const generatePathTask = task({
  id: "generate-path",
  // 45 min: el pipeline con digests de video + coverage gate + quiz grounded
  // supera los 20 min en rutas frescas de ~25 lecciones. Si aún así se corta,
  // el reintento RESUME vía lesson_content_cache (lo hecho no se re-paga).
  maxDuration: 2700,
  // Backoff exponencial (evita golpear el rate limit de Anthropic en 429).
  // Seguro reintentar porque runPathGeneration es idempotente (upserts + guard).
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000 },
  onFailure: async ({ payload, error }) => {
    console.error("[trigger] generate-path falló definitivamente", {
      pathId: payload.pathId,
      error,
    });
    // Estado real ANTES de tocar nada: distingue "murió sin estructura" de
    // "ready pero incompleta" (allSettled dejó lecciones fallidas — A-P0.1).
    let status: string | null = null;
    let progress: number | null = null;
    try {
      const [p] = await db
        .select({
          status: learningPaths.status,
          generationProgress: learningPaths.generationProgress,
        })
        .from(learningPaths)
        .where(eq(learningPaths.id, payload.pathId))
        .limit(1);
      status = p?.status ?? null;
      progress = p?.generationProgress ?? null;
    } catch (e) {
      console.error("[trigger] no se pudo leer el estado de la ruta:", e);
    }
    // La ruta NUNCA queda 'generating' eterna: si los 3 intentos murieron antes
    // de publicar la estructura, se marca failed (la UI ofrece reintentar).
    // Si ya está 'ready', se respeta: lo generado sirve y un retry manual rellena.
    try {
      await db
        .update(learningPaths)
        .set({ status: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(learningPaths.id, payload.pathId),
            eq(learningPaths.status, "generating"),
          ),
        );
    } catch (e) {
      console.error("[trigger] no se pudo marcar failed:", e);
    }
    // Dinero ya cobrado + generación muerta = incidente: el fundador se
    // entera por correo, no por el reclamo del cliente.
    const readyIncomplete = status === "ready" && (progress ?? 0) < 100;
    await alertFounder({
      titulo: readyIncomplete
        ? "Ruta publicada INCOMPLETA tras 3 intentos"
        : "Generación de ruta MURIÓ tras 3 intentos",
      detalle: readyIncomplete
        ? "La estructura está 'ready' y el cliente la ve, pero quedaron lecciones SIN contenido (progress < 100) tras agotar los reintentos. Re-disparar generate-path regenera SOLO las faltantes (idempotente por lección) — revisar el run en Trigger.dev."
        : "La generación falló definitivamente. La ruta quedó en 'failed' (la UI ofrece reintentar), pero si fue una compra hay un cliente esperando — revisar el run en Trigger.dev y reintentar.",
      contexto: {
        pathId: payload.pathId,
        status,
        progress,
        error: String(error).slice(0, 300),
      },
    });
  },
  run: async (payload: { pathId: string }) => {
    await runPathGeneration(payload.pathId);
    return { pathId: payload.pathId, ok: true };
  },
});
