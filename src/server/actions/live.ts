"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths, liveSessions, routeAgents, skeletonCache } from "@/db/schema";
import { env } from "@/lib/env";
import { getOrCreateRouteAgent } from "@/lib/live/persona";
import { createVoiceAgent } from "@/lib/live/provider";
import type { PathSkeleton } from "@/lib/ai/schemas";

/** Cupo beta (sin pagos): minutos de clase por semana por usuario. */
const WEEKLY_MINUTES_LIMIT = 30;
const MAX_CLASS_MINUTES = 30;

/**
 * Inicia (o retoma) una clase en vivo para una ruta del usuario.
 * Valida cupo en MINUTOS server-side ANTES de crear nada, asegura la persona
 * del profesor (y su agente de voz, lazy) y crea la sesión. El aula genera
 * las credenciales efímeras al cargar.
 */
export async function startClassAction(pathId: string) {
  if (env.LIVE_CLASSES_ENABLED === "false") {
    throw new Error("Las clases en vivo están temporalmente desactivadas.");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Propiedad de la ruta.
  const [path] = await db
    .select({
      id: learningPaths.id,
      title: learningPaths.title,
      language: learningPaths.language,
      skeletonCacheKey: learningPaths.skeletonCacheKey,
    })
    .from(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!path) throw new Error("Ruta no encontrada");

  // ¿Sesión en curso reciente? Reúsala (refresh del aula, doble clic).
  const [open] = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.userId, user.id),
        eq(liveSessions.pathId, pathId),
        eq(liveSessions.status, "in_progress"),
        gte(liveSessions.createdAt, new Date(Date.now() - 35 * 60_000)),
      ),
    )
    .limit(1);
  if (open) redirect(`/app/aula/${open.id}`);

  // Cupo semanal en minutos (completed + in_progress de los últimos 7 días).
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [used] = await db
    .select({
      sec: sql<number>`coalesce(sum(${liveSessions.durationSec}), 0)::int`,
      inProgress: sql<number>`count(*) filter (where ${liveSessions.status} = 'in_progress')::int`,
    })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.userId, user.id),
        gte(liveSessions.createdAt, weekAgo),
        inArray(liveSessions.status, ["completed", "in_progress"]),
      ),
    );
  const usedMin = Math.ceil(Number(used?.sec ?? 0) / 60) + Number(used?.inProgress ?? 0) * MAX_CLASS_MINUTES;
  if (usedMin >= WEEKLY_MINUTES_LIMIT) {
    throw new Error(
      "Alcanzaste tu cupo de clases de esta semana. Vuelve la próxima — tu profesor te estará esperando.",
    );
  }

  // Persona del profesor (por esqueleto canónico; fallback por ruta).
  const cacheKey = path.skeletonCacheKey ?? `path-${path.id}`;
  const [skel] = path.skeletonCacheKey
    ? await db
        .select({ skeleton: skeletonCache.skeleton })
        .from(skeletonCache)
        .where(eq(skeletonCache.cacheKey, path.skeletonCacheKey))
        .limit(1)
    : [];
  const skeleton = (skel?.skeleton as PathSkeleton | undefined) ?? {
    title: path.title,
    modules: [],
  };
  const agent = await getOrCreateRouteAgent(cacheKey, skeleton, path.language);
  if (!agent.approved) {
    throw new Error("El profesor de esta ruta está en revisión. Intenta más tarde.");
  }

  // Agente de voz lazy (una vez por persona).
  if (!agent.elevenlabsAgentId) {
    const elId = await createVoiceAgent({
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      greeting: agent.greeting,
      language: path.language,
      voiceId: agent.voiceId ?? undefined,
    });
    await db
      .update(routeAgents)
      .set({ elevenlabsAgentId: elId, updatedAt: new Date() })
      .where(eq(routeAgents.id, agent.id));
  }

  const [session] = await db
    .insert(liveSessions)
    .values({
      userId: user.id,
      pathId,
      status: "in_progress",
      startedAt: new Date(),
    })
    .returning({ id: liveSessions.id });

  redirect(`/app/aula/${session!.id}`);
}

/**
 * Cierra la clase: registra duración y conversación, y dispara el resumen
 * post-clase (tareas + correo). Idempotente: solo transiciona in_progress.
 */
export async function endClassAction(
  sessionId: string,
  conversationId: string | null,
  durationSec: number,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const updated = await db
    .update(liveSessions)
    .set({
      status: "completed",
      endedAt: new Date(),
      conversationId,
      durationSec: Math.min(Math.max(0, Math.round(durationSec)), MAX_CLASS_MINUTES * 60),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveSessions.id, sessionId),
        eq(liveSessions.userId, user.id),
        eq(liveSessions.status, "in_progress"),
      ),
    )
    .returning({ id: liveSessions.id });
  if (!updated.length) return; // ya cerrada (idempotente)

  // Resumen + tareas + correo, en background (nunca bloquea el cierre).
  try {
    if (env.TRIGGER_SECRET_KEY) {
      const { tasks } = await import("@trigger.dev/sdk");
      await tasks.trigger("summarize-class", { sessionId });
    } else if (env.NODE_ENV !== "production") {
      const { summarizeClass } = await import("@/lib/live/summarize");
      void summarizeClass(sessionId).catch((e) =>
        console.error("[live] resumen inline falló:", e),
      );
    }
  } catch (e) {
    console.error("[live] no se pudo encolar el resumen:", e);
  }
}
