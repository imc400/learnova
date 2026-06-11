import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckDraw, Lock, Flame } from "@/components/marketing/landing/icons";

/*
  §5.1 Mock estrella del hero (hilo Camila) — server, estático, sin props.
  Coreografía CSS pura: card 200ms → filas 500–1100ms → checks 1000/1150ms
  → barra 1300ms → stickers 1500/1650ms → chip+pie 1900ms → burbuja 2100ms.
  BASE sin JS / reduced-motion: todo pintado (checks dibujados, barra al 66%,
  stickers pegados con su rotación final).
*/
export function RoutePreviewHero() {
  return (
    <div className="animate-scale-in [animation-delay:200ms] ruled mock-margin relative rounded-lg bg-card p-5 shadow-lift">
      {/* 1 · Cabecera */}
      <div>
        <span className="tab-note text-sm">tu ruta ✺</span>
        <p className="mt-3 font-display text-lg">Fotografía con tu celular</p>
        <p className="hand text-sm">meta: vender más con mejores fotos ✺</p>
      </div>

      {/* 2 · Chip profesora */}
      <div className="animate-fade-in [animation-delay:1900ms] mt-4 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm text-primary">
          A
        </span>
        <Badge variant="primary">Profe Antonia · te acompaña por voz</Badge>
      </div>

      {/* 3 · Lista de 5 módulos */}
      <ul className="mt-4 space-y-1">
        <li className="animate-fade-up [animation-delay:500ms] flex min-h-10 items-center gap-2 text-sm">
          <CheckDraw
            size={16}
            className="shrink-0 text-primary"
            style={{ "--draw-delay": "1000ms" } as CSSProperties}
          />
          <span className="min-w-0 flex-1">
            1 · Conoce tu cámara (la que ya tienes)
          </span>
          <Badge
            variant="accent"
            className="sticker-pop sticker-pop-auto shrink-0"
            style={
              { "--pop-rotate": "-3deg", "--pop-delay": "1500ms" } as CSSProperties
            }
          >
            +50 XP
          </Badge>
        </li>

        <li className="animate-fade-up [animation-delay:650ms] flex min-h-10 items-center gap-2 text-sm">
          <CheckDraw
            size={16}
            className="shrink-0 text-primary"
            style={{ "--draw-delay": "1150ms" } as CSSProperties}
          />
          <span className="min-w-0 flex-1">2 · Luz natural sin equipo</span>
          <Badge
            variant="accent"
            className="sticker-pop sticker-pop-auto shrink-0"
            style={
              { "--pop-rotate": "2deg", "--pop-delay": "1650ms" } as CSSProperties
            }
          >
            +50 XP
          </Badge>
        </li>

        <li className="animate-fade-up [animation-delay:800ms] -mx-2 flex min-h-10 items-center gap-2 rounded-md bg-highlight-soft px-2 py-1.5 text-sm">
          <div className="min-w-0 flex-1">
            <p>3 · Composición: la regla de los tercios</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="progress-fill animate-tick-progress [animation-delay:1300ms] h-full bg-primary"
                style={{ "--progress": 0.66 } as CSSProperties}
              />
            </div>
          </div>
        </li>

        <li className="animate-fade-up [animation-delay:950ms] hidden min-h-10 items-center gap-2 text-sm text-muted-foreground sm:flex">
          <Lock size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">4 · Edición en tu celular</span>
        </li>

        <li className="animate-fade-up [animation-delay:1100ms] flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
          <Lock size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">5 · Fotos que venden</span>
        </li>
      </ul>

      {/* 4 · Pie */}
      <div className="animate-fade-in [animation-delay:1900ms] mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="primary">Nivel 3 · 420 XP</Badge>
        <Badge variant="accent">
          <Flame size={16} />
          Racha: 6 días
        </Badge>
      </div>

      {/* 5 · Burbuja del tutor colgando del borde */}
      <div className="animate-scale-in [animation-delay:2100ms] absolute -bottom-4 right-4 rotate-[-1deg] rounded-lg bg-card px-3 py-2 text-sm shadow-soft">
        <span
          className="absolute -top-1 right-5 h-2.5 w-2.5 rotate-45 bg-card"
          aria-hidden="true"
        />
        ¿Te tinca un ejercicio corto para fijar esto?
      </div>
    </div>
  );
}
