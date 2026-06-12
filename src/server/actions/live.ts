"use server";

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  learningPaths,
  liveSessions,
  routeAgents,
  skeletonCache,
  homeworkItems,
  learnerProfiles,
  profiles,
  progress,
  lessons,
  modules,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { getOrCreateRouteAgent } from "@/lib/live/persona";
import { getEntitlement, proPeriodWindow } from "@/lib/subscription";
import { createVoiceAgent, deleteVoiceAgent } from "@/lib/live/provider";
import { sweepOrphanSessions } from "@/lib/live/sweep";
import type { PathSkeleton } from "@/lib/ai/schemas";

const MAX_CLASS_MINUTES = 30;

/**
 * Minutos de clase consumidos (completadas/missed por duración real +
 * in_progress por tiempo transcurrido, cap 30 min). SOLO kind='class': la
 * inducción es onboarding — su costo es CAC, no consumo del alumno (decisión
 * del fundador). Sin esto, inducción 12 + clase 30 = 42 ≥ 40 bloqueaba la
 * clase de cierre prometida justo al alumno que completó la ruta.
 */
async function usedClassMinutes(
  userId: string,
  opts: { pathId?: string; since?: Date },
): Promise<number> {
  const conds = [
    eq(liveSessions.userId, userId),
    eq(liveSessions.kind, "class"),
    sql`${liveSessions.status} in ('completed', 'missed', 'in_progress')`,
  ];
  if (opts.pathId) conds.push(eq(liveSessions.pathId, opts.pathId));
  if (opts.since) conds.push(gte(liveSessions.createdAt, opts.since));
  const [used] = await db
    .select({
      sec: sql<number>`coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)::int`,
      inProgressSec: sql<number>`coalesce(sum(least(extract(epoch from now() - ${liveSessions.startedAt}), ${MAX_CLASS_MINUTES * 60}::int)) filter (where ${liveSessions.status} = 'in_progress'), 0)::int`,
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
  // sin cerrar) → missed con su duración REAL + resumen/correo de tareas si
  // hubo conversación. El cron sweep-live-sessions hace el mismo barrido
  // global cada 15 min (el correo llega aunque el alumno no vuelva).
  await sweepOrphanSessions({ userId: user.id });

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

  // REGLAS DE CLASES (server-side — la UI solo refleja, jamás decide):
  // BÁSICO: clases SOLO dentro del viaje de su ruta — inducción al inicio,
  //   clase completa desde el 40% de avance, cierre al 100% — y dentro del
  //   cupo CLASS_MINUTES_PER_ROUTE por ruta (la inducción NO consume cupo).
  // PRO: además del viaje, clases libres con cualquiera de sus profesores
  //   contra su pool del PERÍODO pagado (PRO_MONTHLY_CLASS_MINUTES).
  const { isPro } = await getEntitlement(user.id);
  const [me] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const privileged = isPro || !!me?.isAdmin;

  // Gate pedagógico del 40% (antes vivía solo en la UI — saltable).
  if (sessionKind === "class" && !privileged) {
    const [prog] = await db
      .select({
        done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
        total: sql<number>`(select count(*) from ${lessons} l join ${modules} m on m.id = l.module_id where m.path_id = ${pathId})::int`,
      })
      .from(progress)
      .where(and(eq(progress.userId, user.id), eq(progress.pathId, pathId)));
    const pct = prog?.total ? (Number(prog.done) / Number(prog.total)) * 100 : 0;
    if (pct < 40) redirect(`/app/rutas/${pathId}?clase_error=avance`);
  }

  // El cupo solo gobierna CLASES; la inducción va fuera (decisión fundador).
  if (sessionKind === "class") {
    const routeUsed = await usedClassMinutes(user.id, { pathId });
    if (routeUsed >= env.CLASS_MINUTES_PER_ROUTE) {
      if (!privileged) redirect(`/app/rutas/${pathId}?clase_error=cupo_ruta`);
      // Pool Pro: la ventana es el PERÍODO pagado, no el mes calendario
      // (misma ventana que muestra la UI de profesores — una sola verdad).
      const { start: periodStart } = await proPeriodWindow(user.id);
      const monthUsed = await usedClassMinutes(user.id, { since: periodStart });
      if (monthUsed >= env.PRO_MONTHLY_CLASS_MINUTES && !me?.isAdmin) {
        redirect(`/app/rutas/${pathId}?clase_error=cupo_pro`);
      }
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
  // El modo del agente se fija AL NACER según el entorno (con
  // ELEVENLABS_WEBHOOK_SECRET válida nace en modo seguro; sin ella, legado
  // con overrides). El aula NO asume nada de esto: resuelve el modo POR
  // AGENTE leyendo su config real (resolveInitiationMode), así que flotas
  // mixtas durante el rollout funcionan sin aulas muertas ni clases genéricas.
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
    // CARRERA (dos primeras clases simultáneas del mismo esqueleto — el
    // escenario exacto del pre-calentamiento de una demo): solo gana quien
    // escribe sobre NULL; el perdedor borra su agente huérfano de ElevenLabs
    // y usa el del ganador. Jamás dos agentes para la misma persona.
    const won = await db
      .update(routeAgents)
      .set({ elevenlabsAgentId: elId, updatedAt: new Date() })
      .where(and(eq(routeAgents.id, agent.id), isNull(routeAgents.elevenlabsAgentId)))
      .returning({ id: routeAgents.id });
    if (!won.length) {
      void deleteVoiceAgent(elId).catch((e) =>
        console.error("[live] no se pudo borrar el agente huérfano:", e),
      );
      const [winner] = await db
        .select({ elId: routeAgents.elevenlabsAgentId })
        .from(routeAgents)
        .where(eq(routeAgents.id, agent.id))
        .limit(1);
      if (!winner?.elId) redirect(`/app/rutas/${pathId}?clase_error=voz`);
    }
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

/** Carga y valida UNA sesión in_progress del usuario autenticado. */
async function ownedLiveSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [session] = await db
    .select({
      id: liveSessions.id,
      userId: liveSessions.userId,
      pathId: liveSessions.pathId,
    })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.id, sessionId),
        eq(liveSessions.userId, user.id),
        eq(liveSessions.status, "in_progress"),
      ),
    )
    .limit(1);
  return session ?? null;
}

/**
 * El profesor tachó una tarea EN VIVO (client tool marcar_tarea): done +
 * reviewedInSessionId — la pizarra la tacha y la próxima clase no la repite.
 */
export async function markHomeworkFromClassAction(
  sessionId: string,
  homeworkId: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await ownedLiveSession(sessionId);
  if (!session) return { ok: false, message: "Sesión no encontrada" };

  const [updated] = await db
    .update(homeworkItems)
    .set({ done: true, reviewedInSessionId: session.id })
    .where(
      and(
        eq(homeworkItems.id, homeworkId),
        eq(homeworkItems.userId, session.userId),
        eq(homeworkItems.pathId, session.pathId),
      ),
    )
    .returning({ task: homeworkItems.task });
  if (!updated) return { ok: false, message: "Tarea no encontrada" };
  revalidatePath(`/app/rutas/${session.pathId}`);
  return { ok: true, message: `Tarea "${updated.task}" marcada como hecha y tachada en la pizarra.` };
}

/**
 * El profesor agendó la próxima clase EN VIVO (tool agendar_proxima_clase):
 * fila `scheduled` + recordatorio class_reminder diferido vía Trigger.dev
 * (reminder_run_ids permite invalidarlo si se reagenda). El correo es
 * transaccional — no depende de LIFECYCLE_EMAILS_ENABLED.
 */
export async function scheduleNextClassAction(
  sessionId: string,
  dias: number,
): Promise<{ ok: boolean; message: string }> {
  const session = await ownedLiveSession(sessionId);
  if (!session) return { ok: false, message: "Sesión no encontrada" };
  const days = Math.round(Number(dias));
  if (!Number.isFinite(days) || days < 1 || days > 14) {
    return { ok: false, message: "Los días deben estar entre 1 y 14" };
  }

  const scheduledAt = new Date(Date.now() + days * 86_400_000);
  // Reagendar REEMPLAZA la cita futura existente (una sola cita por ruta):
  // al pisar reminder_run_ids, el recordatorio viejo se vuelve no-op (el run
  // diferido verifica su membresía antes de enviar).
  const [existing] = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.userId, session.userId),
        eq(liveSessions.pathId, session.pathId),
        eq(liveSessions.status, "scheduled"),
        gte(liveSessions.scheduledAt, new Date()),
      ),
    )
    .limit(1);
  const scheduled = existing
    ? (
        await db
          .update(liveSessions)
          .set({ scheduledAt, reminderRunIds: [], updatedAt: new Date() })
          .where(eq(liveSessions.id, existing.id))
          .returning({ id: liveSessions.id })
      )[0]
    : (
        await db
          .insert(liveSessions)
          .values({
            userId: session.userId,
            pathId: session.pathId,
            kind: "class",
            status: "scheduled",
            scheduledAt,
          })
          .returning({ id: liveSessions.id })
      )[0];

  const fecha = scheduledAt
    .toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })
    .replace(/\./g, "");

  try {
    if (env.TRIGGER_SECRET_KEY) {
      const { tasks } = await import("@trigger.dev/sdk");
      // Recordatorio ~3 h antes de la cita (mínimo: en 1 minuto).
      const remindAt = new Date(
        Math.max(scheduledAt.getTime() - 3 * 3_600_000, Date.now() + 60_000),
      );
      const handle = await tasks.trigger(
        "class-reminder",
        { scheduledSessionId: scheduled!.id },
        { delay: remindAt },
      );
      await db
        .update(liveSessions)
        .set({ reminderRunIds: [handle.id], updatedAt: new Date() })
        .where(eq(liveSessions.id, scheduled!.id));
    } else {
      console.log("[live] sin TRIGGER_SECRET_KEY: cita agendada SIN recordatorio por correo");
    }
  } catch (e) {
    // La cita queda agendada igual; solo se pierde el recordatorio.
    console.error("[live] no se pudo programar el recordatorio:", e);
  }
  return {
    ok: true,
    message: `Próxima clase agendada para el ${fecha}. Le llegará un recordatorio por correo.`,
  };
}

