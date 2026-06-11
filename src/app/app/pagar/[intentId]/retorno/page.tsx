import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { reconcileIntentWithProvider } from "@/lib/ops/reconcile";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import { CelebracionStickers } from "@/components/app/brand/celebracion-stickers";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Confirmando tu pago" };
// El estado cambia vía webhook: esta página SIEMPRE consulta fresco.
export const dynamic = "force-dynamic";

/** Tope del polling: ~15 intentos; después, banner de calma (nunca sugerir re-pagar). */
function DemoraBanner() {
  return (
    <NotaBanner tone="aviso" className="mt-6 text-left">
      Esto está tardando más de lo normal — tu pago está a salvo. Escríbenos a{" "}
      <a href="mailto:hola@aulia.ai" className="font-medium text-foreground hover:underline">
        hola@aulia.ai
      </a>{" "}
      y lo activamos al tiro.
    </NotaBanner>
  );
}

/**
 * Retorno desde Flow. El webhook (server-to-server) es quien confirma y crea
 * la ruta; aquí miramos el estado y refrescamos hasta verlo — Y, si el intent
 * sigue pendiente (webhook perdido), preguntamos ACTIVAMENTE al proveedor
 * (E-P1.4): el usuario volviendo del checkout es la señal más fuerte posible
 * de "probablemente pagó". Throttle de 30 s vía updatedAt para no consultar
 * al proveedor en cada tick del polling de la página.
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

  let [intent] = await db
    .select({
      status: routeIntents.status,
      pathId: routeIntents.pathId,
      updatedAt: routeIntents.updatedAt,
    })
    .from(routeIntents)
    .where(and(eq(routeIntents.id, intentId), eq(routeIntents.userId, user.id)))
    .limit(1);
  if (!intent) notFound();

  if (
    intent.status === "pending_payment" &&
    Date.now() - intent.updatedAt.getTime() > 30_000
  ) {
    // Marca el intento ANTES de consultar (throttle aunque el proveedor cuelgue).
    await db
      .update(routeIntents)
      .set({ updatedAt: new Date() })
      .where(eq(routeIntents.id, intentId))
      .catch(() => {});
    const resultado = await reconcileIntentWithProvider(intentId).catch(
      () => "unknown" as const,
    );
    if (resultado === "paid") {
      // confirmIntentPaid ya creó la ruta y encoló la generación: releer.
      const [fresh] = await db
        .select({
          status: routeIntents.status,
          pathId: routeIntents.pathId,
          updatedAt: routeIntents.updatedAt,
        })
        .from(routeIntents)
        .where(eq(routeIntents.id, intentId))
        .limit(1);
      if (fresh) intent = fresh;
    }
  }

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
        <AutoRefresh seconds={4} maxAttempts={15} fallback={<DemoraBanner />} />
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
        <p className="mt-2 text-sm text-muted-foreground">
          Tu temario aparece al tiro; las lecciones se escriben solas y te
          avisamos al correo.
        </p>
        <CelebracionStickers
          animar
          className="justify-center"
          stickers={[{ contenido: <>Pago confirmado</> }]}
        />
        <AutoRefresh seconds={3} maxAttempts={15} fallback={<DemoraBanner />} />
      </div>
    );
  }

  if (intent.status === "failed") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          El pago no se concretó
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Fue rechazado o anulado — nada se cobró. Tu ruta sigue reservada.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/app/pagar/${intentId}`}>Reintentar el pago</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-destructive" />
      <p className="mt-4 text-sm text-muted-foreground">
        Este enlace ya no está activo.{" "}
        <Link href="/app/crear" className="font-medium text-primary hover:underline">
          Crear una ruta
        </Link>
      </p>
    </div>
  );
}
