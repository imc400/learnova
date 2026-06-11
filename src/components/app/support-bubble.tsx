"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";

/*
  Burbuja de SOPORTE en vivo — flotante, marca Cuaderno. Chat con el agente
  experto (/api/soporte). Mismo lenguaje visual que el tutor de lecciones
  (tutor-chat.tsx): avatar en círculo bg-primary/10, burbujas bg-card /
  bg-primary/10, "está escribiendo" con 3 puntos, input text-base.

  Móvil (< sm): bottom sheet h-[70dvh] con backdrop, Escape, scroll del body
  bloqueado y safe-area (mismo patrón que lesson-tutor.tsx).
  Desktop (≥ sm): panel flotante bottom-right w-96 × h-[28rem].
*/

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const GREETING: Msg = {
  role: "assistant",
  content:
    "¡Hola! Soy la IA de soporte de Aulia. ¿Dudas con tu ruta, tus clases o un pago? Pregúntame no más.",
};

const SUGGESTIONS = [
  "¿Cómo funcionan los pagos?",
  "¿Cómo son las clases con el profesor?",
  "Tengo un problema con mi ruta",
];

const FALLBACK =
  "Se nos cortó la conexión. Reintenta aquí abajo, o escríbenos a hola@aulia.ai y lo vemos al tiro.";
const TIMEOUT_MSG =
  "Esto está tardando más de la cuenta. Reintenta aquí abajo, o escríbenos a hola@aulia.ai.";
const TIMEOUT_MS = 30_000;

/** Avatar de marca: "A" de Aulia en círculo (mismo patrón que el tutor). */
function AuliaAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-display font-semibold text-primary ${className}`}
    >
      A
    </span>
  );
}

/** "Está escribiendo": 3 puntos — estado vivo real (permitido por marca). */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Está escribiendo">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function SupportBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Historial que terminó en error (acaba en mensaje del usuario): permite
  // reintentar sin duplicar el mensaje — el reintento reemplaza la burbuja
  // de error por un placeholder nuevo.
  const [retryHistory, setRetryHistory] = useState<Msg[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Al abrir: Escape cierra; en móvil se bloquea el scroll del body (sheet);
  // el foco al input solo en desktop (en móvil dispararía el teclado al tiro).
  useEffect(() => {
    if (!open) return;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (!isMobile) inputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    if (isMobile) document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Llama al API con `history` (termina en mensaje del usuario) y rellena
      el placeholder del asistente. Timeout de 30 s; un res !ok con reply
      (p. ej. el 429 amable del rate limit) se muestra como mensaje normal. */
  const request = async (history: Msg[]) => {
    setMessages([...history, { role: "assistant", content: "" }]);
    setRetryHistory(null);
    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const replaceLast = (content: string) =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }]);
    try {
      const res = await fetch("/api/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(1) }), // sin el saludo local
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as { reply?: string } | null;
      if (!data?.reply) throw new Error(`soporte HTTP ${res.status}`);
      replaceLast(data.reply);
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "AbortError";
      replaceLast(timedOut ? TIMEOUT_MSG : FALLBACK);
      setRetryHistory(history);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setInput("");
    void request([...messages, { role: "user", content: text }]);
  };

  const retry = () => {
    if (!retryHistory || sending) return;
    void request(retryHistory);
  };

  // En la lección, la esquina inferior derecha es del FAB del profesor
  // (lesson-tutor.tsx): soporte se esconde ahí — la opción menos invasiva
  // (cero cambios al layout del shell; este componente ya es client).
  // OJO: el return va DESPUÉS de todos los hooks (orden estable).
  if (/^\/app\/rutas\/[^/]+\/leccion\//.test(pathname ?? "")) return null;

  return (
    <>
      {/* Backdrop del sheet: tocar fuera cierra. Solo móvil. */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/20 sm:hidden"
        />
      )}

      {/* Panel: bottom sheet en móvil, flotante bottom-right en desktop. */}
      {open && (
        <div
          role="dialog"
          aria-label="Chat de soporte de Aulia"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-lift sm:inset-x-auto sm:bottom-24 sm:right-4 sm:h-[28rem] sm:max-h-[calc(100dvh-7rem)] sm:w-96 sm:rounded-lg sm:border"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <AuliaAvatar className="text-sm" />
              <span className="truncate font-display text-sm font-semibold">
                Soporte Aulia
              </span>
              <span className="tab-note shrink-0">aquí estamos ✺</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          <div
            ref={listRef}
            aria-live="polite"
            className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && <AuliaAvatar className="size-6 text-xs" />}
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-md px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "border border-border bg-card text-foreground shadow-soft"
                  }`}
                >
                  {m.content || <TypingDots />}
                </div>
              </div>
            ))}

            {/* Sugerencias de inicio: solo con el saludo en pantalla. */}
            {messages.length === 1 && !sending && (
              <div className="flex flex-col gap-2 pl-8">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-sm border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Reintento tras error/timeout: re-envía sin duplicar el mensaje. */}
            {retryHistory && !sending && (
              <div className="pl-8">
                <button
                  onClick={retry}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <RotateCcw className="size-3.5" /> Reintentar
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3 pb-1.5"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu duda…"
              maxLength={500}
              disabled={sending}
              className="text-base" /* 16px: iOS no hace zoom al enfocar */
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Enviar"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>
          <p className="px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-0.5 text-center text-[11px] text-muted-foreground">
            Hay un humano detrás:{" "}
            <a href="mailto:hola@aulia.ai" className="font-medium text-primary hover:underline">
              hola@aulia.ai
            </a>
          </p>
        </div>
      )}

      {/* Burbuja: en móvil se esconde con el sheet abierto (el sheet ya trae
          cierre + backdrop + Escape); en desktop queda como toggle. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar soporte" : "Abrir soporte"}
        className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-50 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform hover:scale-105 ${
          open ? "hidden sm:grid" : "grid"
        } size-14`}
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  );
}
