import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";

export const metadata = { title: "Confirmando tu pago" };
// El estado cambia vía webhook: esta página SIEMPRE consulta fresco.
export const dynamic = "force-dynamic";

/**
 * Retorno desde Flow. El webhook (server-to-server) es quien confirma y crea
 * la ruta; aquí solo miramos el estado y refrescamos hasta verlo.
 */
export default async function RetornoPage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [intent] = await db
    .select({ status: routeIntents.status, pathId: routeIntents.pathId })
    .from(routeIntents)
    .where(and(eq(routeIntents.id, intentId), eq(routeIntents.userId, user.id)))
    .limit(1);
  if (!intent) notFound();

  if (intent.pathId) redirect(`/app/rutas/${intent.pathId}`);

  if (intent.status === "pending_payment") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          Confirmando tu pago…
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Flow nos confirma en segundos. Apenas llegue, tu ruta se empieza a
          generar sola — esta página se actualiza automáticamente.
        </p>
        {/* Polling simple sin JS custom: refresh cada 4 s */}
        <meta httpEquiv="refresh" content="4" />
        <p className="mt-6 text-xs text-muted-foreground">
          ¿No pagaste todavía?{" "}
          <Link href={`/app/pagar/${intentId}`} className="font-medium text-primary hover:underline">
            Volver al pago
          </Link>
        </p>
      </div>
    );
  }

  // paid sin pathId aún (webhook a mitad de camino) → refrescar también.
  if (intent.status === "paid") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-primary/30 bg-primary/5 p-8 text-center shadow-soft">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          ¡Pago confirmado! Preparando tu ruta…
        </h1>
        <meta httpEquiv="refresh" content="3" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-accent-foreground" />
      <p className="mt-4 text-sm text-muted-foreground">
        Este pago ya no está disponible.{" "}
        <Link href="/app/crear" className="font-medium text-primary hover:underline">
          Crear una ruta
        </Link>
      </p>
    </div>
  );
}
