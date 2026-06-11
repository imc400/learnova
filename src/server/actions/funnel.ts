"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { learningPaths, profiles, routeIntents, xpEvents } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
import { createPathRecord } from "@/lib/paths/create";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  getEntitlement,
  proRoutesLeftThisMonth,
  FREE_PATH_LIMIT,
} from "@/lib/subscription";
import { env } from "@/lib/env";

/*
  EMBUDO DE VENTA (wizard-first, sin cuenta previa):
  /empieza → arma tu ruta (anónimo) → preguntas IA → email+WhatsApp+contraseña
  → se crea la cuenta AUTO-CONFIRMADA + el intent + el preview → paywall.
  Si paga: ruta. Si no: tenemos tema + correo + WhatsApp = carro abandonado.
*/

/** Preguntas del wizard SIN auth (landing de ads). Con caché en BD: temas
 *  calientes responden instantáneo y sin tocar Haiku. */
export async function publicWizardQuestionsAction(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<WizardQuestionsResult> {
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
  // Anti-abuso (lib de Track E, fail-open): un bot con while(true) facturaba
  // Haiku sin límite. Al excederse NO se rompe el funnel: preguntas de
  // respaldo (texto libre, cero IA) — el humano legítimo sigue avanzando.
  const rl = await checkRateLimit(`wizard:ip:${await clientIp()}`, {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!rl.ok) {
    return {
      questions: fallbackQuestions(topic),
      topicCheck: fallbackTopicCheck(topic),
      adaptive: false,
    };
  }
  return getWizardQuestions({ topic, level, language });
}

/** IP del cliente (Vercel: x-forwarded-for). Solo para rate limiting. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "desconocida"
  );
}

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  if (/^9\d{8}$/.test(cleaned)) return `+56${cleaned}`;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export interface FunnelResult {
  ok: false;
  error: string;
  emailTaken?: boolean;
}

/**
 * El paso final del embudo: crea la cuenta (auto-confirmada), inicia sesión,
 * guarda el intent con su preview y manda al paywall. Devuelve {ok:false}
 * con mensaje accionable si algo del formulario no sirve (jamás explota).
 */
export async function createAccountAndIntentAction(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  /** Plan elegido en la landing: viaja hasta el paywall (Pro destacado). */
  plan?: "pro";
  topic: string;
  goal: string;
  level: string;
  language: string;
  priorExperience?: string;
  weeklyHours?: number;
  /** Arquetipo de la meta elegida (catálogo cerrado; se valida igual). */
  goalArchetype?: string | null;
  /** Slug del medio/equipo elegido (celular, excel…); se sanea a slug. */
  variant?: string | null;
  /** Respuestas estructuradas del wizard (se validan con zod; si no calzan,
   *  se persisten vacías — la analítica nunca bloquea una venta). */
  wizardAnswers?: unknown;
}): Promise<FunnelResult> {
  // --- Validaciones (errores legibles, el cliente los muestra inline) ---
  const name = String(input.name ?? "").trim().slice(0, 80);
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "Revisa tu correo: no parece válido." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Tu contraseña necesita al menos 8 caracteres." };
  }
  const phone = normalizePhone(String(input.phone ?? ""));
  if (!phone) {
    return { ok: false, error: "Revisa tu WhatsApp: 8 a 15 dígitos (ej: +56 9 1234 5678)." };
  }
  const parsed = intakeSchema.safeParse({
    topic: String(input.topic ?? "").trim(),
    goal: String(input.goal ?? "").trim(),
    level: input.level,
    priorExperience: input.priorExperience || undefined,
    weeklyHours: input.weeklyHours || undefined,
    language: input.language || "es",
  });
  if (!parsed.success) {
    return { ok: false, error: "Algo del formulario quedó incompleto. Revisa el tema y tu meta." };
  }
  const intake = parsed.data;

  // --- Gate de viabilidad del tema, ANTES de crear la cuenta ---
  // Re-derivado en servidor desde wizard_questions_cache (el cliente no manda
  // el veredicto: sería bypasseable desde DevTools). Hoy sin esto se puede
  // pagar por una ruta que Opus va a rehusar → failed con dinero cobrado.
  const topicCheck = await findTopicCheckForIntent({
    topic: intake.topic,
    level: intake.level,
    language: intake.language,
  });
  if (topicCheck && ["inseguro", "inviable"].includes(topicCheck.verdict)) {
    return {
      ok: false,
      error:
        topicCheck.note ??
        "Ese tema no lo podemos convertir en una ruta. Prueba reformularlo con otras palabras.",
    };
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

  // Anti-abuso de cuentas (3/día por IP, fail-open): un bot fabricaba cuentas
  // Supabase ilimitadas desde la landing. El mensaje deja la puerta abierta al
  // caso legítimo (red compartida / ya tiene cuenta → login).
  const accountLimit = await checkRateLimit(`cuentas:ip:${await clientIp()}`, {
    limit: 3,
    windowSeconds: 86_400,
  });
  if (!accountLimit.ok) {
    return {
      ok: false,
      emailTaken: true,
      error:
        "Hemos recibido varias cuentas desde tu conexión hoy. Si ya tienes una, inicia sesión; si no, inténtalo más tarde.",
    };
  }

  // --- Cuenta auto-confirmada (cero fricción entre el comprador y el pago) ---
  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || undefined, preferred_language: intake.language },
  });

  const supabase = await createClient();
  if (createErr) {
    const exists =
      createErr.message.toLowerCase().includes("already") ||
      createErr.code === "email_exists";
    if (!exists) {
      console.error("[funnel] createUser:", createErr);
      return { ok: false, error: "No pudimos crear tu cuenta. Intenta de nuevo." };
    }
    // Ya tiene cuenta: si la contraseña calza, seguimos sin fricción.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      return {
        ok: false,
        emailTaken: true,
        error: "Ya existe una cuenta con este correo. Inicia sesión para continuar.",
      };
    }
  } else {
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      console.error("[funnel] signIn post-create:", signInErr);
      return { ok: false, error: "Cuenta creada, pero no pudimos iniciar sesión. Entra en /login." };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No pudimos iniciar tu sesión. Intenta de nuevo." };
  void created;

  // Perfil: nombre + WhatsApp (remarketing y profesor que te llama por tu nombre).
  await db
    .update(profiles)
    .set({
      phone,
      ...(name ? { fullName: name } : {}),
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, user.id));

  // --- Intent (el preview del paywall NO se genera aquí: pagar/page.tsx lo
  // hace perezoso e idempotente leyendo primero el canon de skeleton_cache.
  // Generarlo acá sumaba +1-2 s de Haiku al clic más frágil del embudo, y
  // corría incluso con paywall apagado). ---
  const [me] = await db
    .select({ isAdmin: profiles.isAdmin })
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
      priorExperience: intake.priorExperience ?? null,
      weeklyHours: intake.weeklyHours ?? null,
      phone,
      status: paywallOn ? "pending_payment" : "bypassed",
      amountClp: paywallOn ? env.PRICE_ROUTE_CLP : null,
      // Contrato del caché (Opción A): el topic canónico es la base del
      // cacheKey (Track A lo lee); el arquetipo y las respuestas discretas
      // alimentan overlay/analítica sin tocar la key.
      canonicalTopic,
      goalArchetype,
      wizardAnswers,
    })
    .returning({ id: routeIntents.id });
  if (!intent) return { ok: false, error: "No pudimos guardar tu ruta. Intenta de nuevo." };

  if (paywallOn) redirect(`/app/pagar/${intent.id}${input.plan === "pro" ? "?plan=pro" : ""}`);

  // Paywall apagado → flujo free de siempre (techo de costos intacto).
  if (!isPro) {
    const [[createdPaths], [completed]] = await Promise.all([
      db.select({ n: count() }).from(learningPaths).where(eq(learningPaths.userId, user.id)),
      db
        .select({ n: count() })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, user.id), eq(xpEvents.source, "path_completed"))),
    ]);
    if (Number(createdPaths?.n ?? 0) >= FREE_PATH_LIMIT + Number(completed?.n ?? 0)) {
      redirect("/app/planes?motivo=limite-rutas");
    }
  }
  const path = await createPathRecord({ userId: user.id, intake });
  await db
    .update(routeIntents)
    .set({ pathId: path.id, updatedAt: new Date() })
    .where(eq(routeIntents.id, intent.id));
  redirect(`/app/rutas/${path.id}`);
}
