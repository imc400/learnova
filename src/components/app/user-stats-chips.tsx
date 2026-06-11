import type { CSSProperties } from "react";
import { Flame, Star } from "lucide-react";

/**
 * Chips de XP/nivel/racha para el header de la app. Presentacional puro:
 * el layout (server component) consulta getUserStats y pasa los valores.
 * Estado PERSISTENTE (regla del "una vez"): sticker-pop base sin `-auto` —
 * el chip informa, no celebra.
 */
export function UserStatsChips({
  level,
  totalXp,
  streak,
  levelProgress,
  freezes,
}: {
  level: number;
  totalXp: number;
  streak: number;
  levelProgress: number;
  /** Congeladores de racha disponibles (perdón de un día perdido). */
  freezes?: number;
}) {
  const nivelInfo = `Nivel ${level} · ${totalXp.toLocaleString("es-CL")} XP — ${levelProgress}% hacia el siguiente nivel`;
  const rachaInfo = `Racha de ${streak} ${streak === 1 ? "día" : "días"}${
    freezes !== undefined
      ? ` · ${freezes} ${freezes === 1 ? "congelador disponible" : "congeladores disponibles"}`
      : ""
  }`;
  return (
    <div className="flex items-center gap-2">
      <span
        title={nivelInfo}
        aria-label={nivelInfo}
        className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
      >
        <Star className="size-3.5 fill-current" aria-hidden />
        Nivel {level}
        <span className="hidden font-normal text-primary/80 sm:inline">
          · {totalXp.toLocaleString("es-CL")} XP
        </span>
      </span>
      {streak > 0 && (
        <span
          title={rachaInfo}
          aria-label={rachaInfo}
          className="sticker-pop items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-foreground"
          style={{ "--pop-rotate": "-2deg" } as CSSProperties}
        >
          <Flame className="size-3.5 text-accent" aria-hidden />
          {streak}
          <span className="sr-only">días de racha</span>
        </span>
      )}
    </div>
  );
}
