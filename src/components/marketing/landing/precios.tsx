import Link from "next/link";
import { Reveal } from "@/components/marketing/reveal";
import { Check, Seal } from "@/components/marketing/landing/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import { site } from "@/lib/site";

/* §5.12 Precios — «Sin letra chica» */

const bulletsRuta = [
  "Ruta completa diseñada para tu meta",
  "Profesor IA por voz: clase de bienvenida + clases en vivo (40 min incluidos)",
  "Los mejores videos de YouTube, con minutos clave clicables",
  "Quizzes, XP, rachas con perdón, logros y ranking",
  "Tutor por texto en cada lección",
  "Tu avance y tus tareas, a tu correo",
];

const bulletsPro = [
  "2 rutas nuevas cada mes",
  "120 minutos al mes de clases en vivo, con todos tus profesores",
  "Tus rutas se encadenan en Caminos",
];

export function Precios() {
  return (
    <section id="precios" className="cv-auto py-20 lg:py-28">
      <div className="container-page">
        <Reveal variant="fade-up" className="text-center">
          <span className="tab-note">precios honestos</span>
          <h2 className="mt-5 font-display text-4xl lg:text-5xl text-balance">
            Sin letra chica.
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Lo que ves es lo que pagas. Aquí nada se cobra solo.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Card A — Tu ruta (destacada, primero también en mobile) */}
          <Reveal variant="scale-in" index={0} stagger={120} className="lg:-mt-3">
            <article className="flex h-full flex-col rounded-xl border border-primary bg-card p-6 shadow-lift lg:p-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-2xl">Tu ruta</h3>
                <Badge variant="primary">Para empezar</Badge>
              </div>

              <p className="mt-5 font-display text-5xl">
                {formatPrice(site.pricing.singlePath, "CLP")}
              </p>
              <p className="mt-2 font-semibold">pago único. Tuya para siempre.</p>

              <ul className="mt-6 space-y-3 text-sm">
                {bulletsRuta.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-7">
                <Button asChild className="w-full">
                  <Link href="/empieza/ruta">Diseñar mi ruta</Link>
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Garantía de 7 días: si no es para ti, te devolvemos el 100%.
                </p>
              </div>
            </article>
          </Reveal>

          {/* Card B — Aulia Pro */}
          <Reveal variant="scale-in" index={1} stagger={120}>
            <article className="relative flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-soft lg:p-8">
              <Reveal
                variant="fade-in"
                delay={400}
                className="absolute -top-4 right-5 rotate-[3deg]"
              >
                <span className="tab-note">sin cobro automático ✺</span>
              </Reveal>

              <h3 className="font-display text-2xl">Aulia Pro</h3>

              <p className="mt-5 font-display text-5xl">
                {formatPrice(site.pricing.proThirtyDays, "CLP")}
              </p>
              <p className="mt-2 font-semibold">por 30 días.</p>

              <ul className="mt-6 space-y-3 text-sm">
                {bulletsPro.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-6 rounded-sm bg-highlight-soft px-2 py-1 text-sm">
                Pagas 30 días y te avisamos para renovar. Sin permanencia, sin
                cobros sorpresa.
              </p>

              <div className="mt-auto pt-7">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/empieza/ruta">Partir con Pro</Link>
                </Button>
              </div>
            </article>
          </Reveal>
        </div>

        {/* Banda de garantía */}
        <Reveal variant="fade-up" className="mx-auto mt-12 max-w-2xl">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-5 shadow-soft">
            <Seal size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              Garantía simple: si en 7 días Aulia no es para ti, escribes a{" "}
              <a
                href="mailto:hola@aulia.ai"
                className="font-medium text-foreground hover:underline"
              >
                hola@aulia.ai
              </a>{" "}
              y te devolvemos el 100%. Sin formularios, sin preguntas pesadas.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
