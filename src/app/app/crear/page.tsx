import { createClient } from "@/lib/supabase/server";
import { CreateWizard } from "@/components/app/create-wizard";
import { PageHeader } from "@/components/app/brand/page-header";
import { NotaBanner } from "@/components/app/brand/nota-banner";

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
    pro?: string;
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
      {/* Presupuesto 1 tab-note/pantalla: cuando llega de comprar Pro, el
          tab-note del header ES la bienvenida. */}
      <PageHeader
        className="mb-6 text-center"
        nota={sp.pro === "bienvenida" ? "bienvenido a Pro ✺" : "diseñemos tu ruta ✺"}
        titulo={
          prefillTopic ? (
            "Tu siguiente ruta"
          ) : (
            <>
              ¿Qué quieres <span className="ink-hl">aprender</span>?
            </>
          )
        }
        subtitulo={
          prefillTopic
            ? "Ajusta lo que quieras — la armamos sobre lo que ya dominas."
            : "Dos pasos: nos cuentas el tema y la IA te hace las preguntas correctas."
        }
      />

      {sp.pro === "bienvenida" && (
        <NotaBanner tone="exito" titulo="Tu Pro está activo" className="mb-6">
          Crea tu primera ruta del mes — está incluida en tu plan.
        </NotaBanner>
      )}
      {/* Red de seguridad: la validación principal ahora corre en el cliente
          (el wizard no se borra), pero el redirect del server sigue cubierto. */}
      {sp.error === "validacion" && (
        <NotaBanner tone="error" titulo="Falta un poco más de detalle" className="mb-6">
          Revisa el tema y la meta: necesitamos un poco más para diseñar tu
          ruta. Si el problema sigue, escríbenos a hola@aulia.ai.
        </NotaBanner>
      )}
      {sp.error === "telefono" && (
        <NotaBanner tone="error" titulo="Revisa tu WhatsApp" className="mb-6">
          Debe tener entre 8 y 15 dígitos (ej: +56 9 1234 5678).
        </NotaBanner>
      )}

      <div className="ruled rounded-xl border border-border bg-card p-6 shadow-soft">
        <CreateWizard
          defaultLanguage={defaultLang}
          prefillTopic={prefillTopic}
          prefillGoal={prefillGoal}
          prefillLevel={prefillLevel}
          fromPathId={fromPathId}
        />
      </div>
    </div>
  );
}
