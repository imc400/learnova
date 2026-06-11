import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
  Header de página del interior (receta R1 del recetario Cuaderno).
  Presupuesto: el ÚNICO tab-note permitido en la pantalla vive aquí.
*/

type Props = {
  /** Texto del tab-note, minúsculas, ej: "mis rutas ✺". */
  nota: string;
  /** Puede incluir <span className="ink-hl">…</span> en 1–2 palabras. */
  titulo: ReactNode;
  subtitulo?: string;
  className?: string;
};

export function PageHeader({ nota, titulo, subtitulo, className }: Props) {
  return (
    <header className={cn("mb-8", className)}>
      <span className="tab-note">{nota}</span>
      <h1 className="mt-4 font-display text-3xl text-balance sm:text-4xl">{titulo}</h1>
      {subtitulo ? (
        <p className="mt-2 max-w-[58ch] text-muted-foreground">{subtitulo}</p>
      ) : null}
    </header>
  );
}
