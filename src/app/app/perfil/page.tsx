import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  User,
  CreditCard,
  Receipt,
  Sparkles,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles, subscriptions, pathPurchases, learningPaths } from "@/db/schema";
import { updatePersonalDataAction } from "@/server/actions/profile";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Mi perfil" };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [[me], [sub], purchases] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1),
    db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1),
    db
      .select({
        id: pathPurchases.id,
        amount: pathPurchases.amount,
        currency: pathPurchases.currency,
        provider: pathPurchases.provider,
        status: pathPurchases.status,
        createdAt: pathPurchases.createdAt,
        pathId: pathPurchases.pathId,
        pathTitle: learningPaths.title,
      })
      .from(pathPurchases)
      .leftJoin(learningPaths, eq(learningPaths.id, pathPurchases.pathId))
      .where(eq(pathPurchases.userId, user.id))
      .orderBy(desc(pathPurchases.createdAt))
      .limit(20),
  ]);

  const isPro = sub?.plan === "pro" && sub.status === "active";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-bold tracking-tight">Mi perfil</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tus datos, tu plan y tus compras — todo en un lugar.
      </p>

      {sp.ok === "datos" && (
        <p className="mt-4 rounded-md bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary">
          ✓ Datos guardados.
        </p>
      )}
      {sp.error === "telefono" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
          Revisa tu WhatsApp: 8 a 15 dígitos (ej: +56 9 1234 5678).
        </p>
      )}

      {/* Datos personales */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <User className="size-4 text-primary" /> Datos personales
        </h2>
        <form action={updatePersonalDataAction} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Nombre</Label>
              <Input id="fullName" name="fullName" defaultValue={me?.fullName ?? ""} placeholder="Tu nombre" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">WhatsApp</Label>
              <Input id="phone" name="phone" type="tel" defaultValue={me?.phone ?? ""} placeholder="+56 9 1234 5678" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Correo</Label>
            <Input value={user.email ?? ""} disabled className="opacity-70" />
            <p className="text-xs text-muted-foreground">
              Tu correo es tu acceso — para cambiarlo escríbenos a hola@aulia.ai.
            </p>
          </div>
          <div>
            <SubmitButton size="sm" pendingText="Guardando…">
              Guardar cambios
            </SubmitButton>
          </div>
        </form>
      </section>

      {/* Suscripción */}
      <section className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <CreditCard className="size-4 text-primary" /> Tu plan
        </h2>
        {isPro ? (
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <Badge variant="primary">
                <Sparkles className="size-3.5" /> Aulia Pro
              </Badge>
              <p className="mt-2 text-sm text-muted-foreground">
                Suscripción activa
                {sub?.currentPeriodEnd
                  ? ` · próximo cobro el ${fmtDate(sub.currentPeriodEnd)}`
                  : ""}
                {sub?.provider ? ` · vía ${sub.provider === "mercadopago" ? "Mercado Pago" : sub.provider === "flow" ? "Flow" : sub.provider}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Para cancelar o cambiar tu plan, escríbenos a hola@aulia.ai —
                lo gestionamos al instante.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm">
              Plan <span className="font-semibold">por ruta</span>: pagas una
              vez por cada ruta y es tuya para siempre.
            </p>
            <Link
              href="/app/planes"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              <Sparkles className="size-4" /> Conocer Aulia Pro
              <ChevronRight className="size-4" />
            </Link>
          </div>
        )}
      </section>

      {/* Compras */}
      <section className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Receipt className="size-4 text-primary" /> Tus compras
        </h2>
        {purchases.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Aún no tienes compras. Tu primera ruta te espera en{" "}
            <Link href="/app/crear" className="font-medium text-primary hover:underline">
              Crear ruta
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {purchases.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.pathTitle ?? "Ruta de aprendizaje"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(p.createdAt)} ·{" "}
                    {p.provider === "mercadopago" ? "Mercado Pago" : p.provider === "flow" ? "Flow" : p.provider}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  ${Number(p.amount).toLocaleString("es-CL")} {p.currency}
                </span>
                {p.pathId && (
                  <Link
                    href={`/app/rutas/${p.pathId}`}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    Ver ruta
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
