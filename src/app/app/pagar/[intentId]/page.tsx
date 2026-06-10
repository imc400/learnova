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
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { startIntentCheckoutAction } from "@/server/actions/checkout";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";

export const metadata = { title: "Comienza tu ruta" };

const INCLUDES = [
  { icon: Sparkles, text: "Currículum diseñado por IA exclusivamente para tu meta" },
  { icon: PlayCircle, text: "Videos curados con momentos clave marcados, lección por lección" },
  { icon: CheckCircle2, text: "Quizzes que confirman tu dominio + XP, racha y logros" },
  { icon: GraduationCap, text: "Profesor IA particular: inducción + clases en vivo por voz" },
  { icon: Mail, text: "Resúmenes, tareas y avances directo a tu correo" },
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

  return (
    <div className="mx-auto max-w-lg">
      <div className="text-center">
        <Badge variant="primary" className="capitalize">{intent.level}</Badge>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
          Tu ruta está diseñada. <span className="ink-hl">Actívala</span>.
        </h1>
        <p className="mt-2 text-muted-foreground">{intent.goal}</p>
      </div>

      {sp.error === "pago" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          No pudimos iniciar el pago. Intenta de nuevo en unos segundos.
        </p>
      )}
      {intent.status === "failed" && (
        <p className="mt-4 rounded-md bg-accent/20 px-4 py-2.5 text-center text-sm font-medium">
          Tu pago anterior no se concretó (rechazado o anulado). Puedes
          intentarlo de nuevo cuando quieras — tu ruta sigue reservada.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <p className="font-display text-lg font-semibold capitalize">{intent.topic}</p>
        <ul className="mt-4 space-y-3">
          {INCLUDES.map((it, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <it.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              {it.text}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">Pago único · acceso completo</span>
          <span className="font-display text-3xl font-bold text-primary">
            ${amount.toLocaleString("es-CL")}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">CLP</span>
          </span>
        </div>

        <form action={startIntentCheckoutAction.bind(null, intent.id)} className="mt-4">
          <SubmitButton size="lg" className="w-full" pendingText="Conectando con el pago…">
            <ShieldCheck className="size-4" /> Pagar y crear mi ruta
          </SubmitButton>
        </form>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Pago seguro vía {env.MP_ACCESS_TOKEN ? "Mercado Pago" : "Flow"}{" "}
          (tarjetas, débito). Tu ruta se empieza a generar apenas se confirma
          el pago.
        </p>
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        ¿Cambiaste de idea sobre el tema?{" "}
        <Link href="/app/crear" className="font-medium text-primary hover:underline">
          Crear otra ruta
        </Link>
      </p>
    </div>
  );
}
