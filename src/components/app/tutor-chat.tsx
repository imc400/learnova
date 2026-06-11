"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TutorMsg = { role: "user" | "assistant"; content: string };

/** Avatar mini del profesor: inicial en círculo (como el chip del aula). */
function TeacherAvatar({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-display text-sm font-semibold text-primary",
        className,
      )}
    >
      {(name ?? "Tutor").trim().charAt(0).toUpperCase()}
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

export function TutorChat({
  context,
  lessonId,
  teacherName = null,
  suggestions = [],
  initialMessages = [],
  className,
  headerClassName,
}: {
  context: string;
  lessonId?: string;
  teacherName?: string | null;
  suggestions?: string[];
  initialMessages?: TutorMsg[];
  className?: string;
  headerClassName?: string;
}) {
  const [messages, setMessages] = useState<TutorMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const next: TutorMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // El API acota a los últimos 12 turnos: mandar más es pagar upload inútil.
        body: JSON.stringify({ messages: next.slice(-12), context, lessonId }),
      });
      if (!res.body) throw new Error("Sin stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content:
            "Se nos cortó la conexión — no se perdió tu pregunta, inténtalo de nuevo.",
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div
      className={cn(
        "flex h-[28rem] flex-col rounded-lg border border-border bg-card",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border px-4 py-3",
          headerClassName,
        )}
      >
        <TeacherAvatar name={teacherName} />
        <span className="text-sm font-medium">
          {teacherName ?? "Tu tutor"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Pregúntame lo que sea sobre esta lección. Estoy aquí para ayudarte.
            </p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-sm border border-border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <TeacherAvatar name={teacherName} className="size-6 text-xs" />
              )}
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-md px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-primary/10 text-foreground"
                    : "border border-border bg-card text-foreground shadow-soft"
                }`}
              >
                {m.content || <TypingDots />}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu pregunta…"
          disabled={streaming}
          className="text-base" /* 16px: iOS no hace zoom al enfocar */
        />
        <Button type="submit" size="icon" disabled={streaming || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
