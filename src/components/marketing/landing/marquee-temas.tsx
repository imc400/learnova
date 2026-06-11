import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";

/*
  §5.2 Marquee de temas — responde «¿servirá para lo MÍO?» en 3 s.
  Chips NO interactivos (no <a>, no <button>) — WCAG 2.2.2.
  Zona de loop #1 de la página. Pausa accesible: checkbox estilizado
  (teclado y touch, cero JS) — .marquee-wrap:has(:checked) detiene el track.
  Reduced-motion: red global → fila estática, DOM íntegro.
*/

const temas = [
  "Acuarela",
  "Meta Ads",
  "Excel para pymes",
  "Fotografía con celular",
  "Cocina de casa",
  "Inglés para entrevistas",
  "Guitarra",
  "Repostería",
  "Power BI",
  "Programar desde cero",
  "Edición de video",
  "Marketing para tu emprendimiento",
];

function chips() {
  return temas.map((tema) => (
    <li key={tema} className="shrink-0">
      <Badge variant="outline" className="whitespace-nowrap bg-card">
        {tema}
      </Badge>
    </li>
  ));
}

export function MarqueeTemas() {
  return (
    <section className="py-8">
      <p className="text-center text-sm text-muted-foreground">
        Pídele el tema que quieras:
      </p>

      {/* Full-bleed: el marquee corre de borde a borde, sin container. */}
      <div className="marquee-wrap">
        <label className="mx-auto mb-1 flex w-fit cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <input
            type="checkbox"
            className="marquee-toggle peer sr-only"
            aria-label="Pausar el movimiento de los temas"
          />
          <span className="rounded-sm border border-border px-1.5 py-0.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            <span className="lbl-pausar">pausar</span>
            <span className="lbl-seguir">seguir</span>
          </span>
        </label>
        <div
          className="marquee"
          style={{ "--marquee-duration": "38s" } as CSSProperties}
        >
          <ul className="marquee-track">{chips()}</ul>
          <ul className="marquee-track" aria-hidden="true">
            {chips()}
          </ul>
        </div>
      </div>

      <p className="hand mt-4 text-center">
        escribe el tuyo — la ruta se diseña igual ✺
      </p>
    </section>
  );
}
