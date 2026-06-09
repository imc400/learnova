"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Flame, Trophy, Zap, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  gradeQuizAction,
  type GradeResult,
} from "@/server/actions/quiz";

interface QuizQuestion {
  id: string;
  type: "single" | "multiple" | "open";
  prompt: string;
  options: { id: string; text: string }[];
}

export function Quiz({
  quizId,
  questions,
}: {
  quizId: string;
  questions: QuizQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        "No pudimos corregir el quiz. Revisa tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setLoading(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    setError(null);
  }

  const resultByQ = new Map(result?.results.map((r) => [r.questionId, r]));
  const g = result?.gamification ?? null;

  return (
    <div className="flex flex-col gap-6">
      {result && (
        <div
          className={`rounded-md px-4 py-3 text-sm font-medium ${
            result.passed
              ? "bg-primary/10 text-primary"
              : "bg-accent/15 text-accent-foreground"
          }`}
        >
          <p>
            Obtuviste {Math.round(result.score * 100)}%.{" "}
            {result.passed
              ? "¡Aprobado! La lección quedó completada. 🎉"
              : "Repasa y vuelve a intentarlo."}
          </p>

          {g && (g.xpGained > 0 || g.newAchievements.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {g.xpGained > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                  <Zap className="size-3.5" /> +{g.xpGained} XP
                </span>
              )}
              {g.levelUp && (
                <span className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                  <Award className="size-3.5" /> ¡Subiste al nivel {g.levelUp}!
                </span>
              )}
              {g.streakExtended && g.streak > 1 && (
                <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                  <Flame className="size-3.5 text-accent" /> Racha: {g.streak} días
                </span>
              )}
              {g.newAchievements.map((a) => (
                <span
                  key={a.code}
                  title={a.description}
                  className="flex items-center gap-1 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-xs font-semibold text-primary"
                >
                  <Trophy className="size-3.5" /> {a.title}
                </span>
              ))}
            </div>
          )}

          {g?.moduleCompleted && (
            <p className="mt-2 text-sm">
              🏁 ¡Completaste el módulo <strong>{g.moduleCompleted.title}</strong>!
            </p>
          )}
          {g?.pathCompleted && (
            <p className="mt-2 text-sm">
              🏆 ¡Terminaste la ruta <strong>{g.pathCompleted.title}</strong>! Enorme.
            </p>
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
              <textarea
                rows={3}
                disabled={!!result}
                onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: [e.target.value] }))}
                className="mt-3 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none"
                placeholder="Escribe tu respuesta…"
              />
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

            {r && r.explanation && (
              <p className="mt-3 rounded-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                {r.explanation}
              </p>
            )}
          </div>
        );
      })}

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {error}
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
