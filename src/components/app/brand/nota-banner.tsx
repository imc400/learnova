import type { ReactNode } from "react";
import { Check, AlertCircle } from "lucide-react";
import { Spark } from "@/components/marketing/landing/icons";
import { cn } from "@/lib/utils";

/*
  Banner unificado de éxito/error/aviso (receta R4). Reemplaza los
  <p className="rounded-md bg-…"> ad-hoc del repo. Fórmula del error:
  qué pasó + qué NO pasó + qué hacer (+ salida a hola@aulia.ai si aplica).
*/

type Tone = "exito" | "error" | "aviso";

const CONFIG = {
  exito: { role: "status", caja: "border-primary/30 bg-primary/5", icono: "text-primary", titulo: "" },
  error: { role: "alert", caja: "border-destructive/30 bg-destructive/5", icono: "text-destructive", titulo: "text-destructive" },
  aviso: { role: "status", caja: "border-accent bg-highlight-soft", icono: "text-accent-foreground", titulo: "" },
} as const;

type Props = {
  tone: Tone;
  titulo?: string;
  children: ReactNode;
  /** Remate hand opcional, SOLO para tone="exito" en hitos. Jamás en error. */
  nota?: string;
  className?: string;
};

export function NotaBanner({ tone, titulo, children, nota, className }: Props) {
  const cfg = CONFIG[tone];
  const Icono = tone === "exito" ? Check : tone === "error" ? AlertCircle : Spark;
  return (
    <div
      role={cfg.role}
      className={cn("flex items-start gap-3 rounded-lg border p-4 text-sm shadow-soft", cfg.caja, className)}
    >
      <Icono size={16} className={cn("mt-0.5 shrink-0", cfg.icono)} />
      <div className="min-w-0">
        {titulo ? <p className={cn("font-semibold", cfg.titulo)}>{titulo}</p> : null}
        <div className={cn("text-muted-foreground", titulo && "mt-0.5")}>{children}</div>
        {nota && tone === "exito" ? (
          <p className="hand mt-1.5 inline-block rotate-[-1deg]">{nota}</p>
        ) : null}
      </div>
    </div>
  );
}
