import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { liveSessions, learningPaths } from "@/db/schema";
import { buildSessionInitiation } from "@/lib/live/initiation";
import { getSessionCredentials, secureInitiationEnabled } from "@/lib/live/provider";
import { AulaClient } from "@/components/app/aula-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { title: "Clase en vivo" };
  const [row] = await db
    .select({ title: learningPaths.title })
    .from(liveSessions)
    .innerJoin(learningPaths, eq(learningPaths.id, liveSessions.pathId))
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, user.id)))
    .limit(1);
  return {
    title: row ? `Clase en vivo · «${row.title}»` : "Clase en vivo",
  };
}

/**
 * El aula: valida la sesión, arma la iniciación en el servidor y entrega
 * credenciales efímeras al widget de voz. En modo SEGURO (initiation webhook)
 * el prompt y el saludo NO viajan al navegador: ElevenLabs los pide
 * server-to-server a /api/live/initiation. En modo legado van como overrides.
 */
export default async function AulaPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sesión del usuario (cerrada → de vuelta a la ruta; ajena → 404).
  const [session] = await db
    .select({ id: liveSessions.id, status: liveSessions.status, pathId: liveSessions.pathId })
    .from(liveSessions)
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, user.id)))
    .limit(1);
  if (!session) notFound();
  if (session.status !== "in_progress") redirect(`/app/rutas/${session.pathId}`);

  const init = await buildSessionInitiation(sessionId, { userId: user.id });
  if (!init) redirect(`/app/rutas/${session.pathId}`);
  if (!init.elevenlabsAgentId) redirect(`/app/rutas/${session.pathId}`);

  const { signedUrl } = await getSessionCredentials(init.elevenlabsAgentId);
  const secure = secureInitiationEnabled();

  return (
    <div className="mx-auto max-w-2xl">
      {/* El breadcrumb vive en AulaClient: mientras la clase está conectada se
          oculta/intercepta para que un clic accidental no la termine. */}
      <AulaClient
        sessionId={sessionId}
        signedUrl={signedUrl}
        // Modo seguro: el prompt pedagógico (IP del producto) y el saludo se
        // quedan en el servidor; ElevenLabs los obtiene vía webhook firmado.
        secureInitiation={secure}
        prompt={secure ? "" : init.prompt}
        firstMessage={secure ? "" : init.firstMessage}
        language={init.language}
        teacherName={init.teacherName}
        specialty={init.specialty}
        pathId={init.pathId}
        pathTitle={init.pathTitle}
        kind={init.kind}
        outline={init.outline}
        homework={init.pendingHomework}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {init.teacherName} es un profesor de inteligencia artificial. La conversación
        se transcribe para generar tu resumen y tareas; el audio no se almacena.
      </p>
    </div>
  );
}
