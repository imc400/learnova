import { Reveal } from "@/components/marketing/reveal";
import { Badge } from "@/components/ui/badge";
import { Play } from "@/components/marketing/landing/icons";

/*
  Capítulo 2 — Los videos (§5.6). Server component.
  Banda bg-muted, split invertido (mock izquierda en desktop), apilado
  copy→mock en mobile. Player 16:9 con timeline de 3 marcas en --highlight
  y chips de minutos clave (Badge accent, ≥44 px) con scroll-snap en 375 px.
  Las marcas del timeline animan con fade-in encadenado dentro del Reveal
  del mock; sin JS / reduced-motion todo queda pintado desde el SSR.
*/

const MARCAS = [
  { time: "3:45", label: "Encuadre", left: "24%", delay: "[animation-delay:300ms]" },
  { time: "7:32", label: "Regla de los tercios", left: "48%", delay: "[animation-delay:380ms]" },
  { time: "12:10", label: "Luz natural", left: "78%", delay: "[animation-delay:460ms]" },
];

export function CapituloVideos() {
  return (
    <section id="capitulo-2" className="cv-auto bg-muted py-20">
      <div className="container-page">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          {/* Copy (segundo en desktop, primero en mobile) */}
          <Reveal
            variant="fade-up"
            className="min-w-0 strike-on-reveal lg:order-2 lg:col-span-6"
          >
            <span className="tab-note">capítulo 2 · los videos</span>

            {/* Par antes/ahora */}
            <div className="mt-6 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="tape-note">
                <s className="strike-draw no-underline">
                  bucear horas en YouTube a ver si pillas algo bueno
                </s>
              </span>
              <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                →
              </span>
              <span aria-hidden="true" className="self-center text-muted-foreground sm:hidden">
                ↓
              </span>
              <span className="font-semibold">el video justo, en el minuto justo.</span>
            </div>

            <h2 className="mt-4 font-display text-3xl text-balance sm:text-4xl">
              El mejor video de YouTube para cada lección. Marcado al minuto.
            </h2>

            <p className="mt-4 text-muted-foreground">
              Para cada lección, la IA busca, compara y elige el mejor video —
              y lo verifica contra lo que esa lección tiene que enseñarte. Si
              ningún video la cubre bien, preferimos dejarla sin video antes
              que ponerte relleno.
            </p>
            <p className="mt-3 text-muted-foreground">
              Después te lo entrega con los minutos clave marcados: tocas
              «7:32 · Regla de los tercios» y el video salta exactamente ahí. Y
              el quiz de la lección se basa en lo que el video realmente dice —
              con el minuto citado en la explicación.
            </p>

            <p className="hand mt-4 text-base">como una clase editada a mano ✺</p>

            <p className="mt-4 text-xs text-muted-foreground">
              Videos mostrados con el reproductor oficial de YouTube · curados
              por Aulia, con crédito a sus creadores.
            </p>
          </Reveal>

          {/* Mock — player + minutos clave */}
          <Reveal variant="slide-right" className="min-w-0 lg:order-1 lg:col-span-6">
            <div className="rounded-lg bg-card p-4 shadow-lift">
              <div className="relative aspect-video overflow-hidden rounded-md bg-foreground">
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background/15">
                    <Play size={20} className="text-background" />
                  </span>
                </div>

                {/* Línea de tiempo con 3 marcas */}
                <div className="absolute inset-x-3 bottom-3" aria-hidden="true">
                  <div className="relative h-1 rounded-full bg-background/25">
                    {MARCAS.map((m) => (
                      <span
                        key={m.time}
                        className={`animate-fade-in absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full bg-highlight ${m.delay}`}
                        style={{ left: m.left }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Chips de minutos clave (elementos del mock, no links) */}
              <div className="mt-3 flex gap-2 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] lg:flex-wrap lg:overflow-visible">
                {MARCAS.map((m, i) => (
                  <Reveal
                    key={m.time}
                    as="span"
                    variant="scale-in"
                    index={i}
                    stagger={80}
                    className="shrink-0 snap-start"
                  >
                    <Badge
                      variant="accent"
                      className="min-h-11 whitespace-nowrap px-3.5 text-sm"
                    >
                      <Play size={12} />
                      {m.time} · {m.label}
                    </Badge>
                  </Reveal>
                ))}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Video proporcionado por YouTube · curado por Aulia
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
