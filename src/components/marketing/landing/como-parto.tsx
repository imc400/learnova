import type { ReactNode } from "react";
import Link from "next/link";
import { Reveal } from "@/components/marketing/reveal";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";

/**
 * §5.11 Cómo parto — 3 fichas con los pasos para empezar.
 * Desktop: grid de 3 columnas con el número gigante detrás del texto.
 * Mobile: apiladas en layout fila con el número en una columna de 64 px.
 */

interface Step {
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Cuéntanos tu meta.",
    body: "Dos o tres preguntas inteligentes, de tu tema.",
  },
  {
    title: "Mira tu temario.",
    body: (
      <>
        Completo, módulo por módulo, antes de pagar.{" "}
        <strong className="font-semibold text-foreground">
          Si te hace sentido, lo activas por {formatPrice(9990, "CLP")}, una sola vez — y
          es tuyo para siempre.
        </strong>
      </>
    ),
  },
  {
    title: "Actívalo y conoce a tu profesor.",
    body: "Te da la clase de bienvenida apenas partes.",
  },
];

export function ComoParto() {
  return (
    <section id="como-parto" className="cv-auto py-16 lg:py-24">
      <div className="container-page">
        <Reveal variant="fade-up">
          <h2 className="text-balance text-center text-3xl font-semibold tracking-tight lg:text-4xl">
            Partir toma 2 minutos.
          </h2>
        </Reveal>

        <div className="mx-auto mt-10 grid max-w-4xl gap-4 lg:mt-14 lg:grid-cols-3 lg:gap-6">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.title}
              as="div"
              variant="fade-up"
              index={i}
              stagger={120}
              className="relative grid grid-cols-[64px_1fr] items-start gap-x-2 rounded-lg border border-border bg-card p-5 shadow-soft lg:block lg:p-6 lg:pt-14"
            >
              <span
                aria-hidden="true"
                className="select-none font-display text-6xl font-semibold leading-none text-primary/20 lg:absolute lg:left-6 lg:top-4"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-3">
          <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
            <Link href="/empieza/ruta">Diseñar mi ruta</Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Garantía de 7 días · te devolvemos el 100%
          </p>
        </div>
      </div>
    </section>
  );
}
