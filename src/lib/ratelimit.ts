import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/*
  Rate limiting compartido (E-P1.1): ventana FIJA en Postgres, sin Redis.
  Una sola query: INSERT … ON CONFLICT (key, window) DO UPDATE
  count = count + 1 RETURNING count. Sobrevive a cold starts de serverless
  (a diferencia del token bucket en memoria de /api/soporte).

  Consumidores: funnel público (wizard/cuentas por IP — Track B) y /api/tutor.

  Diseño:
  - Ventana fija: simple y suficiente para anti-abuso (el peor caso teórico es
    2x el límite en el borde de dos ventanas — irrelevante a estos volúmenes).
  - FAIL-OPEN: si la BD falla, se permite la request (un rate limiter caído
    jamás puede tumbar el embudo de pago). El error queda en consola.
*/

export interface RateLimitResult {
  ok: boolean;
  count: number;
  remaining: number;
}

/**
 * Consume 1 unidad del límite para `key` en la ventana actual.
 * @param key       p.ej. "wizard:ip:1.2.3.4" · "cuentas:ip:1.2.3.4" · "tutor:<userId>"
 * @param opts.limit         máximo de requests por ventana
 * @param opts.windowSeconds tamaño de la ventana en segundos
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  try {
    const windowMs = opts.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

    const [row] = await db
      .insert(rateLimits)
      .values({ key, window: windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.window],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    const count = row?.count ?? 1;

    // Limpieza oportunista (~2% de las llamadas): la tabla no crece sin techo.
    if (Math.random() < 0.02) {
      void db
        .delete(rateLimits)
        .where(sql`${rateLimits.window} < now() - interval '24 hours'`)
        .catch(() => {});
    }

    return { ok: count <= opts.limit, count, remaining: Math.max(0, opts.limit - count) };
  } catch (e) {
    // Fail-open: el limiter jamás bloquea el negocio por un error propio.
    console.error("[ratelimit] error (fail-open):", e);
    return { ok: true, count: 0, remaining: opts.limit };
  }
}
