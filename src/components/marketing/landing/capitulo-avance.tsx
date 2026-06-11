import type { CSSProperties } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { Badge } from "@/components/ui/badge";
import { Check, Flame } from "@/components/marketing/landing/icons";

/*
  Capítulo 4 — Tu avance (§5.8).
  Split 6/6 con el mock del quiz a la izquierda en desktop (copy primero en
  el DOM → orden mobile copy→mock). Los chips usan sticker-pop-reveal: se
  "pegan" solos cuando el Reveal slide-right del mock dispara [data-revealed].
  El tachado del par antes/ahora se dibuja al revelarse el copy.
*/

export function CapituloAvance() {
  return (
    <section id="capitulo-4" className="cv-auto bg-muted py-20">
      <div className="container-page">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
          {/* Copy — derecha en desktop */}
          <Reveal as="div" variant="fade-up" className="min-w-0 strike-on-reveal lg:order-2">
            <span className="tab-note">capítulo 4 · tu avance</span>

            {/* Par antes/ahora */}
            <div className="mt-7 flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1.5">
              <span className="tape-note">
                <s className="strike-draw no-underline">avanzar era «ya vi el video»</s>
              </span>
              <span className="self-center text-muted-foreground sm:self-auto" aria-hidden="true">
                <span className="sm:hidden">↓</span>
                <span className="hidden sm:inline">→</span>
              </span>
              <p className="font-semibold">avanzar es demostrar que lo sabes.</p>
            </div>

            <h2 className="mt-5 font-display text-3xl text-balance sm:text-4xl">
              Aquí no avanzas por mirar. Avanzas por saber.
            </h2>

            <div className="mt-5 space-y-4 text-muted-foreground">
              <p>
                Cada lección termina con un quiz corto basado en lo que acabas de ver — y
                aprobarlo es lo que la completa. Tu porcentaje de avance no mide reproducciones:
                mide dominio.
              </p>
              <p>
                Ganas XP por aprender (nunca por acumular minutos de pantalla), subes de nivel y
                construyes racha. Y la racha tiene perdón: si un día no puedes, un congelador
                automático te la protege — hasta dos veces. Si te tinca la competencia sana, hay
                un ranking semanal con la comunidad; tu correo y tus metas nunca se muestran.
              </p>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Hay 8 logros por desbloquear. Uno es secreto.
            </p>
            <p className="hand mt-3 inline-block rotate-[-2deg]">
              la racha te perdona un mal día ✺
            </p>
          </Reveal>

          {/* Mock del quiz — hilo Camila (cita el 7:32 del cap. 2) */}
          <Reveal as="div" variant="slide-right" className="min-w-0 lg:order-1">
            <div className="mock-margin rounded-lg bg-card p-5 shadow-lift sm:p-6 lg:rotate-[-1deg]">
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check size={24} />
                </span>
                <p className="font-display text-lg">Quiz aprobado · 5 de 6</p>
              </div>

              <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Correcta — el video lo explica en el 7:32
              </p>

              {/* Chips que se pegan como stickers al revelarse el mock */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge
                  variant="accent"
                  className="sticker-pop sticker-pop-reveal"
                  style={{ "--pop-rotate": "-3deg", "--pop-delay": "0ms" } as CSSProperties}
                >
                  +25 XP
                </Badge>
                <Badge
                  variant="outline"
                  className="sticker-pop sticker-pop-reveal"
                  style={{ "--pop-rotate": "2deg", "--pop-delay": "100ms" } as CSSProperties}
                >
                  <Flame size={16} />
                  Racha: 6 días
                </Badge>
                <Badge
                  variant="primary"
                  className="sticker-pop sticker-pop-reveal"
                  style={{ "--pop-rotate": "-1deg", "--pop-delay": "200ms" } as CSSProperties}
                >
                  Logro nuevo: Mente afilada
                </Badge>
              </div>

              {/* Mini-podio del ranking — sin números */}
              <div className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
                <div className="flex items-end gap-1.5" aria-hidden="true">
                  <span className="h-8 w-6 rounded-t-[4px] bg-muted" />
                  <span className="h-12 w-6 rounded-t-[4px] bg-accent/40" />
                  <span className="h-6 w-6 rounded-t-[4px] bg-muted" />
                </div>
                <p className="hand rotate-[-2deg] text-sm">vista de ejemplo ✺</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
