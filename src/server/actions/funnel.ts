"use server";

import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { learningPaths, profiles, routeIntents, xpEvents } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { intakeSchema } from "@/lib/ai/schemas";
import {
  generateWizardQuestions,
  fallbackQuestions,
  generateRoutePreview,
  type WizardQuestion,
} from "@/lib/ai/wizard";
import { createPathRecord } from "@/lib/paths/create";
import { getEntitlement, FREE_PATH_LIMIT } from "@/lib/subscription";
import { env } from "@/lib/env";

/*
  EMBUDO DE VENTA (wizard-first, sin cuenta previa):
  /empieza → arma tu ruta (anónimo) → preguntas IA → email+WhatsApp+contraseña
  → se crea la cuenta AUTO-CONFIRMADA + el intent + el preview → paywall.
  Si paga: ruta. Si no: tenemos tema + correo + WhatsApp = carro abandonado.
*/

/** Preguntas del wizard SIN auth (landing de ads). */
export async function publicWizardQuestionsAction(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<{ questions: WizardQuestion[]; adaptive: boolean }> {
  const topic = String(args.topic ?? "").trim().slice(0, 120);
  const level = ["principiante", "intermedio", "avanzado"].includes(args.level)
    ? args.level
    : "principiante";
  const language = ["es", "en", "pt"].includes(args.language) ? args.language : "es";
  if (topic.length < 2) {
    return { questions: fallbackQuestions(topic || "este tema"), adaptive: false };
  }
  return generateWizardQuestions({ topic, level, language });
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
  topic: string;
  goal: string;
  metaDisplay: string;
  level: string;
  language: string;
  priorExperience?: string;
  weeklyHours?: number;
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

  // --- Intent + preview (el FOMO honesto del paywall) ---
  const [me] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const { isPro } = await getEntitlement(user.id);
  const paywallOn = env.PAYWALL_ENABLED === "true" && !isPro && !me?.isAdmin;

  const preview = await generateRoutePreview({
    topic: intake.topic,
    level: intake.level,
    goal: intake.goal,
    language: intake.language,
  });

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
      preview: preview
        ? {
            modules: preview.modules,
            hook: preview.hook,
            metaDisplay: String(input.metaDisplay ?? "").slice(0, 160),
          }
        : null,
    })
    .returning({ id: routeIntents.id });
  if (!intent) return { ok: false, error: "No pudimos guardar tu ruta. Intenta de nuevo." };

  if (paywallOn) redirect(`/app/pagar/${intent.id}`);

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
