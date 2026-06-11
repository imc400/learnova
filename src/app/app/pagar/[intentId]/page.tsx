import { notFound, redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  Sparkles,
  CheckCircle2,
  PlayCircle,
  GraduationCap,
  Mail,
  ShieldCheck,
  Lock,
  Mic,
  ArrowRight,
  Map,
  Library,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents, skeletonCache } from "@/db/schema";
import { startIntentCheckoutAction } from "@/server/actions/checkout";
import { subscribeProAction } from "@/server/actions/subscription";
import { generateRoutePreview } from "@/lib/ai/wizard";
import { PROMPT_VERSION } from "@/lib/ai/prompts";
import { skeletonCacheKeyCandidates } from "@/lib/generation/run";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import { SkeletonCuaderno } from "@/components/app/brand/skeleton-cuaderno";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { PaywallTracker, TrackCheckout } from "@/components/analytics/paywall-tracker";
import { Seal } from "@/components/marketing/landing/icons";
import { providerLabel } from "@/lib/payments/provider";
import { formatPrice } from "@/lib/utils";
import { env } from "@/lib/env";

export const metadata = { title: "Tu ruta te espera" };
export const dynamic = "force-dynamic";

export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ error?: string; plan?: string }>;
}) {
  const { intentId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [intent] = await db
    .select()
    .from(routeIntents)
    .where(and(eq(routeIntents.id, intentId), eq(routeIntents.userId, user.id)))
    .limit(1);
  if (!intent) notFound();
  if (intent.pathId) redirect(`/app/rutas/${intent.pathId}`);
  if (intent.status !== "pending_payment" && intent.status !== "failed") {
    redirect("/app/crear");
  }

  // Preview perezoso. PRIMERO la verdad: si el esqueleto canónico ya existe
  // en skeleton_cache (misma derivación de key que run.ts:73), el temario
  // mostrado es EXACTAMENTE el que recibirá tras pagar — la promesa "ves tu
  // temario antes de pagar" deja de depender de un Haiku que puede divergir.
  // Haiku queda solo para el gancho (y como fallback sin canon), con timeout
  // y .catch(() => null): el SSR jamás se cuelga ni cae a 500.
  // Persistencia CONDICIONAL (where preview is null): cargas concurrentes
  // no se pisan y el costo queda acotado (solo el dueño autenticado llega).
  let preview = intent.preview;
  if (!preview?.modules?.length) {
    // Candidatas de key, de la más específica a la legacy — la MISMA lista y
    // precedencia que usa el pipeline (skeletonCacheKeyCandidates, run.ts):
    // canónica+variant (formato final de Track A), canónica a secas, slug
    // normalizado (cuando el intent no trae canonical_topic, p.ej. el flujo
    // "siguiente ruta") y la derivación cruda histórica (con la que se
    // escribió el canon pre-existente, p.ej. el de la demo pre-calentada).
    // La primera que exista en skeleton_cache gana → el temario mostrado es
    // EXACTAMENTE el que el pipeline servirá tras pagar.
    const wa = intent.wizardAnswers as { variant?: string | null } | null;
    const variant = typeof wa?.variant === "string" && wa.variant ? wa.variant : null;
    const keyCandidates = skeletonCacheKeyCandidates({
      topic: intent.topic,
      canonicalTopic: intent.canonicalTopic,
      variant,
      level: intent.level,
      language: intent.language,
    });
    const canonRows = await db
      .select({ cacheKey: skeletonCache.cacheKey, skeleton: skeletonCache.skeleton })
      .from(skeletonCache)
      .where(
        and(
          inArray(skeletonCache.cacheKey, keyCandidates),
          // Misma versión que escribe/lee el pipeline: un bump de
          // PROMPT_VERSION jamás puede dejar al paywall mostrando canon viejo.
          eq(skeletonCache.version, PROMPT_VERSION),
        ),
      );
    const canon = keyCandidates
      .map((k) => canonRows.find((r) => r.cacheKey === k))
      .find(Boolean);
    const canonModules = (
      canon?.skeleton as { modules?: Array<{ title?: string }> } | undefined
    )?.modules
      ?.map((m) => m.title ?? "")
      .filter(Boolean)
      .slice(0, 7);

    const fresh = await Promise.race([
      generateRoutePreview({
        topic: intent.topic,
        level: intent.level,
        goal: intent.goal,
        language: intent.language,
        priorExperience: intent.priorExperience,
      }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 4500)),
    ]);

    const modules = canonModules?.length ? canonModules : (fresh?.modules ?? []);
    if (modules.length) {
      const metaHead = intent.goal.split(".")[0] ?? "";
      preview = {
        modules,
        hook: fresh?.hook ?? "",
        metaDisplay:
          metaHead.length > 160 ? `${metaHead.slice(0, 159).trimEnd()}…` : metaHead,
      };
      await db
        .update(routeIntents)
        .set({ preview, updatedAt: new Date() })
        .where(and(eq(routeIntents.id, intent.id), sql`${routeIntents.preview} is null`));
    }
  }

  const amount = intent.amountClp ?? env.PRICE_ROUTE_CLP;
  const pro = env.PRICE_PRO_CLP;
  // PAT activo → suscripción real con cobro automático. Sin PAT → Pro MANUAL:
  // cobro único de 30 días, sin renovación automática (se avisa para renovar).
  const proAutomatico = env.PRO_SUBSCRIPTION_ENABLED === "true";
  // Venía de la landing con Pro elegido → su card llega destacada (no se le
  // hace elegir "a ciegas" dos veces; el clic de pago sigue siendo suyo).
  const eligioPro = sp.plan === "pro";
  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? null;

  // Punto A (dónde está hoy) → Punto B (dónde quiere llegar) — con SUS datos.
  // `||` (no `??`): un priorExperience vacío o de puros espacios cae al fallback.
  const puntoA =
    intent.priorExperience?.split(".")[0]?.slice(0, 110)?.trim() ||
    `Recién empezando en ${intent.topic.toLowerCase()}`;
  const puntoB = preview?.metaDisplay || intent.goal.split(".")[0] || intent.topic;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Meta: ViewContent + Lead (deduplicados por eventID y sesión). */}
      <PaywallTracker intentId={intent.id} amountClp={amount} />
      <div className="text-center">
        <Badge variant="primary" className="capitalize">{intent.level}</Badge>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {firstName ? `${firstName}, tu` : "Tu"} ruta ya está diseñada.{" "}
          <span className="ink-hl">Actívala</span>.
        </h1>
        {preview?.hook && (
          <p className="mt-2 text-muted-foreground">{preview.hook}</p>
        )}
      </div>

      {sp.error === "pago" && (
        <NotaBanner tone="error" titulo="No pudimos iniciar el pago" className="mt-4">
          No se hizo ningún cobro. Intenta de nuevo en unos segundos, o
          escríbenos a hola@aulia.ai y lo vemos contigo.
        </NotaBanner>
      )}
      {sp.error === "email" && (
        <NotaBanner tone="error" titulo="Tu correo no parece recibir mensajes" className="mt-4">
          ¿Quedó con un error de tipeo? No se hizo ningún cobro — el procesador
          de pagos verifica tu correo para enviarte el comprobante. Corrígelo
          en tu perfil o escríbenos a hola@aulia.ai.
        </NotaBanner>
      )}
      {intent.status === "failed" && (
        <NotaBanner tone="aviso" className="mt-4">
          Tu pago anterior no se concretó (nada se cobró). Tu ruta sigue
          reservada — puedes intentarlo de nuevo.
        </NotaBanner>
      )}

      {/* PUNTO A → PUNTO B: el viaje, con sus propias palabras */}
      <div className="mt-6 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl border border-border bg-muted/50 p-4">
          <p className="hand text-base">hoy ↓</p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{puntoA}</p>
        </div>
        <div className="hidden items-center sm:flex">
          <ArrowRight className="size-6 text-primary" />
        </div>
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <p className="hand text-base">al terminar tu ruta ↓</p>
          <p className="mt-1 text-sm font-semibold">{puntoB}</p>
        </div>
      </div>

      {/* EL TEMARIO REAL, bloqueado. Si aún no está escrito, se dice y se
          re-consulta solo (la promesa "ves tu temario antes de pagar" no se
          rompe en silencio). */}
      {preview?.modules?.length ? (
        <div className="ruled mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="hand text-base">tu temario ↓</p>
            <span className="tab-note">hecha para ti ✺</span>
          </div>
          <ol className="mt-2 space-y-1.5">
            {preview.modules.map((m, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{m}</span>
                <Lock className="size-3.5 shrink-0 text-muted-foreground" />
              </li>
            ))}
            <li className="flex items-center gap-2.5 text-sm">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-highlight text-[11px]">
                <Mic className="size-3" />
              </span>
              <span className="min-w-0 flex-1 font-medium">
                Clases en vivo por voz con tu profesor IA
              </span>
              <Lock className="size-3.5 shrink-0 text-muted-foreground" />
            </li>
          </ol>
        </div>
      ) : (
        <div className="mt-4">
          <SkeletonCuaderno lineas={4} />
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Tu temario se está escribiendo — se actualiza en unos segundos.
          </p>
          <AutoRefresh
            seconds={5}
            maxAttempts={15}
            fallback={
              <NotaBanner tone="aviso" className="mt-3">
                Esto está tardando más de lo normal. Tu ruta sigue reservada —
                escríbenos a hola@aulia.ai y te mandamos el temario al tiro.
              </NotaBanner>
            }
          />
        </div>
      )}

      {/* LAS DOS OFERTAS */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Solo esta ruta */}
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
          <p className="font-display font-semibold">Solo esta ruta</p>
          <p className="mt-3 font-display text-3xl font-bold">
            {formatPrice(amount, "CLP")}
            <span className="ml-1.5 text-xs font-semibold text-muted-foreground">
              una vez
            </span>
          </p>
          <ul className="mt-4 flex-1 space-y-2 text-sm">
            {[
              { icon: PlayCircle, t: "Los mejores videos, con minutos clave marcados" },
              { icon: CheckCircle2, t: "Quizzes + XP, racha y logros" },
              { icon: GraduationCap, t: "Tu profesor: bienvenida + clases en vivo" },
              { icon: Mail, t: "Tareas y avances a tu correo" },
            ].map((it, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <it.icon className="mt-0.5 size-4 shrink-0 text-primary" /> {it.t}
              </li>
            ))}
          </ul>
          <TrackCheckout intentId={intent.id} amountClp={amount} plan="ruta">
            <form action={startIntentCheckoutAction.bind(null, intent.id)} className="mt-4">
              <SubmitButton
                size="lg"
                className="w-full"
                variant="outline"
                pendingText="Conectando…"
              >
                <ShieldCheck className="size-4" /> Desbloquear mi ruta
              </SubmitButton>
            </form>
          </TrackCheckout>
        </div>

        {/* Pro — recomendado (o "tu elección" si vino de la landing con Pro) */}
        <div
          className={`relative flex flex-col rounded-2xl border-2 border-primary bg-card p-5 shadow-lift ${
            eligioPro ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
          }`}
        >
          <span className="tab-note absolute -top-4 left-4">
            {eligioPro ? "tu elección ✺" : "recomendado ✺"}
          </span>
          <p className="font-display font-semibold">Aulia Pro</p>
          <p className="mt-3 font-display text-3xl font-bold text-primary">
            {formatPrice(pro, "CLP")}
            <span className="ml-1.5 text-xs font-semibold text-muted-foreground">
              {/* WARNING: NO activar PRO_SUBSCRIPTION_ENABLED sin contrato PAT
                  firmado (task #45); el copy "/ mes" está PROHIBIDO en modo
                  manual (Pro = 30 días, sin renovación automática). */}
              {proAutomatico ? "/ mes" : "por 30 días"}
            </span>
          </p>
          <ul className="mt-4 flex-1 space-y-2 text-sm">
            <li className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Esta ruta ({formatPrice(amount, "CLP")}) queda{" "}
                <span className="ink-hl">incluida</span> hoy — todo lo demás del
                mes te sale {formatPrice(pro - amount, "CLP")}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Map className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{env.PRO_ROUTES_PER_MONTH} rutas nuevas a tu medida cada mes</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Mic className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>120 minutos al mes de clases en vivo, con todos tus profesores</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Library className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>Tus rutas se encadenan en Caminos</span>
            </li>
          </ul>
          <TrackCheckout intentId={intent.id} amountClp={pro} plan="pro">
            <form action={subscribeProAction.bind(null, intent.id)} className="mt-4">
              <SubmitButton size="lg" className="w-full" pendingText="Conectando…">
                <Sparkles className="size-4" /> Empezar con Pro
              </SubmitButton>
            </form>
          </TrackCheckout>
          {!proAutomatico && (
            <p className="mt-2 text-center text-[11px] font-medium text-muted-foreground">
              Sin cobro automático: pagas 30 días y te avisamos para renovar.
            </p>
          )}
        </div>
      </div>

      {/* Banda de garantía — patrón precios.tsx, zona sobria */}
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-card p-5 shadow-soft">
        <Seal size={16} className="mt-0.5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          Garantía simple: si en 7 días no es para ti, escribes a{" "}
          <a
            href="mailto:hola@aulia.ai"
            className="font-medium text-foreground hover:underline"
          >
            hola@aulia.ai
          </a>{" "}
          y te devolvemos el 100%.
        </p>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Pago seguro vía {providerLabel()}. Tu ruta se empieza a generar apenas
        se confirma — y tu profesor te estará esperando.
      </p>

      {/* Sin link de fuga en el momento de decisión: navegar a /app/crear aquí
          generaba intents duplicados que ensucian la recuperación de carros. */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        ¿Otro tema en mente? Primero activa esta ruta — crear la siguiente toma
        2 minutos.
      </p>
    </div>
  );
}
