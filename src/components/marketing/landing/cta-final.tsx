import type { CSSProperties } from "react";
import Link from "next/link";
import { Reveal } from "@/components/marketing/reveal";
import { formatPrice } from "@/lib/utils";
import { site } from "@/lib/site";

/* §5.14 CTA final — «El input que te espera» (zona de loop #3: caret + placeholders) */

export function CtaFinal() {
  return (
    <section className="cv-auto bg-muted ruled py-24">
      <Reveal variant="fade-up" className="container-page text-center">
        <p>
          <span className="hand inline-block rotate-[-2deg]">
            tu cuaderno está abierto ✺
          </span>
        </p>
        <h2 className="mt-3 font-display text-4xl lg:text-5xl text-balance">
          ¿Qué quieres saber hacer en un mes?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Escríbelo. La IA diseña tu ruta en 2 minutos y ves el temario completo
          antes de pagar.
        </p>

        {/* El input gigante: un solo <a> con apariencia de input de cuaderno.
            El botón interno es el ÚNICO elemento accent de la página. */}
        <Link
          href="/empieza/ruta"
          aria-label="Diseñar mi ruta — escribe qué quieres aprender"
          className="group mx-auto mt-8 flex w-full max-w-xl items-center justify-between gap-3
                     rounded-lg border border-border bg-card px-5 py-4
                     text-base shadow-lift transition-transform hover:scale-[1.01]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex min-w-0 items-center gap-0.5 text-muted-foreground">
            <span className="type-cycle min-w-0" aria-hidden="true">
              <span className="truncate" style={{ "--cycle-i": 0 } as CSSProperties}>
                fotografía con celular…
              </span>
              <span className="truncate" style={{ "--cycle-i": 1 } as CSSProperties}>
                excel para mi pyme…
              </span>
              <span className="truncate" style={{ "--cycle-i": 2 } as CSSProperties}>
                guitarra desde cero…
              </span>
            </span>
            <span
              className="caret-blink h-5 w-0.5 shrink-0 bg-foreground"
              aria-hidden="true"
            />
          </span>
          <span
            className="inline-flex h-11 shrink-0 items-center rounded-md bg-accent px-5
                       font-medium text-accent-foreground shadow-soft"
          >
            Diseñar mi ruta
          </span>
        </Link>

        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{formatPrice(site.pricing.singlePath, "CLP")} una vez</span>
          <span aria-hidden="true">·</span>
          <span>Garantía de 7 días</span>
          <span aria-hidden="true">·</span>
          <a
            href="mailto:hola@aulia.ai"
            className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline"
          >
            hola@aulia.ai
          </a>
        </p>
      </Reveal>
    </section>
  );
}
