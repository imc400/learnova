"use server";

import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths, xpEvents, profiles, routeIntents } from "@/db/schema";
import { env } from "@/lib/env";
import { createPathRecord } from "@/lib/paths/create";
import { intakeSchema } from "@/lib/ai/schemas";
import {
  getWizardQuestions,
  fallbackQuestions,
  fallbackTopicCheck,
  findTopicCheckForIntent,
  resolveCanonicalTopic,
  sanitizeVariant,
  wizardAnswersSchema,
  GOAL_ARCHETYPES,
  type GoalArchetype,
  type WizardQuestionsResult,
} from "@/lib/ai/wizard";
import {
  getEntitlement,
  proRoutesLeftThisMonth,
  FREE_PATH_LIMIT,
} from "@/lib/subscription";
/**
 * Paso 1 → 2 del intake adaptativo: preguntas a medida del tema (Haiku, con
 * caché en BD — comparte filas con el funnel público).
 * Nunca falla hacia el usuario: si la IA no responde, hay set de respaldo.
 */
export async function wizardQuestionsAction(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<WizardQuestionsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const topic = String(args.topic ?? "").trim().slice(0, 120);
  const level = ["principiante", "intermedio", "avanzado"].includes(args.level)
    ? args.level
    : "principiante";
  const language = ["es", "en", "pt"].includes(args.language) ? args.language : "es";
  if (topic.length < 2) {
    return {
      questions: fallbackQuestions(topic || "este tema"),
      topicCheck: fallbackTopicCheck(topic || "tema"),
      adaptive: false,
    };
  }
  return getWizardQuestions({ topic, level, language });
}

/** Crea una ruta desde el cuestionario de intake y dispara su generación. */
export async function createPathAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Techo de costos con "cupo ganado": el límite free crece con cada ruta
  // COMPLETADA (ledger path_completed, no gameable por URL). Quien termina,
  // desbloquea la siguiente — solo los que aprenden generan costo nuevo.
  const { isPro } = await getEntitlement(user.id);
  const [admin] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  // Admin exento del techo free: cuenta de pruebas del fundador.
  if (!isPro && !admin?.isAdmin) {
    const [[created], [completed]] = await Promise.all([
      db
        .select({ n: count() })
        .from(learningPaths)
        .where(eq(learningPaths.userId, user.id)),
      db
        .select({ n: count() })
        .from(xpEvents)
        .where(
          and(eq(xpEvents.userId, user.id), eq(xpEvents.source, "path_completed")),
        ),
    ]);
    const allowed = FREE_PATH_LIMIT + Number(completed?.n ?? 0);
    if (Number(created?.n ?? 0) >= allowed) {
      redirect("/app/planes?motivo=limite-rutas");
    }
  }

  // Métrica norte del "Siguiente paso": de qué ruta completada nació esta.
  const fromRaw = String(formData.get("from") ?? "");
  let sourcePathId: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(fromRaw)) {
    const [owned] = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(and(eq(learningPaths.id, fromRaw), eq(learningPaths.userId, user.id)))
      .limit(1);
    if (owned) sourcePathId = owned.id;
  }

  const weekly = formData.get("weeklyHours");
  const parsed = intakeSchema.safeParse({
    topic: String(formData.get("topic") ?? "").trim(),
    goal: String(formData.get("goal") ?? "").trim(),
    level: String(formData.get("level") ?? "principiante"),
    priorExperience: formData.get("priorExperience")
      ? String(formData.get("priorExperience"))
      : undefined,
    weeklyHours: weekly ? Number(weekly) : undefined,
    language: String(formData.get("language") || "es"),
  });

  if (!parsed.success) {
    redirect("/app/crear?error=validacion");
  }

  const intake = parsed.data;
  const path = await createPathRecord({ userId: user.id, intake, sourcePathId });
  redirect(`/app/rutas/${path.id}`);
}

/** Teléfono WhatsApp: dígitos con + opcional, 8-15 dígitos (E.164 relajado). */
function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  // Chile móvil sin código de país → +56
  if (/^9\d{8}$/.test(cleaned)) return `+56${cleaned}`;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

/**
 * Embudo de negocio: el wizard completo se guarda como INTENT antes de
 * generar nada. Con paywall encendido, el usuario paga primero (y si no paga,
 * queda su tema + WhatsApp para remarketing). Pro/admin/paywall-off pasan
 * directo al flujo de siempre.
 */
