"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ArrowLeft, Mic, MicOff, PhoneOff, GraduationCap, Loader2, Sparkles, CalendarCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  endClassAction,
  proposeModuleAction,
  attachConversationAction,
  markHomeworkFromClassAction,
  scheduleNextClassAction,
  recordLearningAction,
  adjustDifficultyAction,
} from "@/server/actions/live";

/*
  Cliente del aula: conversación de voz con el profesor IA.
  En modo SEGURO el prompt jamás llega aquí (initiation webhook server-side);
  en modo legado viaja como override. El cliente además le da al profesor su
  noción del tiempo (avisos [SISTEMA]) y ejecuta sus client tools (pizarra,
  tareas, video, agenda).
*/

const MAX_CLASS_SECONDS = 30 * 60;
/** La clase de bienvenida es corta: cap duro propio (~12 min). */
const MAX_INDUCTION_SECONDS = 12 * 60;

const CONFIRM_END_MSG =
  "¿Terminar la clase? Se descuentan los minutos usados.";

/** Avisos [SISTEMA]: el LLM no ve reloj — sin esto, el corte duro lo mata a
 *  mitad de frase y el destilador inventa tareas que nadie dijo en voz alta. */
const CLASS_MILESTONES: { at: number; msg: string }[] = [
  { at: 15 * 60, msg: "[SISTEMA] Quedan 10 minutos de clase." },
  {
    at: 21 * 60,
    msg: "[SISTEMA] Quedan 4 minutos: inicia el CIERRE ahora — pregunta metacognitiva, asigna las tareas en voz alta y despídete con end_call.",
  },
  { at: 27 * 60, msg: "[SISTEMA] Tiempo cumplido: despídete en este turno y usa end_call." },
];
const INDUCTION_MILESTONES: { at: number; msg: string }[] = [
  { at: 6 * 60, msg: "[SISTEMA] Quedan 6 minutos de la inducción." },
  {
    at: 9 * 60,
    msg: "[SISTEMA] Quedan 3 minutos: pasa al PRIMER PASO + CIERRE — deja la primera tarea, avisa del correo y despídete con end_call.",
  },
  { at: 11 * 60, msg: "[SISTEMA] Tiempo cumplido: despídete en este turno y usa end_call." },
];

interface OutlineModule {
  title: string;
  /** Lecciones con su video curado (para la tool mostrar_video). */
  lessons: { title: string; videoId: string | null }[];
}

interface AulaProps {
  sessionId: string;
  signedUrl: string;
  /** true = el prompt vive en el servidor (initiation webhook); aquí llegan
   *  prompt/firstMessage vacíos y NO se envían overrides. */
  secureInitiation: boolean;
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
  outline: OutlineModule[];
  /** Tareas pendientes en el MISMO orden numerado que el brief (marcar_tarea). */
  homework: { id: string; task: string }[];
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
  secureInitiation,
  prompt,
  firstMessage,
  language,
  teacherName,
  specialty,
  pathId,
  pathTitle,
  kind,
  outline,
  homework,
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
  // Tareas que el profesor tachó EN VIVO (marcar_tarea, índices 1..N).
  const [markedTasks, setMarkedTasks] = useState<Set<number>>(new Set());
  // Video que el profesor puso en la pizarra (mostrar_video) — pausado.
  const [videoEmbed, setVideoEmbed] = useState<{ videoId: string; title: string } | null>(null);
  // Próxima clase agendada en vivo (agendar_proxima_clase).
  const [scheduledNote, setScheduledNote] = useState<string | null>(null);
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
  // Hitos de tiempo ya avisados (no repetir tras reconexión).
  const sentMilestonesRef = useRef<Set<number>>(new Set());

  const maxSeconds = kind === "induction" ? MAX_INDUCTION_SECONDS : MAX_CLASS_SECONDS;
  const milestones = kind === "induction" ? INDUCTION_MILESTONES : CLASS_MILESTONES;

