import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
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
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { startIntentCheckoutAction } from "@/server/actions/checkout";
import { subscribeProAction } from "@/server/actions/subscription";
import { generateRoutePreview } from "@/lib/ai/wizard";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { providerLabel } from "@/lib/payments/provider";
import { env } from "@/lib/env";

export const metadata = { title: "Tu ruta te espera" };
export const dynamic = "force-dynamic";

export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ error?: string }>;
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

  // Preview perezoso: si el intent nació sin temario, se genera AQUÍ con
  // timeout (el SSR jamás se cuelga por Haiku) y se persiste con escritura
  // CONDICIONAL (where preview is null) — cargas concurrentes no se pisan
  // y el costo queda acotado (solo el dueño autenticado llega aquí).
  let preview = intent.preview;
  if (!preview?.modules?.length) {
    const fresh = await Promise.race([
      generateRoutePreview({
        topic: intent.topic,
        level: intent.level,
        goal: intent.goal,
        language: intent.language,
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 4500)),
    ]);
    if (fresh) {
      preview = {
        modules: fresh.modules,
        hook: fresh.hook,
        metaDisplay: intent.goal.split(".")[0]?.slice(0, 160) ?? "",
      };
      await db
        .update(routeIntents)
        .set({ preview, updatedAt: new Date() })
        .where(and(eq(routeIntents.id, intent.id), sql`${routeIntents.preview} is null`));
    }
  }

  const amount = intent.amountClp ?? env.PRICE_ROUTE_CLP;
  const pro = env.PRICE_PRO_CLP;
  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? null;

  // Punto A (dónde está hoy) → Punto B (dónde quiere llegar) — con SUS datos.
  const puntoA =
    intent.priorExperience?.split(".")[0]?.slice(0, 110) ??
    `Recién empezando en ${intent.topic.toLowerCase()}`;
  const puntoB = preview?.metaDisplay || intent.goal.split(".")[0] || intent.topic;

  return (
    <div className="mx-auto max-w-2xl">
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
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          No pudimos iniciar el pago. Intenta de nuevo en unos segundos.
        </p>
      )}
      {intent.status === "failed" && (
        <p className="mt-4 rounded-md bg-accent/20 px-4 py-2.5 text-center text-sm font-medium">
          Tu pago anterior no se concretó (nada se cobró). Tu ruta sigue
          reservada — puedes intentarlo de nuevo.
        </p>
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

      {/* EL TEMARIO REAL, bloqueado */}
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
      ) : null}

      {/* LAS DOS OFERTAS */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Solo esta ruta */}
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
          <p className="font-display font-semibold">Solo esta ruta</p>
          <p className="mt-3 font-display text-3xl font-bold">
            ${amount.toLocaleString("es-CL")}
            <span className="ml-1 text-xs font-semibold text-muted-foreground">
              CLP · una vez
            </span>
          </p>
          <ul className="mt-4 flex-1 space-y-2 text-sm">
            {[
              { icon: PlayCircle, t: "Los mejores videos, con minutos clave marcados" },
              { icon: CheckCircle2, t: "Quizzes + XP, racha y logros" },
              { icon: GraduationCap, t: "Tu profesor: bienvenida + clases en vivo" },
              { icon: Mail, t: "Tareas y avances a tu correo y WhatsApp" },
            ].map((it, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <it.icon className="mt-0.5 size-4 shrink-0 text-primary" /> {it.t}
              </li>
            ))}
          </ul>
          <form action={startIntentCheckoutAction.bind(null, intent.id)} className="mt-4">
            <SubmitButton size="lg" className="w-full" variant="outline" pendingText="Conectando…">
              <ShieldCheck className="size-4" /> Desbloquear mi ruta
            </SubmitButton>
          </form>
        </div>

        {/* Pro — Más elegido */}
        <div className="relative flex flex-col rounded-2xl border-2 border-primary bg-card p-5 shadow-lift">
          <span className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            🔥 Más elegido
          </span>
          <p className="font-display font-semibold">Aulia Pro</p>
          <p className="mt-3 font-display text-3xl font-bold text-primary">
            ${pro.toLocaleString("es-CL")}
            <span className="ml-1 text-xs font-semibold text-muted-foreground">
              CLP / mes
            </span>
          </p>
          <ul className="mt-4 flex-1 space-y-2 text-sm">
            {[
              { icon: Sparkles, t: "Esta ruta queda incluida HOY" },
              { icon: Map, t: `${env.PRO_ROUTES_PER_MONTH} rutas nuevas a tu medida cada mes` },
              { icon: Mic, t: "Clases en vivo extra todos los meses" },
              { icon: Library, t: "Catálogo de rutas ilimitado" },
              { icon: Zap, t: "Prioridad de generación" },
            ].map((it, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <it.icon className="mt-0.5 size-4 shrink-0 text-primary" /> {it.t}
              </li>
            ))}
          </ul>
          <form action={subscribeProAction} className="mt-4">
            <SubmitButton size="lg" className="w-full" pendingText="Conectando…">
              <Sparkles className="size-4" /> Empezar con Pro
            </SubmitButton>
          </form>
        </div>
      </div>

      <p className="mt-4 text-center text-sm font-medium">
        🛡️ Garantía simple: si en 7 días no es para ti, escríbenos a
        hola@aulia.ai y te devolvemos el 100%.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Pago seguro vía {providerLabel()}. Tu ruta se empieza a generar apenas
        se confirma — y tu profesor te estará esperando.
      </p>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        ¿Otro tema?{" "}
        <Link href="/app/crear" className="font-medium text-primary hover:underline">
          Crear otra ruta
        </Link>
      </p>
    </div>
  );
}
