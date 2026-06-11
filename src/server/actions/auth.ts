"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
  Registro UNIFICADO con el funnel de ads (decisión de producto 2026-06-11):
  cuenta auto-confirmada vía admin client — cero fricción de "revisa tu
  correo". El correo se valida de facto con los emails de progreso/compra,
  y Flow verifica el buzón al pagar (con respaldo si falla).
*/

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().max(120).optional(),
  language: z.string().max(8).default("es"),
});

export async function signupAutoConfirmedAction(input: {
  email: string;
  password: string;
  fullName?: string;
  language?: string;
}): Promise<{ ok: boolean; error?: string; emailTaken?: boolean }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Revisa tu correo y que la contraseña tenga al menos 8 caracteres." };
  }
  const { email, password, fullName, language } = parsed.data;

  const admin = createAdminClient();
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || undefined, preferred_language: language },
  });

  const supabase = await createClient();
  if (createErr) {
    const exists =
      createErr.message.toLowerCase().includes("already") ||
      createErr.code === "email_exists";
    if (!exists) {
      console.error("[auth] createUser:", createErr);
      return { ok: false, error: "No pudimos crear tu cuenta. Intenta de nuevo." };
    }
    // Ya tiene cuenta: si la contraseña calza, entra sin fricción.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      return {
        ok: false,
        emailTaken: true,
        error: "Ya existe una cuenta con este correo. Inicia sesión para continuar.",
      };
    }
    return { ok: true };
  }

  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    console.error("[auth] signIn post-create:", signInErr);
    return { ok: false, error: "Cuenta creada, pero no pudimos iniciar sesión. Entra en /login." };
  }
  return { ok: true };
}
