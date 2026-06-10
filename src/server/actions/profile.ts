"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";

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