  const conversation = useConversation({
    onConnect: (props: { conversationId?: string }) => {
      startedAtRef.current = startedAtRef.current ?? Date.now();
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      // El SDK puede emitir un error transitorio ANTES de conectar (p. ej.
      // mientras el navegador muestra el prompt del micrófono): si al final
      // la conexión triunfa, ese mensaje rojo era falso — se limpia aquí.
      setError(null);
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
          // Modo SEGURO: cero overrides — ElevenLabs pide el prompt + saludo
          // a nuestro webhook con este session_id (UUID no adivinable).
          // Modo legado: overrides como siempre (el prompt vino del server).
          dynamicVariables: { session_id: sessionId },
          ...(secureInitiation
            ? {}
            : {
                overrides: {
                  agent: {
                    prompt: { prompt },
                    firstMessage,
                    language,
                  },
                },
              }),
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
            marcar_tarea: async (params: { taskIndex?: number }) => {
              const idx = Math.round(Number(params?.taskIndex ?? 0));
              const item = homework[idx - 1];
              if (!item) {
                return `No existe la tarea ${idx}: las tareas pendientes van de 1 a ${homework.length}.`;
              }
              try {
                const res = await markHomeworkFromClassAction(sessionId, item.id);
                if (res.ok) {
                  setBoardVisible(true);
                  setMarkedTasks((prev) => new Set(prev).add(idx));
                  return `Tarea ${idx} ("${item.task}") tachada en la pizarra del alumno.`;
                }
                return `No se pudo marcar: ${res.message}.`;
              } catch {
                return "Hubo un error al marcar la tarea. Continúa la clase.";
              }
            },
            agendar_proxima_clase: async (params: { dias?: number }) => {
              const dias = Math.round(Number(params?.dias ?? 0));
              if (!dias || dias < 1 || dias > 14) {
                return "No se pudo agendar: los días deben estar entre 1 y 14.";
              }
              try {
                const res = await scheduleNextClassAction(sessionId, dias);
                if (res.ok) {
                  setScheduledNote(res.message);
                  return res.message;
                }
                return `No se pudo agendar: ${res.message}.`;
              } catch {
                return "Hubo un error al agendar la próxima clase. Dile al alumno que puede volver cuando quiera.";
              }
            },
            registrar_aprendizaje: async (params: { resumen?: string }) => {
              const resumen = String(params?.resumen ?? "").trim();
              if (!resumen) return "Falta el resumen del aprendizaje.";
              try {
                const res = await recordLearningAction(sessionId, resumen);
                return res.ok ? res.message : `No se pudo registrar: ${res.message}.`;
              } catch {
                return "Hubo un error al registrar el aprendizaje. Continúa el cierre.";
              }
            },
            mostrar_video: async (params: { moduleIndex?: number; lessonIndex?: number }) => {
              const mi = Math.max(
                0,
                Math.min(Math.round(Number(params?.moduleIndex ?? 0)), outline.length - 1),
              );
              const lessonsOf = outline[mi]?.lessons ?? [];
              const li = Math.max(
                0,
                Math.min(Math.round(Number(params?.lessonIndex ?? 0)), lessonsOf.length - 1),
              );
              const lesson = lessonsOf[li];
              if (!lesson?.videoId) {
                return `La lección "${lesson?.title ?? "indicada"}" no tiene video disponible — descríbelo en voz alta en su lugar.`;
              }
              setBoardVisible(true);
              setFocusedModule(mi);
              setVideoEmbed({ videoId: lesson.videoId, title: lesson.title });
              return `Video de "${lesson.title}" visible en la pizarra (pausado: el alumno decide cuándo verlo).`;
            },
            ajustar_dificultad: async (params: { direccion?: string; motivo?: string }) => {
              const direccion = String(params?.direccion ?? "").trim();
              const motivo = String(params?.motivo ?? "").trim();
              try {
                const res = await adjustDifficultyAction(sessionId, direccion, motivo);
                return res.ok ? res.message : `No se pudo ajustar: ${res.message}.`;
              } catch {
                return "Hubo un error al ajustar la dificultad. Continúa la clase.";
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

  // Timer + avisos [SISTEMA] + corte duro (30 min clase / ~12 min bienvenida).
  // Los avisos le dan al profesor su noción del tiempo: el prompt cierra
  // ritualmente (tareas en voz alta + despedida) y el corte queda de último
  // recurso. ElevenLabs además corta server-side a los 31 min.
  useEffect(() => {
    const t = setInterval(() => {
      if (!startedAtRef.current) return;
      const sec = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(sec);
      for (const m of milestones) {
        if (sec >= m.at && !sentMilestonesRef.current.has(m.at)) {
          sentMilestonesRef.current.add(m.at);
          try {
            conversation.sendContextualUpdate(m.msg);
          } catch (e) {
            console.error("[aula] aviso de tiempo falló:", e);
          }
        }
      }
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
          <ArrowLeft className="size-4 shrink-0" /> {pathTitle}
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
          {/* `&& !connected`: el error de arranque solo es real si NO hay
              conexión viva — conectado, lo que manda es el estado en vivo. */}
          {error && !connected ? (
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
            className="mt-4 w-full max-w-md break-words rounded-lg rounded-tl-sm bg-muted px-4 py-3 text-left text-sm"
          >
            {agentLine}
          </div>
        )}

        {/* Próxima clase agendada en vivo por el profesor. */}
        {scheduledNote && (
          <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-primary">
            <CalendarCheck className="mt-0.5 size-3.5 shrink-0" /> {scheduledNote}
          </p>
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

          {/* Video que el profesor dejó señalado (pausado — sin autoplay). */}
          {videoEmbed && (
            <div className="mt-3">
              <div className="aspect-video overflow-hidden rounded-lg border border-border">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${videoEmbed.videoId}`}
                  title={videoEmbed.title}
                  className="size-full"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Tu profesor te dejó este video: {videoEmbed.title}
              </p>
            </div>
          )}

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
                          · {l.title}
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

          {/* Tareas pendientes: el profesor las tacha EN VIVO (marcar_tarea). */}
          {homework.length > 0 && (
            <div className="mt-4">
              <p className="hand text-base">tus tareas ✺</p>
              <ol className="mt-1.5 space-y-1">
                {homework.map((h, i) => {
                  const done = markedTasks.has(i + 1);
                  return (
                    <li
                      key={h.id}
                      className={`flex items-start gap-1.5 text-xs transition-all duration-300 ${
                        done ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {done ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span className="mt-0.5 inline-block size-3.5 shrink-0 rounded-sm border border-border" />
                      )}
                      <span className="min-w-0 break-words">
                        {i + 1}. {h.task}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </aside>
      )}
      </div>
    </div>
  );
}
