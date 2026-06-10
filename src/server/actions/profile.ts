"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";

/** Datos personales del perfil: nombre + WhatsApp (E.164 relajado). */
export async function updatePersonalDataAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 80);
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const cleaned = phoneRaw.replace(/[\s().-]/g, "");
  let phone: string | null = null;
  if (cleaned) {
    if (!/^\+?\d{8,15}$/.test(cleaned)) redirect("/app/perfil?error=telefono");
    phone = /^9\d{8}$/.test(cleaned)
      ? `+56${cleaned}`
      : cleaned.startsWith("+")
        ? cleaned
        : `+${cleaned}`;
  }

  await db
    .update(profiles)
    .set({
      ...(fullName ? { fullName } : {}),
      ...(phone ? { phone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, user.id));
  revalidatePath("/app/perfil");
  redirect("/app/perfil?ok=datos");
}

/**
 * Privacidad del leaderboard: visibilidad (opt-out de 1 clic) y alias público.
 * El alias reemplaza al nombre de pila en la comunidad (3-24 caracteres).
 */
export async function updateLeaderboardIdentityAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const visible = formData.get("visible") === "on";
  const rawAlias = String(formData.get("alias") ?? "").trim();
  // Sanitiza: letras/números/espacios/básicos, 3-24 chars; vacío = sin alias.
  const alias = rawAlias
    ? rawAlias.replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 24)
    : null;

  await db
    .update(profiles)
    .set({
      leaderboardVisible: visible,
      leaderboardAlias: alias && alias.length >= 3 ? alias : null,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, user.id));

  revalidatePath("/app/comunidad");
}
