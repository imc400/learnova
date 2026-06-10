"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  learningPaths,
  liveSessions,
  routeAgents,
  skeletonCache,
  homeworkItems,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { getOrCreateRouteAgent } from "@/lib/live/persona";
import { getEntitlement } from "@/lib/subscription";
import { createVoiceAgent } from "@/lib/live/provider";
import type { PathSkeleton } from "@/lib/ai/schemas";

const MAX_CLASS_MINUTES = 30;

/**
 * Minutos de clase consumidos (completadas/missed por duración real +
 * in_progress por tiempo transcurrido, cap 30 min).
 */
async function usedClassMinutes(
  userId: string,
  opts: { pathId?: string; since?: Date },
): Promise<number> {
  const conds = [
    eq(liveSessions.userId, userId),
    inArray(liveSessions.status, ["completed", "missed", "in_progress"]),
  ];
  if (opts.pathId) conds.push(eq(liveSessions.pathId, opts.pathId));
  if (opts.since) conds.push(gte(liveSessions.createdAt, opts.since));
  const [used] = await db
    .select({
      sec: sql<number>`coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)::int`,
      inProgressSec: sql<number>`coalesce(sum(least(extract(epoch from now() - ${liveSessions.startedAt}), ${MAX_CLASS_MINUTES * 60})) filter (where ${liveSessions.status} = 'in_progress'), 0)::int`,
    })
    .from(liveSessions)
    .where(and(...conds));
  return Math.ceil((Number(used?.sec ?? 0) + Number(used?.inProgressSec ?? 0)) / 60);
}

/**
 * Inicia (o retoma) una clase en vivo para una ruta del usuario.
 * Valida cupo en MINUTOS server-side ANTES de crear nada, asegura la persona
 * del profesor (y su agente de voz, lazy) y crea la sesión. El aula genera
 * las credenciales efímeras al cargar.
 */
export async function startClassAction(
  pathId: string,
  kind: "class" | "induction" = "class",
) {
  // Vía <form action={startClassAction.bind(null, id)}> llega un FormData como
  // segundo argumento — cualquier cosa que no sea "induction" es clase normal.
  const sessionKind = kind === "induction" ? "induction" : "class";
  if (env.LIVE_CLASSES_ENABLED === "false") {
    redirect(`/app/rutas/${pathId}?clase_error=desactivadas`);
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
  if (!path) redirect("/app");

  // SANEAMIENTO: sesiones in_progress huérfanas (>35 min = el cliente murió
  // sin cerrar). Se marcan missed con su duración real estimada — sin esto
  // bloquean el cupo semanal para siempre.
  await db
    .update(liveSessions)
    .set({ status: "missed", endedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(liveSessions.userId, user.id),
        eq(liveSessions.status, "in_progress"),
        sql`${liveSessions.createdAt} < now() - interval '35 minutes'`,
      ),
    );

  // La inducción es ÚNICA por ruta: una vez completada, no se repite (el
  // alumno debe avanzar; su profesor lo espera en la clase del 40%).
  if (sessionKind === "induction") {
    const [doneInduction] = await db
      .select({ id: liveSessions.id })
      .from(liveSessions)
      .where(
        and(
          eq(liveSessions.userId, user.id),
          eq(liveSessions.pathId, pathId),
          eq(liveSessions.kind, "induction"),
          eq(liveSessions.status, "completed"),
        ),
      )
      .limit(1);
    if (doneInduction) redirect(`/app/rutas/${pathId}?clase_error=induccion_hecha`);
  }

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

  // CUPO DE CLASES (modelo por producto, env-tunable):
  // - Cada RUTA incluye CLASS_MINUTES_PER_ROUTE min (inducción + clase del
  //   40% + cierre del 100%).
  // - Pro además tiene un pool mensual EXTRA (PRO_MONTHLY_CLASS_MINUTES) para
  //   clases adicionales con cualquiera de sus profesores.
  // - Básico sin cupo de ruta → upsell (Pro o clase suelta).
  const routeUsed = await usedClassMinutes(user.id, { pathId });
  if (routeUsed >= env.CLASS_MINUTES_PER_ROUTE) {
    const { isPro } = await getEntitlement(user.id);
    if (!isPro) redirect(`/app/rutas/${pathId}?clase_error=cupo_ruta`);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthUsed = await usedClassMinutes(user.id, { since: monthStart });
    if (monthUsed >= env.PRO_MONTHLY_CLASS_MINUTES) {
      redirect(`/app/rutas/${pathId}?clase_error=cupo_pro`);
    }
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
    redirect(`/app/rutas/${pathId}?clase_error=revision`);
  }

  // Agente de voz lazy (una vez por persona). Si ElevenLabs falla, el usuario
  // recibe un banner claro — jamás una página de error cruda.
  if (!agent.elevenlabsAgentId) {
    let elId: string;
    try {
      elId = await createVoiceAgent({
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        greeting: agent.greeting,
        language: path.language,
        voiceId: agent.voiceId ?? undefined,
      });
    } catch (e) {
      console.error("[live] creación del agente de voz falló:", e);
      redirect(`/app/rutas/${pathId}?clase_error=voz`);
    }
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
      kind: sessionKind,
      status: "in_progress",
      startedAt: new Date(),
    })
    .returning({ id: liveSessions.id });

  redirect(`/app/aula/${session!.id}`);
}

