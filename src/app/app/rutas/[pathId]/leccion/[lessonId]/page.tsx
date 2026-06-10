import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ArrowLeft,
  CheckCircle2,
  Lightbulb,
  ListChecks,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLessonDetail } from "@/server/queries/lessons";
import { completeLessonAction } from "@/server/actions/quiz";
import { RouteProgressLive } from "@/components/app/route-progress-live";
import { YouTubeEmbed } from "@/components/app/youtube-embed";
import { Quiz } from "@/components/app/quiz";
import { TutorChat } from "@/components/app/tutor-chat";
import { SubmitButton } from "@/components/app/submit-button";
import type { LessonContent } from "@/lib/ai/schemas";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ pathId: string; lessonId: string }>;
}) {
  const { pathId, lessonId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const detail = await getLessonDetail(lessonId, user.id);
  if (!detail) notFound();

  const content = detail.lesson.content as LessonContent | null;

  // Acción de completar (inline server action que captura los ids).
  // Sin redirect: el usuario se queda en la lección y ve el estado completado;
  // revalidar el layout refresca también el header (XP/racha) y las barras.
  async function complete() {
    "use server";
    await completeLessonAction(pathId, lessonId);
    revalidatePath("/app", "layout");
  }

  // Preguntas seguras para el cliente (sin respuestas correctas).
  const clientQuestions = (detail.quiz?.questions ?? []).map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: (q.options as { id: string; text: string }[] | null) ?? [],
  }));

  const tutorContext = [
    `Ruta: ${detail.path.title}`,
    `Módulo: ${detail.module.title} (objetivo: ${detail.module.objective ?? "—"})`,
    `Lección actual: ${detail.lesson.title}`,
    content ? `Puntos clave: ${content.keyTakeaways.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_22rem]">
      {/* Columna principal */}
      <article className="min-w-0">
        <Link
          href={`/app/rutas/${pathId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {detail.path.title}
        </Link>
        <p className="mt-4 text-sm font-medium text-primary">
          {detail.module.title}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
          {detail.lesson.title}
        </h1>

        {/* Video curado + guía de momentos (anclada al digest del video) */}
        {detail.videos.length > 0 && (
          <div className="mt-6">
            <YouTubeEmbed
              videos={detail.videos}
              userLanguage={detail.path.language}
              videoGuide={content?.videoGuide ?? null}
            />
          </div>
        )}

        {/* Contenido de la lección */}
        {content ? (
          <div className="mt-8 flex flex-col gap-6">
            <p className="text-lg leading-relaxed text-foreground">{content.intro}</p>

            {content.sections.map((s, i) => (
              <section key={i}>
                <h2 className="font-display text-xl font-semibold">{s.heading}</h2>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </section>
            ))}

            {content.keyTakeaways.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-display font-semibold">
                  <Lightbulb className="size-5 text-accent" /> Puntos clave
                </h3>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {content.keyTakeaways.map((k, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary">•</span> {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {content.practice && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
                <h3 className="flex items-center gap-2 font-display font-semibold">
                  <ListChecks className="size-5 text-primary" /> Practica
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{content.practice}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
            <Loader2 className="mx-auto size-7 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">
              Esta lección se está generando…
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aparecerá aquí en cuanto esté lista (unos segundos). No necesitas
              recargar.
            </p>
            {/* Auto-refresca la página hasta que llegue el contenido. */}
            <RouteProgressLive pathId={pathId} showBanner={false} />
          </div>
        )}

        {/* Quiz */}
        {clientQuestions.length > 0 && detail.quiz && (
          <div className="mt-10">
            <h2 className="font-display text-xl font-semibold">Pon a prueba lo aprendido</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aprobar el quiz (60%+) completa la lección y suma XP.
            </p>
            <div className="mt-4">
              <Quiz quizId={detail.quiz.id} questions={clientQuestions} />
            </div>
          </div>
        )}

        {/* Completar — el quiz ES el camino cuando existe (dominio real, no un
            botón); el marcado manual queda solo para lecciones sin quiz. */}
        {detail.completed ? (
          <div className="mt-10 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            <CheckCircle2 className="size-4" /> Lección completada
          </div>
        ) : detail.quiz && clientQuestions.length > 0 ? (
          <div className="mt-10 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <ListChecks className="size-4 shrink-0" />
            Esta lección se completa aprobando el quiz de arriba — así tu avance
            refleja lo que realmente dominas.
          </div>
        ) : content ? (
          <form action={complete} className="mt-10">
            <SubmitButton variant="primary" size="lg" pendingText="Guardando…">
              <CheckCircle2 className="size-4" /> Marcar como completada
            </SubmitButton>
          </form>
        ) : null}
      </article>

      {/* Tutor (sidebar) */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <TutorChat
          context={tutorContext}
          suggestions={[
            "Explícame este tema con un ejemplo simple",
            "No entendí los puntos clave, ¿me los aclaras?",
            "Dame un ejercicio para practicar",
          ]}
        />
      </aside>
    </div>
  );
}
