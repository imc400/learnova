import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  User,
  CreditCard,
  Receipt,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles, subscriptions, pathPurchases, learningPaths } from "@/db/schema";
import { updatePersonalDataAction } from "@/server/actions/profile";
import { cancelProAction, subscribeProAction } from "@/server/actions/subscription";
import { SubmitButton } from "@/components/app/submit-button";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import { env } from "@/lib/env";

export const metadata = { title: "Mi perfil" };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  // Formato es-CL corto de marca: "10 jun 2026".
  return new Date(d)
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" })
    .replace(/\.,?/g, "")
    .replace(" de ", " ");
}

/* Estado real de cada cobro — pending/failed/refunded jamás se pintan
   como exitosos. Compuesto sobre Badge vía className (API congelada). */
type PurchaseStatusCfg = {
  label: string;
  icon: LucideIcon;
  iconCls: string;
  badgeCls: string;
};
const PURCHASE_STATUS: Partial<Record<string, PurchaseStatusCfg>> & {
  pending: PurchaseStatusCfg;
} = {
  paid: {
    label: "Pagada",
    icon: CheckCircle2,
    iconCls: "text-primary",
    badgeCls: "bg-primary/10 text-primary",
  },
  pending: {
    label: "En proceso",
    icon: Clock,
    iconCls: "text-muted-foreground",
    badgeCls: "bg-muted text-muted-foreground",
  },
  failed: {
    label: "No se cobró",
    icon: AlertCircle,
    iconCls: "text-destructive",
    badgeCls: "bg-destructive/10 text-destructive",
  },
  refunded: {
    label: "Reembolsada",
    icon: RotateCcw,
    iconCls: "text-muted-foreground",
    badgeCls: "border border-border bg-card text-muted-foreground",
  },
};

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
        kind: pathPurchases.kind,
        pathTitle: learningPaths.title,
      })
      .from(pathPurchases)
      .leftJoin(learningPaths, eq(learningPaths.id, pathPurchases.pathId))
      .where(eq(pathPurchases.userId, user.id))
      .orderBy(desc(pathPurchases.createdAt))
      .limit(20),
  ]);

  // Vigencia REAL (mismo criterio que getEntitlement, sin la gracia de
  // reintentos): manual vencido = volver a ofrecer Pro, no fingir actividad.
  const enPeriodo =
    !sub?.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now();
  const isPro = sub?.plan === "pro" && sub.status === "active" && enPeriodo;
  // Pro manual: cobro único de 30 días, sin suscripción en Flow (sin PAT).
  const esManual = isPro && !sub?.providerSubscriptionId;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header SIN tab-note: el único de la pantalla vive en la card
          "Tu plan" (excepción justificada — es el sello de la promesa). */}
      <header className="mb-2">
        <h1 className="font-display text-3xl text-balance sm:text-4xl">Mi perfil</h1>
        <p className="mt-2 max-w-[58ch] text-muted-foreground">
          Tus datos, tu plan y tus compras — todo en un lugar.
        </p>
      </header>

      {sp.ok === "datos" && (
        <NotaBanner tone="exito" className="mt-4">
          Datos guardados.
        </NotaBanner>
      )}
      {sp.error === "telefono" && (
        <NotaBanner tone="error" titulo="Ese WhatsApp no calza" className="mt-4">
          No guardamos el cambio. Usa 8 a 15 dígitos (ej: +56 9 1234 5678) y
          vuelve a intentar.
        </NotaBanner>
      )}
      {sp.ok === "pro" && (
        <NotaBanner tone="exito" titulo="Tu Pro está activo por 30 días" className="mt-4">
          Sin cobro automático: te avisamos para renovar.
        </NotaBanner>
      )}
      {sp.ok === "cancelada" && (
        <NotaBanner tone="aviso" className="mt-4">
          Cancelaste la renovación — conservas Pro hasta el fin del período
          pagado. Te esperamos de vuelta.
        </NotaBanner>
      )}
      {sp.error === "cancelacion" && (
        <NotaBanner tone="error" titulo="No pudimos cancelar" className="mt-4">
          Tu plan sigue igual, no cambió nada. Escríbenos a{" "}
          <a href="mailto:hola@aulia.ai" className="font-medium text-foreground hover:underline">
            hola@aulia.ai
          </a>{" "}
          y lo resolvemos al tiro.
        </NotaBanner>
      )}

      {/* Datos personales — zona de sobriedad: cero gestos. */}
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

      {/* Tu plan — el tab-note de la esquina es el sello de la promesa
          (frase idéntica a precios.tsx) y el ÚNICO de la pantalla. */}
      <section className="relative mt-8 rounded-xl border border-border bg-card p-5">
        {/* Oculto en la rama de suscripción automática (PRO_SUBSCRIPTION_ENABLED,
            task #45): ahí el claim dejaría de ser cierto. */}
        {(!isPro || esManual) && (
          <span className="absolute -top-4 right-5 rotate-[2deg]">
            <span className="tab-note">sin cobro automático ✺</span>
          </span>
        )}
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <CreditCard className="size-4 text-primary" /> Tu plan
        </h2>
        {isPro && esManual ? (
          <div className="mt-3">
            <Badge variant="primary">
              <Sparkles className="size-3.5" /> Aulia Pro
            </Badge>
            <p className="mt-2 text-sm text-muted-foreground">
              Pro activo hasta el {fmtDate(sub!.currentPeriodEnd)} · sin cobro
              automático — nadie te cobra sin que tú lo decidas.
            </p>
            <form action={subscribeProAction.bind(null, null)} className="mt-3">
              <SubmitButton size="sm" pendingText="Conectando con Flow…">
                <Sparkles className="size-4" /> Renovar 30 días más ·{" "}
                {formatPrice(env.PRICE_PRO_CLP, "CLP")}
              </SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-muted-foreground">
              La renovación se suma a tus días restantes — renovar antes no
              pierde nada.
            </p>
          </div>
        ) : isPro ? (
          /* Rama de suscripción automática — solo alcanzable con
             PRO_SUBSCRIPTION_ENABLED (contrato PAT pendiente, task #45). */
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <Badge variant="primary">
                <Sparkles className="size-3.5" /> Aulia Pro
              </Badge>
              <p className="mt-2 text-sm text-muted-foreground">
                Pro activo
                {sub?.currentPeriodEnd
                  ? ` · próximo cobro el ${fmtDate(sub.currentPeriodEnd)}`
                  : ""}
                {sub?.provider ? ` · vía ${sub.provider === "mercadopago" ? "Mercado Pago" : sub.provider === "flow" ? "Flow" : sub.provider}` : ""}
              </p>
              {sub?.cancelAtPeriodEnd ? (
                <p className="mt-1 text-xs font-medium text-accent-foreground">
                  Cancelación programada: conservas Pro hasta el{" "}
                  {fmtDate(sub.currentPeriodEnd)}.
                </p>
              ) : (
                <form action={cancelProAction} className="mt-3">
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    pendingText="Cancelando…"
                    className="text-muted-foreground"
                  >
                    Cancelar renovación
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm">
              Plan <span className="font-semibold">por ruta</span>: pagas una
              vez por cada ruta y es tuya para siempre.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/app/planes">
                <Sparkles className="size-4" /> Conocer Aulia Pro
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        )}
      </section>

      {/* Compras — cada cobro con su estado real. */}
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
            {purchases.map((p) => {
              const st = PURCHASE_STATUS[p.status] ?? PURCHASE_STATUS.pending;
              const Icono = st.icon;
              return (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <Icono className={`size-4 shrink-0 ${st.iconCls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.kind === "pro_month"
                        ? "Aulia Pro — 30 días"
                        : p.pathTitle ?? "Ruta de aprendizaje"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(p.createdAt)} ·{" "}
                      {p.provider === "mercadopago" ? "Mercado Pago" : p.provider === "flow" ? "Flow" : p.provider}
                    </p>
                  </div>
                  <Badge className={`shrink-0 ${st.badgeCls}`}>{st.label}</Badge>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatPrice(Number(p.amount), "CLP")}
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
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
