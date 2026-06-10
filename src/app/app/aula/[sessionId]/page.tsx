import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { liveSessions, learningPaths, routeAgents, modules, lessons } from "@/db/schema";
import { asc } from "drizzle-orm";
import { buildClassBrief } from "@/lib/live/brief";
import { buildInductionPrompt } from "@/lib/live/persona";
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
      kind: liveSessions.kind,
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

  // Outline de la ruta → la PIZARRA que el profesor controla en vivo.
  const mods = await db
    .select({
      id: modules.id,
      title: modules.title,
      orderIndex: modules.orderIndex,
      lessonTitle: lessons.title,
      lessonIndex: lessons.orderIndex,
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(eq(modules.pathId, session.pathId))
    .orderBy(asc(modules.orderIndex), asc(lessons.orderIndex));
  const outlineMap = new Map<number, { title: string; lessons: string[] }>();
  for (const r of mods) {
    const m = outlineMap.get(r.orderIndex) ?? { title: r.title, lessons: [] };
    m.lessons.push(r.lessonTitle);
    outlineMap.set(r.orderIndex, m);
  }
  const outline = [...outlineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => m);

  const isInduction = session.kind === "induction";
  const fullPrompt = isInduction
    ? `${buildInductionPrompt({
        persona: {
          name: agent.name,
          specialty: agent.specialty,
          style: agent.style,
          greeting: agent.greeting,
        },
        routeTitle: path.title,
        language: path.language,
      })}\n\n${brief.briefText}`
    : `${agent.systemPrompt}\n\n${brief.briefText}`;
  const firstMessage = isInduction
    ? `¡Hola ${brief.studentFirstName}! Soy ${agent.name}, tu profesor en esta ruta. ¡Bienvenido! Antes de que empieces, déjame mostrarte qué vamos a aprender juntos y cómo funciona todo esto. ¿Te parece?`
    : brief.scriptedGreeting;

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
        firstMessage={firstMessage}
        language={path.language.slice(0, 2) === "en" ? "en" : "es"}
        teacherName={agent.name}
        specialty={agent.specialty}
        pathId={session.pathId}
        kind={isInduction ? "induction" : "class"}
        outline={outline}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {agent.name} es un profesor de inteligencia artificial. La conversación
        se transcribe para generar tu resumen y tareas; el audio no se almacena.
      </p>
    </div>
  );
}
