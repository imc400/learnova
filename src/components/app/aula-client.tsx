"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ArrowLeft, Mic, MicOff, PhoneOff, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
/** La clase de bienvenida es corta: cap duro propio (~12 min). */
const MAX_INDUCTION_SECONDS = 12 * 60;

const CONFIRM_END_MSG =
  "¿Terminar la clase? Se descuentan los minutos usados.";

interface AulaProps {
  sessionId: string;
  signedUrl: string;
  prompt: string;
  firstMessage: string;
  language: "es" | "en";
  teacherName: string;
  specialty: string;
  pathId: string;
  /** Título de la ruta, para el breadcrumb de vuelta. */
  pathTitle: string;
  /** Tipo de sesión: la inducción tiene cierre propio (popup en la ruta). */
  kind: "class" | "induction";
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
  pathTitle,
  kind,
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
  // Última frase del profesor (burbuja de transcripción, como el mock).
  const [agentLine, setAgentLine] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  // true cuando el cierre es INTENCIONAL (botón Terminar / corte de tiempo):
  // una desconexión inesperada (WiFi) intenta reconectar antes de rendirse.
  const endRequestedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

  const maxSeconds = kind === "induction" ? MAX_INDUCTION_SECONDS : MAX_CLASS_SECONDS;

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
    onMessage: ({ message, source }: { message: string; source: string }) => {
      // Transcripción del profesor (el SDK la expone por mensaje): la última
      // frase se muestra como burbuja bajo la onda de voz.
      if (source === "ai" && typeof message === "string" && message.trim()) {
        setAgentLine(message.trim());
      }
    },
    onDisconnect: (details?: { reason?: string }) => {
      // Cierre pedido por el usuario, el timer, o el PROFESOR (end_call al
      // despedirse o ante abuso) → ritual normal, jamás reconectar.
      const reason = details?.reason;
      if (
        endRequestedRef.current ||
        endedRef.current ||
        reason === "agent" ||
        reason === "user"
      ) {
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
    router.push(
      `/app/rutas/${pathId}?${kind === "induction" ? "induccion" : "clase"}=finalizada`,
    );
  }, [sessionId, pathId, kind, router]);

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

  // Timer + corte duro (30 min clase / ~12 min bienvenida; el prompt cierra
  // ritualmente antes).
  useEffect(() => {
    const t = setInterval(() => {
      if (!startedAtRef.current) return;
      const sec = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(sec);
      if (sec >= maxSeconds) {
        endRequestedRef.current = true;
        void conversation.endSession();
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxSeconds]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const connected = conversation.status === "connected";
  const speaking = conversation.isSpeaking;
  const live = connected && !ending;

  // Guard de salida: cerrar/recargar la pestaña con la clase viva pide
  // confirmación del navegador (los minutos se descuentan al salir).
  useEffect(() => {
    if (!live) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [live]);

  function requestEnd() {
    if (!window.confirm(CONFIRM_END_MSG)) return;
    endRequestedRef.current = true;
    void conversation.endSession();
  }

  return (
    <div>
      {/* Breadcrumb: oculto mientras la clase está viva (un clic accidental
          la terminaría); reaparece al no estar conectado. */}
      {!live ? (
        <Link
          href={`/app/rutas/${pathId}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {pathTitle}
        </Link>
      ) : (
        <p className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground">
          {pathTitle}
        </p>
      )}

      <div className={`mt-6 grid gap-4 ${boardVisible ? "lg:grid-cols-[1fr_minmax(280px,360px)]" : ""}`}>
      <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
        {/* Avatar del profesor con doble aura cuando la clase está en vivo
            (canon del mock de la landing). El loop muere al desconectar. */}
        <div className="relative">
          {live && (
            <>
              <span className="aura-ring absolute inset-[-8px]" aria-hidden="true" />
              <span className="aura-ring absolute inset-[-18px]" aria-hidden="true" />
            </>
          )}
          <div
            className={`relative grid size-28 place-items-center rounded-full border-4 transition-all duration-500 ${
              speaking
                ? "border-primary bg-primary/15"
                : connected
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted"
            }`}
          >
            <GraduationCap
              className={`size-12 ${connected ? "text-primary" : "text-muted-foreground"}`}
            />
          </div>
        </div>

        <h1 className="mt-5 font-display text-2xl font-bold">{teacherName}</h1>
        <p className="text-sm text-muted-foreground">{specialty}</p>
        {live && <Badge variant="primary" className="mt-2">en vivo</Badge>}

        <div className="mt-4 min-h-6 text-sm font-medium">
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
            // Onda de voz real (utilities del aula en vivo de la landing).
            <span className="flex flex-col items-center gap-1.5">
              <span className="flex h-6 items-center gap-1.5" aria-hidden="true">
                <span className="wave-bar h-6 w-1.5 bg-primary" />
                <span className="wave-bar h-6 w-1.5 bg-primary" />
                <span className="wave-bar h-6 w-1.5 bg-accent" />
                <span className="wave-bar h-6 w-1.5 bg-primary" />
              </span>
              <span className="sr-only">{teacherName} está hablando</span>
            </span>
          ) : (
            "Te está escuchando — habla con confianza"
          )}
        </div>

        {/* Permiso de micrófono denegado: reintentar sin recargar la página. */}
        {error && !connected && !ending && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setError(null);
              void startSessionRef.current?.().catch(() => {
                setError(
                  "No pudimos iniciar la clase. Revisa el permiso del micrófono y vuelve a intentarlo.",
                );
              });
            }}
          >
            <Mic className="size-4" /> Reintentar con micrófono
          </Button>
        )}

        {/* Burbuja de transcripción del profesor (canon del mock del aula). */}
        {live && agentLine && (
          <div
            aria-live="polite"
            className="mt-4 w-full max-w-md rounded-lg rounded-tl-sm bg-muted px-4 py-3 text-left text-sm"
          >
            {agentLine}
          </div>
        )}

        {connected && (
          <p className="mt-3 font-display text-3xl font-bold tabular-nums text-primary">
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
            onClick={requestEnd}
            disabled={ending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            <PhoneOff className="size-4" /> Terminar clase
          </Button>
        </div>

        <p className="mt-6 max-w-sm text-xs text-muted-foreground">
          {kind === "induction"
            ? "Al terminar recibirás un correo con el resumen. La clase de bienvenida dura unos 10 minutos."
            : "Al terminar recibirás un correo con el resumen de la clase y tus tareas. La clase dura hasta 25-30 minutos."}
        </p>
      </div>

      {/* PIZARRA — controlada por el profesor con sus herramientas */}
      {boardVisible && (
        <aside className="ruled rounded-2xl border border-primary/30 bg-card p-5 shadow-soft">
          <p className="hand text-lg">pizarra de {teacherName} ✺</p>
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
    </div>
  );
}
