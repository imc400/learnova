import Link from "next/link";

import { Reveal } from "@/components/marketing/reveal";
import { Button } from "@/components/ui/button";

/*
  Capítulo 1 — Tu ruta (§5.5). Server component.
  Split 6/6 desktop (copy izquierda / mock derecha), apilado copy→mock en mobile.
  Mock del wizard real (hilo Camila): paso 2 de 3, chip «Vender mis productos»
  seleccionado. El tachado del tape-note se dibuja al revelarse el copy
  (strike-on-reveal); sin JS / reduced-motion queda pintado desde el SSR.
*/

const CHIPS_NO_SELECCIONADOS = [
  "Recuerdos de la familia",
  "Subir mejores historias",
  "Otro…",
];

export function CapituloRuta() {
  return (
    <section id="capitulo-1" className="cv-auto bg-background py-20 lg:py-28">
      <div className="container-page">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          {/* Copy */}
          <Reveal variant="fade-up" className="min-w-0 strike-on-reveal lg:col-span-6">
            <span className="tab-note">capítulo 1 · tu ruta</span>

            {/* Par antes/ahora */}
            <div className="mt-6 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="tape-note">
                <s className="strike-draw no-underline">
                  elegir entre diez mil cursos de otros
                </s>
              </span>
              <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                →
              </span>
              <span aria-hidden="true" className="self-center text-muted-foreground sm:hidden">
                ↓
              </span>
              <span className="font-semibold">una ruta que se diseña para ti.</span>
            </div>

            <h2 className="mt-4 font-display text-3xl text-balance sm:text-4xl">
              Cuéntale tu meta. En 2 minutos tienes temario.
            </h2>

            <p className="mt-4 text-muted-foreground">
              Escribe lo que quieras aprender — lo que sea — y la IA te hace 2 o
              3 preguntas inteligentes, de tu tema: si pones acuarela, te
              pregunta de acuarela, no te pasa un formulario genérico. Con eso
              diseña una ruta de 5 a 7 módulos en orden, desde donde estás hasta
              donde quieres llegar.
            </p>
            <p className="mt-3">
              <strong>
                Y lo más importante: la ves completa antes de pagar. Módulo por
                módulo. Si no te hace sentido, no pones ni un peso.
              </strong>
            </p>

            <div className="mt-5">
              <Button asChild variant="link" className="px-0">
                <Link href="/empieza/ruta">Probar con mi tema →</Link>
              </Button>
            </div>
          </Reveal>

          {/* Mock — wizard real (hilo Camila) */}
          <Reveal variant="slide-left" className="min-w-0 lg:col-span-6">
            <div className="mock-margin rounded-lg bg-card p-5 shadow-lift lg:rotate-[-1deg]">
              {/* Dots de progreso: paso 2 de 3 activo */}
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="h-2 w-2 rounded-full bg-primary/30" />
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="h-2 w-2 rounded-full bg-border" />
              </div>

              <p className="mt-4 font-display text-lg">
                ¿Para qué quieres mejorar tus fotos?
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Reveal as="span" variant="scale-in" delay={400}>
                  <span className="inline-flex min-h-11 items-center rounded-full border border-primary bg-primary/10 px-4 text-sm font-medium">
                    Vender mis productos
                  </span>
                </Reveal>
                {CHIPS_NO_SELECCIONADOS.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>

              <p className="mt-5 text-xs text-muted-foreground">
                2 minutos · La IA diseña tu ruta exactamente para tu meta
              </p>
            </div>

            {/* Nota al margen del mock */}
            <p className="hand mt-4 text-center text-base lg:text-right">
              preguntas de TU tema, no un formulario ✺
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
