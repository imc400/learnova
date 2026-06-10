"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check, Loader2 } from "lucide-react";
import { rateModuleAction } from "@/server/actions/ratings";

/*
  Rating binario de módulo (👍/👎) — pedido en el pico emocional (módulo
  completado) o disponible como badge compacto en la página de ruta.
  Thumbs-down expande chips de razón + comentario opcional: feedback
  accionable para el loop de calidad del contenido canónico.
*/

const REASONS = [
  { id: "video", label: "El video no ayudó" },
  { id: "texto", label: "El texto no quedó claro" },
  { id: "quiz", label: "El quiz no calzaba" },
  { id: "nivel", label: "Nivel muy fácil/difícil" },
];

export function ModuleRating({
  moduleId,
  variant = "celebration",
  initialRating = null,
}: {
  moduleId: string;
  variant?: "celebration" | "badge";
  initialRating?: "up" | "down" | null;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(initialRating);
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">(
    initialRating ? "done" : "idle",
  );

  async function submit(r: "up" | "down", withDetails = false) {
    setRating(r);
    if (r === "down" && !withDetails && variant === "celebration") {
      setExpanded(true); // pedir el porqué antes de enviar
      return;
    }
    setState("saving");
    try {
      await rateModuleAction({
        moduleId,
        rating: r,
        reason: withDetails ? reason : null,
        comment: withDetails && comment.trim() ? comment.trim() : null,
      });
      setState("done");
      setExpanded(false);
    } catch {
      setState("idle");
    }
  }

  // En la celebración, agradecer y cerrar; en el badge, mantener los pulgares
  // pintados y re-puntuables.
  if (state === "done" && variant === "celebration") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
        <Check className="size-3.5" /> ¡Gracias! Esto mejora las próximas rutas.
      </span>
    );
  }

  const btn = (r: "up" | "down", Icon: typeof ThumbsUp, label: string) => (
    <button
      type="button"
      onClick={() => submit(r)}
      disabled={state === "saving"}
      aria-label={label}
      className={`grid size-8 place-items-center rounded-full border transition-colors ${
        rating === r
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
      }`}
    >
      <Icon className="size-4" />
    </button>
  );

  return (
    <div className={variant === "celebration" ? "mt-2" : ""}>
      <div className="flex items-center gap-2">
        {variant === "celebration" && (
          <span className="text-sm">¿Este módulo te sirvió?</span>
        )}
        {btn("up", ThumbsUp, "Me sirvió")}
        {btn("down", ThumbsDown, "No me sirvió")}
        {state === "saving" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(r.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  reason === r.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="¿Qué mejorarías? (opcional)"
            className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => submit("down", true)}
            disabled={state === "saving"}
            className="self-start rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
