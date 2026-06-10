"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, MicOff, PhoneOff, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  endClassAction,
  proposeModuleAction,
  attachConversationAction,
} from "@/server/actions/live";

/*
  Cliente del aula: conversación de voz con el profesor IA.
  El prompt con el brief viene del SERVIDOR (overrides); aquí solo se conecta,
  se muestra el estado y se cierra la clase con ritual.
*/

const MAX_CLASS_SECONDS = 30 * 60;

interface AulaProps {
  sessionId: string;
  signedUrl: string;
  prompt: string;
  firstMessage: string;
  language: "es" | "en";
  teacherName: string;
  specialty: string;
  pathId: string;
  /** Mapa de la ruta para la PIZARRA que el profesor controla en vivo. */
  outline: { title: string; lessons: string[] }[];
}

export function AulaClient(props: AulaProps) {
  return (
    <ConversationProvider>
      <AulaInner {...props} />
    </ConversationProvider>
  );
}

function AulaInner({
  sessionId,
  signedUrl,
  prompt,
  firstMessage,
  language,
  teacherName,
  specialty,
  pathId,
  outline,
}: AulaProps) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PIZARRA: el profesor la abre y enfoca módulos con sus client tools.
  const [boardVisible, setBoardVisible] = useState(false);
  const [focusedModule, setFocusedModule] = useState<number | null>(null);
  // Módulos que el profesor agregó EN VIVO (se generan al cerrar la clase).
  const [addedModules, setAddedModules] = useState<string[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  // true cuando el cierre es INTENCIONAL (botón Terminar / corte de 30 min):
  // una desconexión inesperada (WiFi) intenta reconectar antes de rendirse.
  const endRequestedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

  const conversation = useConversation({
    onConnect: (props: { conversationId?: string }) => {
      startedAtRef.current = startedAtRef.current ?? Date.now();
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      if (props?.conversationId) {
        conversationIdRef.current = props.conversationId;
        // Persistir YA: si el alumno refresca o se cae el WiFi, el resumen
        // post-clase igual encuentra la transcripción.
        void attachConversationAction(sessionId, props.conversationId).catch(
          () => {},
        );
      }
    },
    onDisconnect: () => {
      // Cierre pedido por el usuario o timer → ritual normal.
      if (endRequestedRef.current || endedRef.current) {
        void finishClass();
        return;
      }
      // Desconexión INESPERADA (WiFi inestable): hasta 2 reintentos con pausa
      // antes de cerrar la clase de verdad.
      if (reconnectAttemptsRef.current < 2 && startSessionRef.current) {
        reconnectAttemptsRef.current += 1;
        setReconnecting(true);
        setTimeout(() => {
          if (endedRef.current) return;
          void startSessionRef.current?.().catch(() => {
            setReconnecting(false);
            void finishClass();
          });
        }, 2500);
        return;
      }
      void finishClass();
    },
    onError: (message) => {
      // Errores transitorios del stream NO terminan la clase: solo es fatal si
      // nunca llegó a conectar (el caso real: permiso de micrófono denegado).
      console.error("[aula]", message);
      if (!startedAtRef.current) {
        setError(
          "No pudimos iniciar la clase. Revisa el permiso del micrófono y vuelve a intentarlo.",
        );
      }
    },
  });

  const finishClass = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnding(true);
    const durationSec = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : 0;
    try {
      await endClassAction(sessionId, conversationIdRef.current, durationSec);
    } catch (e) {
      console.error("[aula] cierre falló:", e);
    }
    router.push(`/app/rutas/${pathId}?clase=finalizada`);
  }, [sessionId, pathId, router]);

  // Conexión al montar (y reconexión ante caídas de WiFi).
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      await conversation.startSession({
          signedUrl,
          connectionType: "websocket",
          overrides: {
            agent: {
              prompt: { prompt },
              firstMessage,
              language,
            },
          },
          // PIZARRA: el profesor llama estas tools y la UI reacciona en vivo.
          clientTools: {
            mostrar_ruta: async () => {
              setBoardVisible(true);
              setFocusedModule(null);
              return "Pizarra visible con el mapa completo de la ruta.";
            },
            enfocar_modulo: async (params: { moduleIndex?: number }) => {
              const raw = Number(params?.moduleIndex ?? 0);
              // Clamp al rango real: el profesor a veces cuenta desde 1.
              const idx = Math.max(
                0,
                Math.min(Number.isFinite(raw) ? raw : 0, outline.length - 1),
              );
              setBoardVisible(true);
              setFocusedModule(idx);
              return `Módulo ${idx + 1} (${outline[idx]?.title ?? ""}) enfocado en la pizarra.`;
            },
            agregar_modulo: async (params: { titulo?: string; razon?: string }) => {
              const titulo = String(params?.titulo ?? "").trim();
              const razon = String(params?.razon ?? "").trim();
              if (!titulo) return "Falta el título del módulo.";
              try {
                const res = await proposeModuleAction(sessionId, titulo, razon);
                if (res.ok) {
                  setBoardVisible(true);
                  setAddedModules((prev) =>
                    prev.includes(titulo) ? prev : [...prev, titulo],
                  );
                  return `Listo: el módulo "${titulo}" quedó agendado. Se generará al terminar la clase y al alumno le llegará un correo cuando esté disponible.`;
                }
                return `No se pudo agendar: ${res.message}.`;
              } catch {
                return "Hubo un error al agendar el módulo. Continúa la clase y dile al alumno que lo intentaremos de nuevo.";
              }
            },
          },
        });
        if (!cancelled && !conversationIdRef.current) {
          // Fallback: el id también está disponible en el objeto de conversación.
          const maybeId = (conversation as { getId?: () => string | undefined }).getId?.();
          if (maybeId) {
            conversationIdRef.current = maybeId;
            void attachConversationAction(sessionId, maybeId).catch(() => {});
          }
        }
    };
    startSessionRef.current = start;
    start().catch((e) => {
      console.error("[aula] no se pudo iniciar:", e);
      setError(
        "No pudimos iniciar la clase. Revisa el permiso del micrófono y vuelve a intentarlo.",
      );
    });
    return () => {
      cancelled = true;
      endRequestedRef.current = true;
      void conversation.endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer + corte duro a los 30 min (el prompt cierra ritualmente antes).
  useEffect(() => {
    const t = setInterval(() => {
      if (!startedAtRef.current) return;
      const sec = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(sec);
      if (sec >= MAX_CLASS_SECONDS) {
        endRequestedRef.current = true;
        void conversation.endSession();
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const connected = conversation.status === "connected";
  const speaking = conversation.isSpeaking;

  return (
    <div className={`mt-6 grid gap-4 ${boardVisible ? "lg:grid-cols-[1fr_minmax(280px,360px)]" : ""}`}>
    <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
      {/* Avatar del profesor con aura según estado */}
      <div
        className={`grid size-28 place-items-center rounded-full border-4 transition-all duration-500 ${
          speaking
            ? "border-primary bg-primary/15 shadow-[0_0_40px_-8px_var(--color-primary)]"
            : connected
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-muted"
        }`}
      >
        <GraduationCap
          className={`size-12 ${connected ? "text-primary" : "text-muted-foreground"}`}
        />
      </div>

      <h1 className="mt-5 font-display text-2xl font-bold">{teacherName}</h1>
      <p className="text-sm text-muted-foreground">{specialty}</p>

      <p className="mt-4 text-sm font-medium">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : ending ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cerrando la clase y
            preparando tu resumen…
          </span>
        ) : reconnecting ? (
          <span className="flex items-center gap-2 text-accent-foreground">
            <Loader2 className="size-4 animate-spin" /> Se cortó la conexión —
            reconectando con tu profesor…
          </span>
        ) : !connected ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Conectando con tu
            profesor…
          </span>
        ) : speaking ? (
          `${teacherName} está hablando…`
        ) : (
          "Te está escuchando — habla con confianza"
        )}
      </p>

      {connected && (
        <p className="mt-2 font-display text-3xl font-bold tabular-nums text-primary">
          {mm}:{ss}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={conversation.isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          onClick={() => conversation.setMuted(!conversation.isMuted)}
          disabled={!connected || ending}
        >
          {conversation.isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            endRequestedRef.current = true;
            void conversation.endSession();
          }}
          disabled={ending}
          className="bg-destructive text-white hover:bg-destructive/90"
        >
          <PhoneOff className="size-4" /> Terminar clase
        </Button>
      </div>

      <p className="mt-6 max-w-sm text-xs text-muted-foreground">
        Al terminar recibirás un correo con el resumen de la clase y tus tareas.
        La clase dura hasta 25-30 minutos.
      </p>
    </div>

    {/* PIZARRA — controlada por el profesor con sus herramientas */}
    {boardVisible && (
      <aside className="rounded-2xl border border-primary/30 bg-card p-5 shadow-soft">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
          📋 Pizarra de {teacherName}
        </p>
        <ol className="mt-3 space-y-2">
          {outline.map((m, i) => {
            const focused = focusedModule === i;
            return (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 transition-all duration-300 ${
                  focused
                    ? "border-primary bg-primary/10 shadow-soft"
                    : focusedModule !== null
                      ? "border-border opacity-50"
                      : "border-border"
                }`}
              >
                <p className={`text-sm font-semibold ${focused ? "text-primary" : ""}`}>
                  {i + 1}. {m.title}
                </p>
                {focused && (
                  <ul className="mt-1.5 space-y-0.5">
                    {m.lessons.map((l, li) => (
                      <li key={li} className="text-xs text-muted-foreground">
                        · {l}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {addedModules.map((t, i) => (
            <li
              key={`added-${i}`}
              className="rounded-lg border border-dashed border-primary/50 bg-primary/5 px-3 py-2"
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <Sparkles className="size-3.5" /> {outline.length + i + 1}. {t}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nuevo — tu profesor lo está agregando a tu ruta
              </p>
            </li>
          ))}
        </ol>
      </aside>
    )}
    </div>
  );
}
