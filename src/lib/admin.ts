import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { env } from "@/lib/env";

/** ¿Es admin? profiles.is_admin O su email está en env.ADMIN_EMAILS. */
export async function isAdminUser(): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const allowList = env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && allowList.includes(user.email.toLowerCase())) {
    return { userId: user.id };
  }
  const [me] = await db
    .select({ isAdmin: profiles.isAdmin })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  return me?.isAdmin ? { userId: user.id } : null;
}

/** Gate de páginas admin: no-admin → fuera (sin revelar que la ruta existe). */
export async function requireAdmin(): Promise<{ userId: string }> {
  const admin = await isAdminUser();
  if (!admin) redirect("/app");
  return admin;
}
