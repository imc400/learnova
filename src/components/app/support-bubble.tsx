"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

/*
  Burbuja de SOPORTE en vivo — flotante, marca Cuaderno. Chat con el agente
  experto (/api/soporte). Sin dependencias, accesible, móvil-friendly.
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

const FALLBACK = "Se nos cortó — escríbenos a hola@aulia.ai y lo vemos al tiro.";

export function SupportBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Al abrir: foco al input. Escape cierra desde cualquier parte del panel.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setSending(true);
    try {
      const res = await fetch("/api/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(1) }), // sin el saludo local
      });
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply ?? FALLBACK },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: FALLBACK }]);
    } finally {
      setSending(false);
    }
  };

  // En la lección, la esquina inferior derecha es del FAB del profesor
  // (lesson-tutor.tsx): soporte se esconde ahí — la opción menos invasiva
  // (cero cambios al layout del shell; este componente ya es client).
  // OJO: el return va DESPUÉS de todos los hooks (orden estable).
  if (/^\/app\/rutas\/[^/]+\/leccion\//.test(pathname ?? "")) return null;

  return (
    <>
      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Chat de soporte de Aulia"
          className="fixed bottom-24 right-4 z-50 flex h-[28rem] max-h-[min(28rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lift"
        >
          <div className="flex items-center justify-between bg-primary px-4 py-2 text-primary-foreground">
            <div>
              <p className="font-display text-sm font-bold">Soporte Aulia</p>
              <p className="text-xs opacity-80">Respuesta al instante</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="grid size-11 place-items-center rounded-full hover:bg-white/15"
            >
              <X className="size-4" />
            </button>
          </div>

          <div ref={listRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> escribiendo…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-border p-3 pb-1.5"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu duda…"
              maxLength={500}
              className="h-10 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
          <p className="px-4 pb-2 text-center text-[11px] text-muted-foreground">
            Hay un humano detrás:{" "}
            <a href="mailto:hola@aulia.ai" className="font-medium text-primary hover:underline">
              hola@aulia.ai
            </a>
          </p>
        </div>
      )}

      {/* Burbuja */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar soporte" : "Abrir soporte"}
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform hover:scale-105"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  );
}
