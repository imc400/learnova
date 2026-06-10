import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente ADMIN (service role) — solo servidor. Lo usa el embudo de venta
 * para crear cuentas auto-confirmadas (sin fricción de correo de
 * confirmación entre el comprador y el paywall).
 */
export function createAdminClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
