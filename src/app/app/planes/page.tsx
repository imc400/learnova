import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Sparkles,
  Check,
  GraduationCap,
  Map,
  Library,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/subscription";
import { subscribeProAction } from "@/server/actions/subscription";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import { formatPrice } from "@/lib/utils";
import { env } from "@/lib/env";

export const metadata = { title: "Planes" };
export const dynamic = "force-dynamic";

/** Atribución de la compra Pro: superficies que llegan a /app/planes con
 *  ?source= (catálogo cerrado; lo re-valida subscribeProAction). */
const PLANES_SOURCES = new Set([
  "planes_clases",
  "dashboard_banner",
  "profesores_upsell",
  "post_clase",
  "quiz_trabado",
]);

export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; motivo?: string; source?: string }>;
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
  // PAT activo → suscripción real con cobro automático. Sin PAT → Pro MANUAL:
  // cobro único de 30 días, sin renovación automática (se avisa para renovar).
  const proAutomatico = env.PRO_SUBSCRIPTION_ENABLED === "true";
  // ¿Desde qué superficie llegó? (rebote por cupo, upsell post-clase, banner…)
  const source =
    sp.source && PLANES_SOURCES.has(sp.source)
      ? sp.source
      : sp.motivo === "limite-rutas"
        ? "planes_limite"
        : null;

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
        <NotaBanner tone="aviso" className="mt-4">
          Completaste tu cupo de rutas — con Pro creas {env.PRO_ROUTES_PER_MONTH}{" "}
          rutas nuevas cada mes.
        </NotaBanner>
      )}
      {sp.error === "tarjeta" && (
        <NotaBanner tone="error" titulo="No pudimos registrar tu tarjeta" className="mt-4">
          Nada se cobró — intenta de nuevo, o escríbenos a hola@aulia.ai y lo
          vemos contigo.
        </NotaBanner>
      )}
      {sp.error === "pago" && (
        <NotaBanner tone="error" titulo="Algo falló al iniciar el pago" className="mt-4">
          No se hizo ningún cobro. Intenta de nuevo en unos segundos.
        </NotaBanner>
      )}
      {/* Ramas SOLO del modo PAT (suscripción con cobro automático): el
          card-return de Flow y el error 7001 de registerCard no existen en el
          Pro manual, así que se gatean para no mostrar copy imposible.
          WARNING: NO activar PRO_SUBSCRIPTION_ENABLED sin contrato PAT
          firmado (task #45). */}
      {proAutomatico && sp.error === "disponible" && (
        <NotaBanner tone="aviso" className="mt-4">
          La suscripción Pro estará disponible muy pronto — estamos activando
          el cobro automático. Mientras tanto puedes comprar rutas
          individuales, y te avisaremos apenas Pro esté listo.
        </NotaBanner>
      )}
      {sp.error === "email" && (
        <NotaBanner tone="error" titulo="Tu correo no parece recibir mensajes" className="mt-4">
          ¿Quedó con un error de tipeo? No se hizo ningún cobro — el procesador
          de pagos verifica tu correo para enviarte los comprobantes.
          Escríbenos a hola@aulia.ai y lo corregimos al tiro.
        </NotaBanner>
      )}
      {proAutomatico && sp.error === "cobro" && (
        <NotaBanner tone="error" titulo="El primer cobro fue rechazado" className="mt-4">
          Tu tarjeta quedó registrada pero el cobro no pasó (¿fondos o cupo?).
          Nada quedó activo — intenta con otra tarjeta.
        </NotaBanner>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {/* Por ruta */}
        <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">Por ruta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pagas una vez. Tuya para siempre.
          </p>
          <p className="mt-4 font-display text-3xl font-bold">
            {formatPrice(ruta, "CLP")}
            <span className="ml-1.5 text-sm font-semibold text-muted-foreground">
              por ruta
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
            Se paga al activar cada ruta, después de ver tu temario.
          </p>
          <div className="mt-auto pt-4">
            <Button asChild variant="outline" className="w-full">
              <Link href="/app/crear">Diseñar mi ruta</Link>
            </Button>
          </div>
        </div>

        {/* Pro */}
        <div className="relative rounded-2xl border-2 border-primary bg-card p-6 shadow-lift">
          <span className="tab-note absolute -top-4 left-6">
            para los que van en serio ✺
          </span>
          <h2 className="font-display text-lg font-semibold">Aulia Pro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu profesor particular, todos los meses.
          </p>
          <p className="mt-4 font-display text-3xl font-bold text-primary">
            {formatPrice(pro, "CLP")}
            <span className="ml-1.5 text-sm font-semibold text-muted-foreground">
              {/* WARNING: NO activar PRO_SUBSCRIPTION_ENABLED sin contrato PAT
                  firmado (task #45); el copy "/ mes" está PROHIBIDO en modo
                  manual (Pro = 30 días, sin renovación automática). */}
              {proAutomatico ? "/ mes" : "por 30 días"}
            </span>
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              { icon: Map, t: `${env.PRO_ROUTES_PER_MONTH} rutas nuevas a tu medida cada mes` },
              { icon: GraduationCap, t: "120 minutos al mes de clases en vivo, con todos tus profesores" },
              { icon: Library, t: "Tus rutas se encadenan en Caminos" },
            ].map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <f.icon className="mt-0.5 size-4 shrink-0 text-primary" /> {f.t}
              </li>
            ))}
          </ul>
          <form action={subscribeProAction.bind(null, null, source)} className="mt-6">
            <SubmitButton size="lg" className="w-full" pendingText="Conectando con Flow…">
              <Sparkles className="size-4" /> Hacerme Pro
            </SubmitButton>
          </form>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {/* WARNING: la rama "/mes · cancelas cuando quieras" SOLO puede
                verse con PAT firmado (task #45); prohibida en modo manual. */}
            {proAutomatico
              ? "Pago mensual seguro vía Flow. Cancelas cuando quieras y conservas el acceso hasta el fin del período."
              : "Pago seguro vía Flow. Sin cobro automático: pagas 30 días y te avisamos para renovar — sin permanencia ni sorpresas."}
          </p>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Una clase particular humana cuesta entre {formatPrice(15000, "CLP")} y{" "}
        {formatPrice(25000, "CLP")} <span className="ink-hl">la hora</span>. Tu
        profesor de Aulia te acompaña todo el mes por menos que eso.
      </p>
    </div>
  );
}
