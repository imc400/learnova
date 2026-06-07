import { Sparkles } from "lucide-react";
import { createPathAction } from "@/server/actions/paths";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/app/submit-button";

export const metadata = { title: "Crear ruta" };

export default function CreatePathPage() {
  return (
    <div className="mx-auto max-w-xl">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
          ¿Qué quieres aprender?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Responde estas preguntas y armamos tu ruta a medida en minutos.
        </p>
      </div>

      <form action={createPathAction} className="mt-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="topic">Tema</Label>
          <Input
            id="topic"
            name="topic"
            placeholder="Ej: Cocina, Python, Marketing digital, Guitarra…"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal">Tu meta concreta</Label>
          <textarea
            id="goal"
            name="goal"
            rows={3}
            required
            placeholder="Ej: Quiero poder cocinar platos completos para mi familia los fines de semana."
            className="flex w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level">Tu nivel actual</Label>
            <select
              id="level"
              name="level"
              defaultValue="principiante"
              className="h-11 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="principiante">Principiante</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weeklyHours">Horas por semana (opcional)</Label>
            <Input
              id="weeklyHours"
              name="weeklyHours"
              type="number"
              min={1}
              max={80}
              placeholder="Ej: 5"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priorExperience">Experiencia previa (opcional)</Label>
          <textarea
            id="priorExperience"
            name="priorExperience"
            rows={2}
            placeholder="Ej: Sé hervir pasta y hacer huevos, nada más."
            className="flex w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>

        <SubmitButton size="lg" pendingText="Creando tu ruta…">
          <Sparkles className="size-4" /> Crear mi ruta
        </SubmitButton>
        <p className="text-center text-xs text-muted-foreground">
          La IA diseñará tu currículum, generará las lecciones y curará los videos.
          Puede tomar unos minutos.
        </p>
      </form>
    </div>
  );
}