/**
 * El profesor propuso EN VIVO agregar un módulo (client tool agregar_modulo).
 * Se registra en la sesión; al cerrar la clase se genera de verdad.
 */
export async function proposeModuleAction(
  sessionId: string,
  title: string,
  reason: string,
): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "No autenticado" };

  const cleanTitle = String(title ?? "").trim().slice(0, 120);
  const cleanReason = String(reason ?? "").trim().slice(0, 400);
  if (cleanTitle.length < 3) return { ok: false, message: "Título inválido" };

  const [session] = await db
    .select({ id: liveSessions.id, proposed: liveSessions.proposedModules })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.id, sessionId),
        eq(liveSessions.userId, user.id),
        eq(liveSessions.status, "in_progress"),
      ),
    )
    .limit(1);
  if (!session) return { ok: false, message: "Sesión no encontrada" };

  const proposed = session.proposed ?? [];
  if (proposed.length >= 2) {
    return { ok: false, message: "Máximo 2 módulos por clase" };
  }
  if (proposed.some((p) => p.title.toLowerCase() === cleanTitle.toLowerCase())) {
    return { ok: true, message: "Ya estaba propuesto" };
  }

  await db
    .update(liveSessions)
    .set({
      proposedModules: [...proposed, { title: cleanTitle, reason: cleanReason }],
      updatedAt: new Date(),
    })
    .where(eq(liveSessions.id, session.id));
  return { ok: true, message: `Módulo "${cleanTitle}" agendado` };
}

/**
 * Persiste el conversationId APENAS conecta el aula (no solo al cerrar):
 * si el alumno refresca o pierde la conexión, el resumen post-clase igual
 * encuentra la transcripción.
 */
export async function attachConversationAction(
  sessionId: string,
  conversationId: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (!conversationId || conversationId.length > 200) return;

  await db
    .update(liveSessions)
    .set({ conversationId, updatedAt: new Date() })
    .where(
      and(
        eq(liveSessions.id, sessionId),
        eq(liveSessions.userId, user.id),
        eq(liveSessions.status, "in_progress"),
      ),
    );
}

/** Marca/desmarca una tarea del profesor como hecha (desde la ruta). */
export async function toggleHomeworkAction(itemId: string, formData?: FormData) {
  void formData;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [updated] = await db
    .update(homeworkItems)
    .set({ done: sql`not ${homeworkItems.done}` })
    .where(and(eq(homeworkItems.id, itemId), eq(homeworkItems.userId, user.id)))
    .returning({ pathId: homeworkItems.pathId });
  if (updated) revalidatePath(`/app/rutas/${updated.pathId}`);
}

/**
 * Cierra la clase: registra duración y conversación, y dispara el resumen
 * post-clase (tareas + correo) y la generación de los módulos que el profesor
 * propuso en vivo. Idempotente: solo transiciona in_progress.
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
      // null al cerrar NO pisa el id persistido por attachConversationAction.
      ...(conversationId ? { conversationId } : {}),
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
    .returning({ id: liveSessions.id, pathId: liveSessions.pathId, proposedModules: liveSessions.proposedModules });
  if (!updated.length) return; // ya cerrada (idempotente)
  const closed = updated[0]!;

  // Resumen + módulos propuestos, en background (nunca bloquea el cierre).
  try {
    if (env.TRIGGER_SECRET_KEY) {
      const { tasks } = await import("@trigger.dev/sdk");
      await tasks.trigger("summarize-class", { sessionId });
      for (const p of closed.proposedModules ?? []) {
        await tasks.trigger("extend-path", {
          pathId: closed.pathId,
          sessionId,
          title: p.title,
          reason: p.reason,
        });
      }
    } else if (env.NODE_ENV !== "production") {
      const { summarizeClass } = await import("@/lib/live/summarize");
      void summarizeClass(sessionId).catch((e) =>
        console.error("[live] resumen inline falló:", e),
      );
      const { extendPathWithModule } = await import("@/lib/generation/extend");
      for (const p of closed.proposedModules ?? []) {
        void extendPathWithModule({
          pathId: closed.pathId,
          sessionId,
          requestedTitle: p.title,
          reason: p.reason,
        }).catch((e) => console.error("[live] extensión inline falló:", e));
      }
    }
  } catch (e) {
    console.error("[live] no se pudo encolar el post-clase:", e);
  }
}
