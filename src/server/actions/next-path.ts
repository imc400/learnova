"use server";

import { redirect } from "next/navigation";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  learningPaths,
  lessons,
  modules,
  profiles,
  progress,
  routeIntents,
  xpEvents,
} from "@/db/schema";
import { env } from "@/lib/env";
import { createPathRecord } from "@/lib/paths/create";
import { getOrCreateNextPathSuggestion } from "@/lib/next-path";
import { generateRoutePreview } from "@/lib/ai/wizard";
import {
  getEntitlement,
  proRoutesLeftThisMonth,
  FREE_PATH_LIMIT,
} from "@/lib/subscription";
import type { Intake } from "@/lib/ai/schemas";

/*
  "Siguiente paso" en UN clic (D-P1.2): del trofeo al temario bloqueado sin
  re-pasar por el wizard. El comprador más caliente del sistema (acaba de
  completar y pagar una ruta) ya tiene TODO su intake conocido: la sugerencia
  congelada + la ruta que dominó son el formulario ya respondido.

  Espeja el gating de createRouteIntentAction (paths.ts, Track B): paywall →
  intent pending_payment + preview → /app/pagar; Pro con cupo / paywall off →
  ruta directa. Cero lógica de cobro nueva.
*/

const VIAS = new Set(["card", "email", "clase_cierre"]);

export async function createNextPathIntentAction(
  sourcePathId: string,
  via?: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Propiedad + estado real de la ruta origen.
  const [path] = await db
    .select({
      id: learningPaths.id,
      title: learningPaths.title,
      language: learningPaths.language,
      intake: learningPaths.intake,
    })
    .from(learningPaths)
    .where(and(eq(learningPaths.id, sourcePathId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!path) redirect("/app");

  // La continuación solo existe desde el 100% (mismo gate que la card).
  const [prog] = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .leftJoin(
      progress,
      and(eq(progress.lessonId, lessons.id), eq(progress.userId, user.id)),
    )
    .where(eq(modules.pathId, sourcePathId));
  if (!prog || prog.total === 0 || prog.done < prog.total) {
    redirect(`/app/rutas/${sourcePathId}`);
  }

  // Sugerencia CONGELADA (la misma de la card, el correo y el profe de cierre).
  const suggestion = await getOrCreateNextPathSuggestion({
    userId: user.id,
    sourcePathId,
  });
  if (!suggestion) redirect(`/app/crear?from=${sourcePathId}`);

  const clickedVia = via && VIAS.has(via) ? via : null;

  // Reentrada: si ya hay un carro abierto para ESTA continuación, se retoma —
  // intents duplicados ensucian la recuperación de carros y queman previews.
  const [existing] = await db
    .select({ id: routeIntents.id })
    .from(routeIntents)
    .where(
      and(
        eq(routeIntents.userId, user.id),
        eq(routeIntents.sourcePathId, sourcePathId),
        eq(routeIntents.status, "pending_payment"),
        isNull(routeIntents.pathId),
        eq(routeIntents.topic, suggestion.topic),
      ),
    )
    .limit(1);
  if (existing) redirect(`/app/pagar/${existing.id}`);

  // Módulos dominados → priorExperience real (el Punto A del nuevo temario).
  const mods = await db
    .select({ title: modules.title })
    .from(modules)
    .where(eq(modules.pathId, sourcePathId))
    .orderBy(modules.orderIndex);
  const sourceIntake = (path.intake ?? {}) as Partial<Intake>;
  const priorExperience = `Completó la ruta "${path.title}": ${mods
    .map((m) => m.title)
    .join(" · ")}`.slice(0, 600);

  const intake: Intake = {
    topic: suggestion.topic,
    goal: suggestion.goal,
    level: suggestion.level,
    priorExperience,
    weeklyHours: sourceIntake.weeklyHours,
    language: path.language,
  };

  // Mismo gating que el wizard (paths.ts): Pro con cupo / admin / paywall off
  // pasan directo; el resto va al paywall con su preview.
  const [me] = await db
    .select({ isAdmin: profiles.isAdmin, phone: profiles.phone })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const { isPro } = await getEntitlement(user.id);
  const proHasQuota = isPro && (await proRoutesLeftThisMonth(user.id)) > 0;
  const paywallOn = env.PAYWALL_ENABLED === "true" && !proHasQuota && !me?.isAdmin;

  const [intent] = await db
    .insert(routeIntents)
    .values({
      userId: user.id,
      topic: intake.topic,
      level: intake.level,
      language: intake.language,
      goal: intake.goal,
      priorExperience,
      weeklyHours: intake.weeklyHours ?? null,
      phone: me?.phone ?? null,
      status: paywallOn ? "pending_payment" : "bypassed",
      amountClp: paywallOn ? env.PRICE_ROUTE_CLP : null,
      sourcePathId,
      clickedVia,
    })
    .returning({ id: routeIntents.id });
  if (!intent) throw new Error("No se pudo guardar tu siguiente ruta.");

  if (paywallOn) {
    // Preview real para el paywall (Haiku ~1 s; si falla, el paywall degrada
    // y lo re-intenta lazy — misma semántica que el flujo del wizard).
    const preview = await generateRoutePreview({
      topic: intake.topic,
      level: intake.level,
      goal: intake.goal,
      language: intake.language,
    });
    if (preview) {
      await db
        .update(routeIntents)
        .set({
          preview: {
            modules: preview.modules,
            hook: preview.hook,
            metaDisplay: intake.goal.split(".")[0]?.slice(0, 160) ?? "",
          },
          updatedAt: new Date(),
        })
        .where(eq(routeIntents.id, intent.id));
    }
    redirect(`/app/pagar/${intent.id}`);
  }

  // Sin paywall: techo de costos free de siempre (cupo ganado al completar).
  if (!isPro) {
    const [[created], [completed]] = await Promise.all([
      db.select({ n: count() }).from(learningPaths).where(eq(learningPaths.userId, user.id)),
      db
        .select({ n: count() })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, user.id), eq(xpEvents.source, "path_completed"))),
    ]);
    if (Number(created?.n ?? 0) >= FREE_PATH_LIMIT + Number(completed?.n ?? 0)) {
      redirect("/app/planes?motivo=limite-rutas");
    }
  }
  const newPath = await createPathRecord({ userId: user.id, intake, sourcePathId });
  await db
    .update(routeIntents)
    .set({ pathId: newPath.id, updatedAt: new Date() })
    .where(eq(routeIntents.id, intent.id));
  redirect(`/app/rutas/${newPath.id}`);
}
