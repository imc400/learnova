import { redirect } from "next/navigation";
import {
  Sparkles,
  Check,
  GraduationCap,
  Map,
  Zap,
  Library,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/subscription";
import { subscribeProAction } from "@/server/actions/subscription";
import { SubmitButton } from "@/components/app/submit-button";
import { env } from "@/lib/env";

export const metadata = { title: "Planes" };
export const dynamic = "force-dynamic";

export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; motivo?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { isPro } = await getEntitlement(user.id);
  if (isPro) redirect("/app/perfil");

  const pro = env.PRICE_PRO_CLP;
  const ruta = env.PRICE_ROUTE_CLP;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-center">
        <span className="tab-note">elige tu ritmo ✺</span>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">
          Aprende a <span className="ink-hl">tu</span> medida
        </h1>
        <p className="mt-2 text-muted-foreground">
          Una ruta a la vez, o todo Aulia con tu profesor cada semana.
        </p>
      </div>

      {sp.motivo === "limite-rutas" && (
        <p className="mt-4 rounded-md bg-accent/20 px-4 py-2.5 text-center text-sm font-medium">
          Completaste tu cupo de rutas — con Pro creas {env.PRO_ROUTES_PER_MONTH}{" "}
          rutas nuevas cada mes.
        </p>
      )}
      {sp.error === "tarjeta" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          No pudimos registrar tu tarjeta. Nada se cobró — intenta de nuevo.
        </p>
      )}
      {sp.error === "pago" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          Algo falló al iniciar la suscripción. Intenta de nuevo en unos segundos.
        </p>
      )}
      {sp.error === "cobro" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          Tu tarjeta quedó registrada pero el primer cobro fue rechazado (¿fondos
          o cupo?). Nada quedó activo — intenta con otra tarjeta.
        </p>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {/* Por ruta */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">Por ruta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pagas una vez. Tuya para siempre.
          </p>
          <p className="mt-4 font-display text-3xl font-bold">
            ${ruta.toLocaleString("es-CL")}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">
              CLP / ruta
            </span>
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              "Ruta completa diseñada para tu meta",
              "Videos curados + quizzes + XP",
              "Profesor IA: inducción + clases en vivo",
              "Resúmenes y tareas a tu correo",
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-muted-foreground">
            Se compra al crear cada ruta — no necesitas hacer nada aquí.
          </p>
        </div>

        {/* Pro */}
        <div className="relative rounded-2xl border-2 border-primary bg-card p-6 shadow-lift">
          <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            ⭐ Para los que van en serio
          </span>
          <h2 className="font-display text-lg font-semibold">Aulia Pro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu profesor particular, todos los meses.
          </p>
          <p className="mt-4 font-display text-3xl font-bold text-primary">
            ${pro.toLocaleString("es-CL")}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">
              CLP / mes
            </span>
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              { icon: Map, t: `${env.PRO_ROUTES_PER_MONTH} rutas nuevas a tu medida cada mes` },
              { icon: GraduationCap, t: "Clases en vivo con tu profesor cada semana" },
              { icon: Library, t: "Acceso ilimitado al catálogo de rutas" },
              { icon: Zap, t: "Prioridad de generación + funciones nuevas antes" },
            ].map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <f.icon className="mt-0.5 size-4 shrink-0 text-primary" /> {f.t}
              </li>
            ))}
          </ul>
          <form action={subscribeProAction} className="mt-6">
            <SubmitButton size="lg" className="w-full" pendingText="Conectando con Flow…">
              <Sparkles className="size-4" /> Hacerme Pro
            </SubmitButton>
          </form>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Pago mensual seguro vía Flow. Cancelas cuando quieras y conservas
            el acceso hasta el fin del período.
          </p>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Una clase particular humana cuesta $15.000–25.000 LA HORA. Tu profesor
        de Aulia te acompaña todo el mes por menos que eso.
      </p>
    </div>
  );
}
