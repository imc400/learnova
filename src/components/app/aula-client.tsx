"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, MicOff, PhoneOff, GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endClassAction } from "@/server/actions/live";

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
}: AulaProps) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);

  const conversation = useConversation({
    onConnect: (props: { conversationId?: string }) => {
      startedAtRef.current = Date.now();
      if (props?.conversationId) conversationIdRef.current = props.conversationId;
    },
    onDisconnect: () => {
      void finishClass();
    },
    onError: (message) => {
      console.error("[aula]", message);
      setError("Se cortó la conexión con tu profesor. Puedes volver a entrar desde tu ruta.");
      void finishClass();
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

  // Conexión al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
        });
        if (!cancelled && !conversationIdRef.current) {
          // Fallback: el id también está disponible en el objeto de conversación.
          const maybeId = (conversation as { getId?: () => string | undefined }).getId?.();
          if (maybeId) conversationIdRef.current = maybeId;
        }
      } catch (e) {
        console.error("[aula] no se pudo iniciar:", e);
        setError(
          "No pudimos iniciar la clase. Revisa el permiso del micrófono y vuelve a intentarlo.",
        );
      }
    })();
    return () => {
      cancelled = true;
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
    <div className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
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
          onClick={() => void conversation.endSession()}
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
  );
}