export async function createRouteIntentAction(input: {
  topic: string;
  goal: string;
  level: string;
  language: string;
  priorExperience?: string;
  weeklyHours?: number;
  phone: string;
  from?: string;
  /** Arquetipo de la meta elegida (catálogo cerrado; se valida igual). */
  goalArchetype?: string | null;
  /** Slug del medio/equipo elegido (celular, excel…); se sanea a slug. */
  variant?: string | null;
  /** Respuestas estructuradas del wizard (zod-validadas; jamás bloquean). */
  wizardAnswers?: unknown;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = intakeSchema.safeParse({
    topic: String(input.topic ?? "").trim(),
    goal: String(input.goal ?? "").trim(),
    level: input.level,
    priorExperience: input.priorExperience || undefined,
    weeklyHours: input.weeklyHours || undefined,
    language: input.language || "es",
  });
  if (!parsed.success) redirect("/app/crear?error=validacion");
  const intake = parsed.data;

  const phone = normalizePhone(String(input.phone ?? ""));
  if (!phone) redirect("/app/crear?error=telefono");

  // Gate de viabilidad re-derivado en SERVIDOR (la UI ya bloquea inseguro/
  // inviable en el paso 1→2; esto cubre llamadas directas a la action).
  // Sin él se puede pagar por una ruta que Opus va a rehusar → failed cobrado.
  const topicCheck = await findTopicCheckForIntent({
    topic: intake.topic,
    level: intake.level,
    language: intake.language,
  });
  if (topicCheck && ["inseguro", "inviable"].includes(topicCheck.verdict)) {
    throw new Error(
      topicCheck.note ?? "Ese tema no se puede convertir en una ruta de aprendizaje.",
    );
  }
  const canonicalTopic = resolveCanonicalTopic(topicCheck, intake.topic);
  const goalArchetype: GoalArchetype | null = GOAL_ARCHETYPES.includes(
    input.goalArchetype as GoalArchetype,
  )
    ? (input.goalArchetype as GoalArchetype)
    : null;
  const variant = sanitizeVariant(input.variant);
  const answersParsed = wizardAnswersSchema.safeParse(input.wizardAnswers ?? []);
  const wizardAnswers = {
    variant,
    answers: answersParsed.success ? answersParsed.data : [],
  };

  // Métrica "Siguiente paso": validar propiedad del origen.
  let sourcePathId: string | null = null;
  if (input.from && /^[0-9a-f-]{36}$/i.test(input.from)) {
    const [owned] = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(and(eq(learningPaths.id, input.from), eq(learningPaths.userId, user.id)))
      .limit(1);
    if (owned) sourcePathId = owned.id;
  }

  // El WhatsApp vive en el perfil (remarketing + futuros avisos).
  await db
    .update(profiles)
    .set({ phone, updatedAt: new Date() })
    .where(eq(profiles.id, user.id));

  const [me] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const { isPro } = await getEntitlement(user.id);
  // Pro incluye N rutas nuevas/mes; agotado el cupo, la extra paga precio
  // normal (los heavy users se monetizan, no se subsidian).
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
      priorExperience: intake.priorExperience ?? null,
      weeklyHours: intake.weeklyHours ?? null,
      phone,
      status: paywallOn ? "pending_payment" : "bypassed",
      amountClp: paywallOn ? env.PRICE_ROUTE_CLP : null,
      sourcePathId,
      // Contrato del caché (Opción A): topic canónico → base del cacheKey
      // (Track A); arquetipo + respuestas discretas → overlay/analítica.
      canonicalTopic,
      goalArchetype,
      wizardAnswers,
    })
    .returning({ id: routeIntents.id });
  if (!intent) throw new Error("No se pudo guardar tu solicitud.");

  if (paywallOn) {
    // El preview lo genera el paywall (pagar/page.tsx) de forma perezosa e
    // idempotente, leyendo PRIMERO el canon de skeleton_cache. Generarlo aquí
    // duplicaba la llamada Haiku y sumaba 1-2 s al submit del wizard.
    redirect(`/app/pagar/${intent.id}`);
  }

  // Sin paywall: techo de costos free de siempre (cupo ganado al completar).
  // Admin exento (cuenta de pruebas del fundador).
  if (!isPro && !me?.isAdmin) {
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
  const path = await createPathRecord({ userId: user.id, intake, sourcePathId });
  await db
    .update(routeIntents)
    .set({ pathId: path.id, updatedAt: new Date() })
    .where(eq(routeIntents.id, intent.id));
  redirect(`/app/rutas/${path.id}`);
}