/**
 * Exit ticket del cierre (tool registrar_aprendizaje): qué dijo el alumno
 * haber aprendido, EN SUS PALABRAS → sesión + memoria del profesor.
 */
export async function recordLearningAction(
  sessionId: string,
  resumen: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await ownedLiveSession(sessionId);
  if (!session) return { ok: false, message: "Sesión no encontrada" };
  const clean = String(resumen ?? "").trim().slice(0, 600);
  if (clean.length < 3) return { ok: false, message: "Resumen vacío" };

  await db
    .update(liveSessions)
    .set({ exitTicket: clean, updatedAt: new Date() })
    .where(eq(liveSessions.id, session.id));
  return { ok: true, message: "Aprendizaje registrado en la memoria del alumno." };
}

/**
 * Ajuste de ritmo (tool ajustar_dificultad) → learner_profiles.profile:
 * el brief de la PRÓXIMA clase abre con esta línea ("mi profe se adaptó").
 */
export async function adjustDifficultyAction(
  sessionId: string,
  direccion: string,
  motivo: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await ownedLiveSession(sessionId);
  if (!session) return { ok: false, message: "Sesión no encontrada" };
  const dir = direccion === "subir" ? "subir" : direccion === "bajar" ? "bajar" : null;
  if (!dir) return { ok: false, message: "Dirección inválida (subir|bajar)" };
  const cleanMotivo = String(motivo ?? "").trim().slice(0, 300) || "lo pidió en clase";

  const difficulty = { direccion: dir, motivo: cleanMotivo };
  const [existing] = await db
    .select({ id: learnerProfiles.id, profile: learnerProfiles.profile })
    .from(learnerProfiles)
    .where(
      and(
        eq(learnerProfiles.userId, session.userId),
        eq(learnerProfiles.pathId, session.pathId),
      ),
    )
    .limit(1);
  if (existing) {
    const prev = (existing.profile as Record<string, unknown>) ?? {};
    await db
      .update(learnerProfiles)
      .set({ profile: { ...prev, difficulty }, updatedAt: new Date() })
      .where(eq(learnerProfiles.id, existing.id));
  } else {
    await db.insert(learnerProfiles).values({
      userId: session.userId,
      pathId: session.pathId,
      profile: { difficulty },
    });
  }
  return {
    ok: true,
    message: dir === "bajar" ? "Listo: la próxima clase irá más pausada." : "Listo: la próxima clase subirá el desafío.",
  };
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
  // Solo ids con forma de conversación de ElevenLabs (un string arbitrario
  // del cliente no entra a la BD; el destilador además valida el agent_id).
  if (
    !conversationId ||
    !conversationId.startsWith("conv_") ||
    conversationId.length > 200
  ) {
    return;
  }

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

  const validConversationId =
    conversationId && conversationId.startsWith("conv_") && conversationId.length <= 200
      ? conversationId
      : null;

  const updated = await db
    .update(liveSessions)
    .set({
      status: "completed",
      endedAt: new Date(),
      // null al cerrar NO pisa el id persistido por attachConversationAction.
      ...(validConversationId ? { conversationId: validConversationId } : {}),
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
