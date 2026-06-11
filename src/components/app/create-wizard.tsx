"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import {
  createRouteIntentAction,
  wizardQuestionsAction,
} from "@/server/actions/paths";
import type { WizardQuestion } from "@/lib/ai/wizard";

/*
  Intake adaptativo en 2 pasos:
  1. Tema + nivel + idioma (los ÚNICOS campos que tocan el cacheKey canónico).
  2. Preguntas diseñadas por la IA para ESE tema (catálogo cerrado: single /
     multi / text + "Otro"). Las respuestas enriquecen goal y priorExperience.
*/

const OTHER = "__other__";

interface CreateWizardProps {
  defaultLanguage: string;
  prefillTopic: string;
  prefillGoal: string;
  prefillLevel: string;
  fromPathId: string;
}

type Answers = Record<string, { selected: string[]; other: string }>;

export function CreateWizard({
  defaultLanguage,
  prefillTopic,
  prefillGoal,
  prefillLevel,
  fromPathId,
}: CreateWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [topic, setTopic] = useState(prefillTopic);
  const [level, setLevel] = useState(prefillLevel);
  const [language, setLanguage] = useState(defaultLanguage);
  const [weeklyHours, setWeeklyHours] = useState("");
  const [questions, setQuestions] = useState<WizardQuestion[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [loadingQuestions, startQuestions] = useTransition();
  const [creating, startCreate] = useTransition();

  // Los errores se muestran donde el usuario está mirando (no por redirect,
  // que borraba el wizard entero): banner inline + scroll hasta él.
  const errorRef = useRef<HTMLDivElement>(null);
  const phoneErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  useEffect(() => {
    if (phoneError)
      phoneErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [phoneError]);

  const canContinue = topic.trim().length >= 2;
  // Misma regla que el servidor (intakeSchema): entero positivo ≤ 80.
  const hoursNum = weeklyHours.trim() ? Number(weeklyHours) : undefined;
  const hoursValid =
    hoursNum === undefined ||
    (Number.isInteger(hoursNum) && hoursNum >= 1 && hoursNum <= 80);

  const goToQuestions = () => {
    if (!canContinue) return;
    if (!hoursValid) {
      setError("Las horas por semana deben ser un número entero entre 1 y 80.");
      return;
    }
    setError(null);
    startQuestions(async () => {
      try {
        const res = await wizardQuestionsAction({ topic: topic.trim(), level, language });
        setQuestions(res.questions);
        setAnswers({});
        setStep(2);
      } catch {
        setError("No pudimos preparar tus preguntas. Intenta de nuevo.");
      }
    });
  };

  const toggle = (q: WizardQuestion, value: string) => {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? { selected: [], other: "" };
      let selected: string[];
      if (q.kind === "multi") {
        selected = cur.selected.includes(value)
          ? cur.selected.filter((v) => v !== value)
          : [...cur.selected, value];
      } else {
        selected = [value];
      }
      return { ...prev, [q.id]: { ...cur, selected } };
    });
  };

  const setOther = (qId: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [qId]: { selected: prev[qId]?.selected ?? [], other: text },
    }));
  };

  const setText = (qId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: { selected: [text], other: "" } }));
  };

  /** Respuesta legible de una pregunta (opciones elegidas + "Otro"). */
  const answerText = (q: WizardQuestion): string => {
    const a = answers[q.id];
    if (!a) return "";
    const parts = a.selected.filter((v) => v !== OTHER && v.trim());
    if (a.selected.includes(OTHER) && a.other.trim()) parts.push(a.other.trim());
    return parts.join(", ");
  };

  const answeredCount = useMemo(
    () => questions.filter((q) => answerText(q).length > 0).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, answers],
  );

  // Misma regla que el servidor (normalizePhone): + opcional y 8-15 dígitos.
  const phoneValid = /^\+?\d{8,15}$/.test(phone.trim().replace(/[\s().-]/g, ""));

  const submit = () => {
    setError(null);
    setPhoneError(null);
    // Validación en cliente ANTES del submit: la server action redirige al
    // fallar y eso borraba el wizard completo. Misma regla que normalizePhone.
    if (!phoneValid) {
      setPhoneError(
        "Revisa tu WhatsApp: debe tener entre 8 y 15 dígitos (ej: +56 9 1234 5678).",
      );
      return;
    }
    if (!hoursValid) {
      setError("Las horas por semana deben ser un número entero entre 1 y 80.");
      return;
    }
    // Composición: respuestas → goal / priorExperience. El topic NO se toca.
    const goalParts: string[] = [];
    const expParts: string[] = [];
    for (const q of questions) {
      const text = answerText(q);
      if (!text) continue;
      if (q.mapsTo === "priorExperience") {
        expParts.push(text);
      } else {
        goalParts.push(q.id === "meta" || goalParts.length === 0 ? text : `${q.label} ${text}`);
      }
    }
    if (prefillGoal) goalParts.unshift(prefillGoal);
    const goal = goalParts.join(". ") || `Quiero aprender ${topic.trim()}`;
    const priorExperience = expParts.join(". ");

    startCreate(async () => {
      try {
        await createRouteIntentAction({
          topic: topic.trim(),
          goal: goal.slice(0, 600),
          level,
          language,
          weeklyHours: weeklyHours ? Number(weeklyHours) : undefined,
          priorExperience: priorExperience ? priorExperience.slice(0, 500) : undefined,
          phone: phone.trim(),
          from: fromPathId || undefined,
        });
      } catch (e) {
        // redirect() lanza internamente: solo es error real si NO es redirect.
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError("No pudimos crear tu ruta. Intenta de nuevo.");
      }
    });
  };

  const selectClass =
    "h-11 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <div>
      {/* Indicador de paso — nota al margen, no control */}
      <p className="hand mb-5 text-center" aria-label={`Paso ${step} de 2`}>
        paso {step} de 2 ✺
      </p>

      {error && (
        <div ref={errorRef} className="mb-4">
          <NotaBanner tone="error">{error}</NotaBanner>
        </div>
      )}

      {step === 1 ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic">¿Qué quieres aprender?</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="fotografía con celular, excel para mi pyme, guitarra desde cero…"
              autoFocus
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="level">Tu nivel actual</Label>
              <select
                id="level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={selectClass}
              >
                <option value="principiante">Principiante</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="language">Idioma del contenido</Label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={selectClass}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weeklyHours">Horas por semana (opcional)</Label>
            <Input
              id="weeklyHours"
              type="number"
              min={1}
              max={80}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
              placeholder="Ej: 5"
            />
          </div>

          <Button size="lg" onClick={goToQuestions} disabled={!canContinue || loadingQuestions}>
            {loadingQuestions ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Diseñando tus preguntas…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Continuar
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            La IA preparará 3-4 preguntas hechas a la medida de tu tema.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {questions.map((q) => {
            const a = answers[q.id];
            return (
              <div key={q.id} className="flex flex-col gap-2.5">
                <Label>{q.label}</Label>
                {q.kind === "text" ? (
                  <textarea
                    rows={2}
                    value={a?.selected[0] ?? ""}
                    onChange={(e) => setText(q.id, e.target.value)}
                    placeholder={q.placeholder ?? ""}
                    className="flex w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {[...q.options, OTHER].map((opt) => {
                      const isOther = opt === OTHER;
                      const active = a?.selected.includes(opt) ?? false;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggle(q, opt)}
                          className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-foreground hover:border-primary/40"
                          }`}
                        >
                          {isOther ? "Otro…" : opt}
                        </button>
                      );
                    })}
                  </div>
                )}
                {a?.selected.includes(OTHER) && (
                  <Input
                    value={a.other}
                    onChange={(e) => setOther(q.id, e.target.value)}
                    placeholder="Cuéntanos con tus palabras…"
                    autoFocus
                  />
                )}
              </div>
            );
          })}

          <div className="flex flex-col gap-2.5">
            <Label htmlFor="phone">Tu WhatsApp (obligatorio)</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError(null);
              }}
              placeholder="+56 9 1234 5678"
              aria-invalid={phoneError ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Solo para avisarte cuando tu ruta esté lista. Nada de spam.
            </p>
            {phoneError && (
              <div ref={phoneErrorRef}>
                <NotaBanner tone="error">{phoneError}</NotaBanner>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setStep(1)}
              disabled={creating}
              aria-label="Volver"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Button
              size="lg"
              className="flex-1"
              onClick={submit}
              disabled={creating || answeredCount === 0}
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Creando tu ruta…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Crear mi ruta
                </>
              )}
            </Button>
          </div>
          {answeredCount === 0 && (
            <p className="text-center text-xs font-medium text-muted-foreground">
              Responde al menos una pregunta para crear tu ruta.
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            La IA diseñará tu currículum, generará las lecciones y curará los
            videos. Puede tomar unos minutos.
          </p>
        </div>
      )}
    </div>
  );
}
