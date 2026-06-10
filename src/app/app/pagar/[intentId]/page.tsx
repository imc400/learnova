import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  Sparkles,
  CheckCircle2,
  PlayCircle,
  GraduationCap,
  Mail,
  ShieldCheck,
  Lock,
  Mic,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { startIntentCheckoutAction } from "@/server/actions/checkout";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";

export const metadata = { title: "Tu ruta te espera" };

const INCLUDES = [
  { icon: PlayCircle, text: "El mejor video de internet para cada lección, con los minutos clave marcados" },
  { icon: CheckCircle2, text: "Quizzes que confirman tu dominio + XP, racha y logros" },
  { icon: GraduationCap, text: "Tu profesor IA particular: clase de bienvenida + clases en vivo por voz" },
  { icon: Mail, text: "Resúmenes, tareas y avances a tu correo y WhatsApp" },
];

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

  const amount = intent.amountClp ?? env.PRICE_ROUTE_CLP;
  const preview = intent.preview;
  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="text-center">
        <Badge variant="primary" className="capitalize">{intent.level}</Badge>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
          {firstName ? `${firstName}, tu` : "Tu"} ruta ya está diseñada.{" "}
          <span className="ink-hl">Actívala</span>.
        </h1>
        {preview?.hook ? (
          <p className="mt-2 text-muted-foreground">{preview.hook}</p>
        ) : (
          <p className="mt-2 text-muted-foreground">
            Diseñada exclusivamente para tu meta — nadie más tiene esta ruta.
          </p>
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

      <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-lg font-semibold capitalize">{intent.topic}</p>
          <span className="tab-note shrink-0">hecha para ti ✺</span>
        </div>
        {preview?.metaDisplay && (
          <p className="mt-1 text-sm text-muted-foreground">
            Tu meta: <span className="font-medium text-foreground">{preview.metaDisplay}</span>
          </p>
        )}

        {/* EL FOMO REAL: el índice de SU ruta, bloqueado */}
        {preview?.modules?.length ? (
          <div className="ruled mt-4 rounded-xl border border-border bg-background p-4">
            <p className="hand text-base">tu temario ↓</p>
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
                  Clases en vivo con tu profesor IA
                </span>
                <Lock className="size-3.5 shrink-0 text-muted-foreground" />
              </li>
            </ol>
          </div>
        ) : null}

        <ul className="mt-4 space-y-2.5">
          {INCLUDES.map((it, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <it.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              {it.text}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">
            Pago único · tuya para siempre
          </span>
          <span className="font-display text-3xl font-bold text-primary">
            ${amount.toLocaleString("es-CL")}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">CLP</span>
          </span>
        </div>

        <form action={startIntentCheckoutAction.bind(null, intent.id)} className="mt-4">
          <SubmitButton size="lg" className="w-full" pendingText="Conectando con el pago…">
            <ShieldCheck className="size-4" /> Desbloquear mi ruta
          </SubmitButton>
        </form>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Pago seguro vía {env.MP_ACCESS_TOKEN ? "Mercado Pago" : "Flow"}{" "}
          (tarjetas, débito). Tu ruta se empieza a generar apenas se confirma —
          y tu profesor te estará esperando.
        </p>
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Tu ruta queda guardada con tu cuenta. ¿Otro tema?{" "}
        <Link href="/app/crear" className="font-medium text-primary hover:underline">
          Crear otra ruta
        </Link>
      </p>
    </div>
  );
}
