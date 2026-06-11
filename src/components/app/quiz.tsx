"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, ArrowRight, GraduationCap } from "lucide-react";
import { Flame, Play } from "@/components/marketing/landing/icons";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { CelebracionStickers } from "@/components/app/brand/celebracion-stickers";
import { ModuleRating } from "@/components/app/module-rating";
import { RichText } from "@/components/app/rich-text";
import { SubmitButton } from "@/components/app/submit-button";
import { mmss, requestVideoSeek } from "@/components/app/youtube-embed";
import { cn } from "@/lib/utils";
import {
  gradeQuizAction,
  type GradeResult,
} from "@/server/actions/quiz";
import { startClassAction } from "@/server/actions/live";

interface QuizQuestion {
  id: string;
  type: "single" | "multiple" | "open";
  prompt: string;
  options: { id: string; text: string }[];
}

export function Quiz({
  quizId,
  questions,
  hasVideo = true,
}: {
  quizId: string;
  questions: QuizQuestion[];
  /** Si la lección no tiene video, el chip "El video lo explica" no se muestra. */
  hasVideo?: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Regla del "una vez": la ráfaga de stickers anima SOLO al recibir el
  // resultado; si el usuario reintenta y vuelve a aprobar, no se re-anima.
  const [yaCelebrado, setYaCelebrado] = useState(false);

  function toggle(qId: string, optId: string, multiple: boolean) {
    setAnswers((prev) => {
      const cur = prev[qId] ?? [];
      if (multiple) {
        return {
          ...prev,
          [qId]: cur.includes(optId)
            ? cur.filter((x) => x !== optId)
            : [...cur, optId],
        };
      }
      return { ...prev, [qId]: [optId] };
    });
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const r = await gradeQuizAction(quizId, answers);
      setResult(r);
      // Refresca los server components (barras de avance, header) tras aprobar.
      if (r.passed) router.refresh();
    } catch {
      setError(
        "No pudimos corregir el quiz — tus respuestas siguen aquí. Revisa tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setLoading(false);
    }
  }

  function retry() {
    if (result?.passed || result?.gamification) setYaCelebrado(true);
    setResult(null);
    setAnswers({});
    setError(null);
  }

  const resultByQ = new Map(result?.results.map((r) => [r.questionId, r]));
  const g = result?.gamification ?? null;

  // Ráfaga R5: máx. 3 chips — XP (accent), racha (outline), logro/nivel (primary).
  const stickers: { contenido: ReactNode; variant?: "accent" | "primary" | "outline" }[] = [];
  if (g) {
    if (g.xpGained > 0) stickers.push({ contenido: <>+{g.xpGained} XP</> });
    if (g.streakExtended && g.streak > 1)
      stickers.push({
        contenido: (
          <>
            <Flame size={14} /> Racha: {g.streak} días
          </>
        ),
        variant: "outline",
      });
    const logro = g.newAchievements[0];
    if (logro) {
      stickers.push({ contenido: <>Logro nuevo: {logro.title}</>, variant: "primary" });
    } else if (g.levelUp) {
      stickers.push({ contenido: <>Subiste al nivel {g.levelUp}</>, variant: "primary" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {result && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            result.passed
              ? "border-primary/30 bg-primary/5"
              : "border-accent bg-highlight-soft"
          }`}
        >
          <p className={result.passed ? "font-semibold text-primary" : "font-medium text-accent-foreground"}>
            Obtuviste {Math.round(result.score * 100)}%.{" "}
            {result.passed
              ? "¡Aprobado! La lección quedó completada."
              : "Repasa y vuelve a intentarlo — el video y los apuntes siguen aquí arriba."}
          </p>

          {stickers.length > 0 && (
            <CelebracionStickers stickers={stickers} animar={!yaCelebrado} />
          )}

          {/* Cierre de ruta: el CTA domina; el rating del módulo va debajo. */}
          {g?.pathCompleted && (
            <div className="mt-3">
              <p className="font-display text-base">
                ¡<span className="hl-draw animate-draw-underline">Terminaste</span>{" "}
                la ruta <strong>{g.pathCompleted.title}</strong>! Enorme.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href={`/app/rutas/${g.pathCompleted.id}`}>
                  Ver mi siguiente paso <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          )}

          {g?.moduleCompleted && (
            <div className="mt-3">
              <p className="text-sm">
                Completaste el módulo <strong>{g.moduleCompleted.title}</strong>.
              </p>
              {/* Pico emocional = el mejor momento para pedir feedback (peak-end). */}
              <ModuleRating moduleId={g.moduleCompleted.id} />
            </div>
          )}
        </div>
      )}

      {/* Puente quiz trabado → clase en vivo (2+ intentos reprobados): el
          producto diseñado para destrabarse, en el momento exacto de la traba.
          La elegibilidad real la valida startClassAction server-side. */}
      {result && !result.passed && result.classBridge && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-start gap-2 text-sm font-medium">
            <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
            Esto se conversa mejor que se relee. Tu profesor ya sabe qué
            preguntas te costaron — una clase de 25 min puede destrabarlo.
          </p>
          {result.classBridge.cta === "clase" ? (
            <form
              action={startClassAction.bind(null, result.classBridge.pathId, "class")}
              className="mt-3"
            >
              <SubmitButton variant="primary" size="sm" pendingText="Preparando tu clase…">
                <GraduationCap className="size-4" /> Iniciar clase con mi profesor
              </SubmitButton>
            </form>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Usaste los minutos de clase de esta ruta. Con Aulia Pro tienes
                120 minutos al mes, con todos tus profesores.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/app/planes?source=quiz_trabado">Conocer Aulia Pro</Link>
              </Button>
            </>
          )}
        </div>
      )}

      {questions.map((q, qi) => {
        const r = resultByQ.get(q.id);
        return (
          <div key={q.id} className="rounded-md border border-border bg-card p-4">
            <p className="font-medium">
              {qi + 1}. {q.prompt}
            </p>

            {q.type === "open" ? (
              <>
                <textarea
                  rows={3}
                  disabled={!!result}
                  value={answers[q.id]?.[0] ?? ""}
                  onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: [e.target.value] }))}
                  className="mt-3 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none"
                  placeholder="Escribe tu respuesta…"
                />
                {r ? (
                  <p
                    className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
                      r.correct ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {r.correct ? (
                      <>
                        <Check className="size-3.5" /> Respuesta registrada — cuenta
                        para tu avance.
                      </>
                    ) : (
                      <>
                        <X className="size-3.5" /> Quedó muy corta: escribe al menos
                        20 caracteres para que cuente.
                      </>
                    )}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Respuestas de 20+ caracteres cuentan.
                  </p>
                )}
              </>
            ) : (
              <ul className="mt-3 space-y-2">
                {q.options.map((opt) => {
                  const selected = (answers[q.id] ?? []).includes(opt.id);
                  const isCorrect = r?.correctOptionIds.includes(opt.id);
                  return (
                    <li key={opt.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 text-sm transition-colors ${
                          result
                            ? isCorrect
                              ? "border-primary/50 bg-primary/5"
                              : selected
                                ? "border-destructive/50 bg-destructive/5"
                                : "border-border"
                            : selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted"
                        }`}
                      >
                        <input
                          type={q.type === "multiple" ? "checkbox" : "radio"}
                          name={q.id}
                          checked={selected}
                          disabled={!!result}
                          onChange={() => toggle(q.id, opt.id, q.type === "multiple")}
                          className="accent-primary"
                        />
                        <span className="flex-1">{opt.text}</span>
                        {result && isCorrect && <Check className="size-4 text-primary" />}
                        {result && selected && !isCorrect && (
                          <X className="size-4 text-destructive" />
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {r && (r.explanation || r.timestampSeconds != null) && (
              <div className="mt-3 rounded-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                {r.explanation && <RichText text={r.explanation} />}
                {/* La promesa de la landing: el quiz cita el minuto del video. */}
                {hasVideo && r.timestampSeconds != null && (
                  <button
                    type="button"
                    onClick={() => requestVideoSeek(r.timestampSeconds!)}
                    title={`Ver en el video en ${mmss(r.timestampSeconds)}`}
                    className={cn(
                      badgeVariants({ variant: "accent" }),
                      "mt-2 min-h-11 cursor-pointer px-3.5 text-sm transition-colors hover:bg-accent/25",
                    )}
                  >
                    <Play size={12} className="shrink-0" /> El video lo explica en{" "}
                    {mmss(r.timestampSeconds)}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <X className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-muted-foreground">{error}</p>
        </div>
      )}

      {!result ? (
        <Button onClick={submit} disabled={loading} className="self-start">
          {loading && <Loader2 className="size-4 animate-spin" />}
          Revisar respuestas
        </Button>
      ) : !result.passed ? (
        <Button onClick={retry} variant="outline" className="self-start">
          Intentar de nuevo
        </Button>
      ) : null}
    </div>
  );
}
