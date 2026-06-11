import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
  Ráfaga de stickers XP/racha/logro (receta R5) — la micro-alegría del
  producto, igual que en la landing. Regla del "una vez": animar solo la
  PRIMERA vez que ocurre el evento; en re-render pasar animar={false}.
*/

type Sticker = { contenido: ReactNode; variant?: "accent" | "primary" | "outline" };
const ROTACIONES = ["-3deg", "2deg", "-1deg"];

type Props = {
  /** Máximo 3. Orden sugerido: XP (accent), racha (outline), logro (primary). */
  stickers: Sticker[];
  animar?: boolean;
  className?: string;
};

export function CelebracionStickers({ stickers, animar = true, className }: Props) {
  return (
    <div role="status" className={cn("mt-4 flex flex-wrap gap-2", className)}>
      {stickers.slice(0, 3).map((s, i) => (
        <Badge
          key={i}
          variant={s.variant ?? "accent"}
          className={cn("sticker-pop", animar && "sticker-pop-auto")}
          style={{ "--pop-rotate": ROTACIONES[i], "--pop-delay": `${i * 100}ms` } as CSSProperties}
        >
          {s.contenido}
        </Badge>
      ))}
    </div>
  );
}
