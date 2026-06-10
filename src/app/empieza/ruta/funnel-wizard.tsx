"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, ArrowLeft, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  publicWizardQuestionsAction,
  createAccountAndIntentAction,
} from "@/server/actions/funnel";
import type { WizardQuestion } from "@/lib/ai/wizard";

/*
  Wizard del EMBUDO DE VENTA (sin cuenta previa):
  1) tema + nivel → 2) preguntas IA → 3) nombre + correo + WhatsApp +
  contraseña (la cuenta se crea aquí, invisible) → paywall con SU ruta.
*/

const OTHER = "__other__";
type Answers = Record<string, { selected: string[]; other: string }>;

export function FunnelWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("principiante");
  const [questions, setQuestions] = useState<WizardQuestion[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [loadingQ, startQ] = useTransition();
  const [creating, startCreate] = useTransition();

  const goToQuestions = () => {
    if (topic.trim().length < 2) return;
    setError(null);
    startQ(async () => {
      try {
        const res = await publicWizardQuestionsAction({ topic: topic.trim(), level, language: "es" });
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
      const selected =
        q.kind === "multi"
          ? cur.selected.includes(value)
            ? cur.selected.filter((v) => v !== value)
            : [...cur.selected, value]
          : [value];
      return { ...prev, [q.id]: { ...cur, selected } };
    });
  };
  const setOther = (qId: string, text: string) =>
    setAnswers((p) => ({ ...p, [qId]: { selected: p[qId]?.selected ?? [], other: text } }));
  const setText = (qId: string, text: string) =>
    setAnswers((p) => ({ ...p, [qId]: { selected: [text], other: "" } }));

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

  const phoneValid = /^\+?\d{8,15}$/.test(phone.trim().replace(/[\s().-]/g, ""));
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const submit = () => {
    setError(null);
    setEmailTaken(false);
    if (!emailValid) return setError("Revisa tu correo: no parece válido.");
    if (!phoneValid) return setError("Revisa tu WhatsApp (ej: +56 9 1234 5678).");
    if (password.length < 8) return setError("Tu contraseña necesita al menos 8 caracteres.");

    const goalParts: string[] = [];
    const expParts: string[] = [];
    let metaDisplay = "";
    for (const q of questions) {
      const text = answerText(q);
      if (!text) continue;
      if (q.mapsTo === "priorExperience") expParts.push(text);
      else {
        if (!metaDisplay) metaDisplay = text;
        goalParts.push(goalParts.length === 0 ? text : `${q.label} ${text}`);
      }
    }
    const goal = goalParts.join(". ") || `Quiero aprender ${topic.trim()}`;

    startCreate(async () => {
      try {
        const res = await createAccountAndIntentAction({
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          topic: topic.trim(),
          goal: goal.slice(0, 600),
          metaDisplay: metaDisplay || `Aprender ${topic.trim()}`,
          level,
          language: "es",
          priorExperience: expParts.join(". ").slice(0, 500) || undefined,
        });
        // Si vuelve, es un error de formulario (el éxito redirige solo).
        if (res && !res.ok) {
          setError(res.error);
          setEmailTaken(!!res.emailTaken);
        }
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e; // redirect interno
        setError("Algo falló. Intenta de nuevo en unos segundos.");
      }
    });
  };

  const selectClass =
    "h-11 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <div className="mt-8">
      <div className="mb-6 flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${step === s ? "w-8 bg-primary" : "w-4 bg-border"}`}
          />
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          {error}{" "}
          {emailTaken && (
            <Link href="/login?next=%2Fapp%2Fcrear" className="font-bold underline">
              Iniciar sesión
            </Link>
          )}
        </p>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic">¿Qué quieres aprender?</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej: Inteligencia artificial, Fotografía, Inglés…"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level">Tu nivel actual</Label>
            <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} className={selectClass}>
              <option value="principiante">Principiante</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>
          </div>
          <Button size="lg" onClick={goToQuestions} disabled={topic.trim().length < 2 || loadingQ}>
            {loadingQ ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Diseñando tus preguntas…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Armar mi ruta
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            2 minutos · La IA diseña tu ruta exactamente para tu meta
          </p>
        </div>
      )}

      {step === 2 && (
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
                    className="flex w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
                              : "border-border bg-card hover:border-primary/40"
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
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setStep(1)} aria-label="Volver">
              <ArrowLeft className="size-4" />
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setStep(3)} disabled={answeredCount === 0}>
              <Sparkles className="size-4" /> Ver mi ruta
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="hand text-lg">tu ruta está lista para diseñarse ✺</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Dinos a dónde te la enviamos y crea tu acceso.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-name">Tu nombre</Label>
            <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Camila" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-email">Tu correo</Label>
            <Input id="f-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@gmail.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-phone">Tu WhatsApp</Label>
            <Input id="f-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 1234 5678" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-pass">Crea tu contraseña</Label>
            <Input id="f-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
          </div>
          <div className="mt-1 flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setStep(2)} disabled={creating} aria-label="Volver">
              <ArrowLeft className="size-4" />
            </Button>
            <Button size="lg" className="flex-1" onClick={submit} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Diseñando tu ruta…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Ver mi ruta personalizada
                </>
              )}
            </Button>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3" /> Tus datos van cifrados. Te enviaremos tu
            ruta por correo y WhatsApp.
          </p>
        </div>
      )}
    </div>
  );
}
