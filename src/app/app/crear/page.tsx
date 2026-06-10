import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateWizard } from "@/components/app/create-wizard";

export const metadata = { title: "Crear ruta" };

const LEVELS = new Set(["principiante", "intermedio", "avanzado"]);
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function CreatePathPage({
  searchParams,
}: {
  searchParams: Promise<{
    topic?: string;
    goal?: string;
    level?: string;
    from?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Idioma de la cuenta (elegido en el signup) → preseleccionado, editable aquí.
  const defaultLang = (
    (user?.user_metadata?.preferred_language as string | undefined) ?? "es"
  ).slice(0, 2);

  // Prefill desde "Siguiente paso" (sanitizado): el CTA precarga la sugerencia.
  const prefillTopic = sp.topic?.slice(0, 120) ?? "";
  const prefillGoal = sp.goal?.slice(0, 400) ?? "";
  const prefillLevel = sp.level && LEVELS.has(sp.level) ? sp.level : "principiante";
  const fromPathId = sp.from && UUID_RE.test(sp.from) ? sp.from : "";

  return (
    <div className="mx-auto max-w-xl">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
          {prefillTopic ? (
            "Tu siguiente ruta"
          ) : (
            <>
              ¿Qué quieres <span className="ink-hl">aprender</span>?
            </>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {prefillTopic
            ? "Ajusta lo que quieras — la armamos sobre lo que ya dominas."
            : "Dos pasos: nos cuentas el tema y la IA te hace las preguntas correctas."}
        </p>
      </div>

      {sp.error === "validacion" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          Revisa el tema y la meta: necesitamos un poco más de detalle.
        </p>
      )}
      {sp.error === "telefono" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2.5 text-center text-sm font-medium text-destructive">
          Revisa tu WhatsApp: debe tener entre 8 y 15 dígitos (ej: +56 9 1234 5678).
        </p>
      )}

      <CreateWizard
        defaultLanguage={defaultLang}
        prefillTopic={prefillTopic}
        prefillGoal={prefillGoal}
        prefillLevel={prefillLevel}
        fromPathId={fromPathId}
      />
    </div>
  );
}
