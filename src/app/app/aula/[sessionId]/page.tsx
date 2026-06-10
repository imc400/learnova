import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { liveSessions, learningPaths, routeAgents } from "@/db/schema";
import { buildClassBrief } from "@/lib/live/brief";
import { getSessionCredentials } from "@/lib/live/provider";
import { AulaClient } from "@/components/app/aula-client";

/**
 * El aula: valida la sesión, arma el BRIEF del alumno en el servidor (jamás
 * en el cliente) y entrega credenciales efímeras + overrides al widget de voz.
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

  const [session] = await db
    .select({
      id: liveSessions.id,
      status: liveSessions.status,
      pathId: liveSessions.pathId,
    })
    .from(liveSessions)
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, user.id)))
    .limit(1);
  if (!session) notFound();
  if (session.status !== "in_progress") redirect(`/app/rutas/${session.pathId}`);

  const [path] = await db
    .select({
      title: learningPaths.title,
      language: learningPaths.language,
      skeletonCacheKey: learningPaths.skeletonCacheKey,
    })
    .from(learningPaths)
    .where(eq(learningPaths.id, session.pathId))
    .limit(1);
  if (!path) notFound();

  const cacheKey = path.skeletonCacheKey ?? `path-${session.pathId}`;
  const [agent] = await db
    .select()
    .from(routeAgents)
    .where(eq(routeAgents.cacheKey, cacheKey))
    .limit(1);
  if (!agent?.elevenlabsAgentId) redirect(`/app/rutas/${session.pathId}`);

  // Brief con memoria + credenciales efímeras (server-side, por carga).
  const brief = await buildClassBrief(user.id, session.pathId, agent.greeting);
  const { signedUrl } = await getSessionCredentials(agent.elevenlabsAgentId);
  const fullPrompt = `${agent.systemPrompt}\n\n${brief.briefText}`;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/app/rutas/${session.pathId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {path.title}
      </Link>

      <AulaClient
        sessionId={session.id}
        signedUrl={signedUrl}
        prompt={fullPrompt}
        firstMessage={brief.scriptedGreeting}
        language={path.language.slice(0, 2) === "en" ? "en" : "es"}
        teacherName={agent.name}
        specialty={agent.specialty}
        pathId={session.pathId}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {agent.name} es un profesor de inteligencia artificial. La conversación
        se transcribe para generar tu resumen y tareas; el audio no se almacena.
      </p>
    </div>
  );
}
