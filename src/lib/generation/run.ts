import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  routeIntents,
  skeletonCache,
  lessonContentCache,
  modules as modulesT,
  lessons as lessonsT,
  quizzes as quizzesT,
  questions as questionsT,
  videoCandidates,
  videoBackfillQueue,
} from "@/db/schema";
import {
  generatePathSkeleton,
  generateLessonContent,
  generateQuiz,
  generateVideoQueries,
  generateRouteOverlay,
} from "@/lib/ai/generate";
import { PROMPT_VERSION } from "@/lib/ai/prompts";
import { normalizeTopicSlug } from "@/lib/ai/wizard";
import { curateVideoForLesson } from "@/lib/youtube/curate";
import { getVideoDetails, YouTubeQuotaError } from "@/lib/youtube/client";
import { getVideoInsights, type VideoDigest } from "@/lib/video/insights";
import type {
  Intake,
  PathSkeleton,
  LessonContent,
  GeneratedQuiz,
} from "@/lib/ai/schemas";

type GeneratedQuizData = GeneratedQuiz;
import { env } from "@/lib/env";

type CachedLessonRow = typeof lessonContentCache.$inferSelect;
type FreshVideo = Awaited<ReturnType<typeof getVideoDetails>>[number];

/** Lo que una lección terminada aporta a la memoria del curso (A-P0.2).
 *  terminology viaja en el outcome (no se muta vocab dentro de la lambda
 *  paralela): el vocab del run se construye DESPUÉS del allSettled, en orden
 *  de lección — determinístico de verdad. */
type LessonOutcome = {
  title: string;
  label: string;
  takeaways: string[];
  terminology: string[];
};
type ModuleMemory = { moduleTitle: string; lessons: LessonOutcome[] };

/**
 * Key canónica del caché de cabeza gruesa (A-P1.4):
 * `{canonicalTopic|slug(topic)}-{variant?}-{level}-{language}`.
 * - canonicalTopic: slug del wizard (Track B) — sin typos/acentos/stopwords.
 * - variant (equipo: celular vs cámara, Excel vs Sheets): SÍ faceta la key —
 *   es la única dimensión donde fragmentar es correcto (cambia qué contenido
 *   es verdadero). La meta JAMÁS faceta (Opción A: overlay por ruta).
 * EXPORTADA para que el paywall (Track B) y next-path (Track D) consulten
 * EXACTAMENTE la misma key que escribe este pipeline.
 */
export function buildSkeletonCacheKey(args: {
  topic: string;
  canonicalTopic?: string | null;
  variant?: string | null;
  level: string;
  language: string;
}): string {
  const topicKey = args.canonicalTopic?.trim()
    ? args.canonicalTopic.trim()
    : normalizeTopicSlug(args.topic);
  return [topicKey, args.variant?.trim() || null, args.level, args.language]
    .filter(Boolean)
    .join("-");
}

/**
 * Candidatas de key para LEER el canon, de la más específica a la legacy:
 * 1. la key NUEVA (canónica+variant — formato final de Track A),
 * 2. la canónica sin variant,
 * 3. la derivación cruda histórica `topic.toLowerCase().trim()-level-language`
 *    de main — con la que se escribió TODO el canon pre-existente (incluido
 *    el pre-calentado de la demo: «hacer alfajores-principiante-es»).
 * Sin el fallback legacy, deployar el formato nuevo dejaba ese canon huérfano
 * y el pipeline regeneraba en vivo (Opus + ~24 Sonnet + cuota YouTube).
 * COMPARTIDA por el pipeline (runPathGeneration) y el paywall
 * (pagar/[intentId]) para que ambos resuelvan SIEMPRE la misma celda.
 * Los WRITES en cache MISS total usan la primera candidata (formato nuevo);
 * si un canon viejo existe, se sigue leyendo Y escribiendo bajo SU key para
 * no fragmentar el canon entre formatos.
 */
export function skeletonCacheKeyCandidates(args: {
  topic: string;
  canonicalTopic?: string | null;
  variant?: string | null;
  level: string;
  language: string;
}): string[] {
  return [
    ...new Set([
      buildSkeletonCacheKey(args),
      buildSkeletonCacheKey({ ...args, variant: null }),
      `${args.topic.toLowerCase().trim()}-${args.level}-${args.language}`,
    ]),
  ];
}

/* ------------------------- Helpers de coherencia ------------------------- */

/** ¿El nivel aparente del video contradice el del estudiante? (A-P1.7 — el
 *  dato apparentLevel venía muerto en BD). Solo contradicciones claras:
 *  principiante↔avanzado; intermedio nunca penaliza. */
export function levelsContradict(
  apparentLevel: string | null | undefined,
  studentLevel: string,
): boolean {
  if (!apparentLevel) return false;
  const a = apparentLevel.toLowerCase();
  const norm =
    a.includes("princip") || a.includes("beginner") || a.includes("básic") || a.includes("basic") || a.includes("intro")
      ? "principiante"
      : a.includes("avanz") || a.includes("advanced") || a.includes("expert")
        ? "avanzado"
        : null;
  if (!norm) return false;
  return (
    (norm === "principiante" && studentLevel === "avanzado") ||
    (norm === "avanzado" && studentLevel === "principiante")
  );
}

/** Coverage EFECTIVO para el gate: penaliza −0.2 el calce de nivel roto. */
export function effectiveCoverage(
  digest: VideoDigest,
  studentLevel: string,
): number {
  return (
    digest.coverage - (levelsContradict(digest.apparentLevel, studentLevel) ? 0.2 : 0)
  );
}

/** Quita del quiz cacheado toda pregunta anclada al video (para servir un
 *  canon cuyo video ancla murió — el quiz no puede evaluar lo que el nuevo
 *  video no dice). Devuelve null si no sobrevive ninguna pregunta. */
function stripVideoGroundedQuestions(
  quiz: GeneratedQuizData | null,
): GeneratedQuizData | null {
  if (!quiz?.questions?.length) return null;
  const kept = quiz.questions
    .filter((q) => q.grounding?.source !== "video" && q.grounding?.timestampSeconds == null)
    .map((q) => ({ ...q, grounding: { source: "lesson" as const, timestampSeconds: null } }));
  return kept.length ? { questions: kept } : null;
}

/** Encola una lección para re-anclaje (cron backfill-videos de Track E la
 *  drena vía reanchorLesson). Dedupe por pendiente; jamás lanza. */
async function enqueueVideoBackfill(lessonId: string, reason: string): Promise<void> {
  try {
    const [pending] = await db
      .select({ id: videoBackfillQueue.id })
      .from(videoBackfillQueue)
      .where(and(eq(videoBackfillQueue.lessonId, lessonId), isNull(videoBackfillQueue.processedAt)))
      .limit(1);
    if (pending) return;
    await db.insert(videoBackfillQueue).values({ lessonId, reason });
  } catch (e) {
    console.error(`[generation] no se pudo encolar backfill de video (${lessonId}):`, e);
  }
}

/** videos.list en lotes de 50 (A-P2: 24 lecciones = 24 unidades → 1 por lote).
 *  Devuelve null si la API falló: el caller trata "desconocido" como vivo
 *  (servir el canon tal cual es más seguro que des-anclarlo por un 503). */
async function getVideoDetailsBatched(ids: string[]): Promise<Map<string, FreshVideo> | null> {
  const map = new Map<string, FreshVideo>();
  if (!ids.length) return map;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const fresh = await getVideoDetails(ids.slice(i, i + 50));
      for (const f of fresh) map.set(f.videoId, f);
    }
    return map;
  } catch (e) {
    console.error(`[generation] videos.list en lote falló (se asume canon vivo):`, e);
    return null;
  }
}

/** Renderiza el contexto acumulado del curso para una lección (A-P0.2).
 *  Determinístico por esqueleto: la lección canónica N siempre se escribe con
 *  el mismo prefijo → compatible con lesson_content_cache. */
function renderCourseContext(args: {
  skeleton: PathSkeleton;
  memory: ModuleMemory[];
  vocab: Set<string>;
  mi: number;
  li: number;
  globalIndex: number;
  totalLessons: number;
  siblings: { title: string; summary: string }[];
}): string {
  const { skeleton, memory, vocab, mi, li } = args;
  const lines: string[] = [];
  const map = skeleton.modules
    .map((m, i) => `${i === mi ? "► " : ""}${i + 1}. ${m.title}`)
    .join(" · ");
  lines.push(`MAPA DE LA RUTA (módulo actual marcado con ►): ${map}`);
  lines.push(
    `Estás escribiendo la lección ${mi + 1}.${li + 1} (la ${args.globalIndex} de ${args.totalLessons} de la ruta).`,
  );
  if (skeleton.narrativeThread) lines.push(`HILO DEL CURSO: ${skeleton.narrativeThread}`);
  const buildsOn = skeleton.modules[mi]?.buildsOn;
  if (buildsOn) lines.push(`ESTE MÓDULO CONSTRUYE SOBRE: ${buildsOn}`);
  if (memory.some((m) => m.lessons.length)) {
    lines.push("", "LO YA ENSEÑADO (no lo re-expliques; referéncialo y construye sobre ello):");
    memory.forEach((mod, i) => {
      for (const l of mod.lessons) {
        lines.push(`[Módulo ${i + 1} · Lección ${l.label} «${l.title}»]: ${l.takeaways.slice(0, 2).join("; ")}`);
      }
    });
  }
  if (vocab.size) {
    lines.push(
      "",
      `VOCABULARIO YA INTRODUCIDO (úsalo con consistencia; si el video usa otro término, aclara la equivalencia una vez): ${[...vocab].slice(0, 40).join(", ")}`,
    );
  }
  if (args.siblings.length) {
    lines.push("", "LECCIONES HERMANAS DE ESTE MÓDULO (no te superpongas con ellas):");
    for (const s of args.siblings) lines.push(`- ${s.title}: ${s.summary}`);
  }
  return lines.join("\n");
}

/** Takeaways de módulos ANTERIORES para la pregunta de repaso espaciado del
 *  quiz (A-P0.2). null en el primer módulo. */
function renderQuizReviewContext(memory: ModuleMemory[]): string | null {
  const picks: string[] = [];
  for (let i = memory.length - 1; i >= 0 && picks.length < 3; i--) {
    const mod = memory[i]!;
    const lesson = mod.lessons.at(-1);
    const tk = lesson?.takeaways[0];
    if (tk) picks.push(`- [Módulo ${i + 1} «${mod.moduleTitle}»] ${tk}`);
  }
  if (!picks.length) return null;
  return `TAKEAWAYS DE MÓDULOS ANTERIORES (úsalos para la pregunta de repaso espaciado):\n${picks.join("\n")}`;
}

/**
 * Orquesta la generación PROGRESIVA de una ruta:
 * 1) Planifica el esqueleto CANÓNICO goal-neutral (Opus o caché de cabeza
 *    gruesa) — decisión fundador Opción A.
 * 2) Inserta TODA la estructura y marca la ruta 'ready' → el usuario ve el
 *    árbol completo; el OVERLAY por ruta (route_intro + personal_note, Haiku)
 *    escribe lo "hecho para ti" SIN tocar el canon.
 * 3) Rellena el contenido por módulo EN ORDEN con CONTEXTO ACUMULADO (los
 *    módulos conversan); cada lección queda disponible apenas se genera.
 * Idempotente (upserts + guard de progreso) y tolerante a fallos parciales
 * (allSettled por lección; el retry regenera solo lo que falta).
 */
export async function runPathGeneration(pathId: string): Promise<void> {
  const [path] = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.id, pathId))
    .limit(1);
  if (!path) throw new Error(`Ruta ${pathId} no encontrada`);
  if (path.generationProgress >= 100) return; // idempotente: contenido ya completo

  try {
    await db
      .update(learningPaths)
      .set({
        status: "generating",
        generationProgress: 8,
        generationStep: "Planificando tu currículum…",
        generationStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    const meta = (path.intake ?? {}) as Partial<Intake>;
    const intake: Intake = {
      topic: path.topic,
      goal: path.goal,
      level: path.level,
      language: path.language,
      priorExperience: meta.priorExperience,
      weeklyHours: meta.weeklyHours,
    };

    // Señales del wizard persistidas SERVER-SIDE por Track B en el intent
    // (jamás desde el intake del cliente: el cacheKey canónico es envenenable).
    const [intent] = await db
      .select({
        canonicalTopic: routeIntents.canonicalTopic,
        wizardAnswers: routeIntents.wizardAnswers,
        preview: routeIntents.preview,
      })
      .from(routeIntents)
      .where(eq(routeIntents.pathId, pathId))
      .limit(1);
    const wizardPayload = (intent?.wizardAnswers ?? null) as { variant?: string | null } | null;
    const variant = wizardPayload?.variant ?? null;
    // Paywall honesto (B-P0.3): el borrador de temario que el comprador VIO.
    const promisedModules = intent?.preview?.modules ?? null;

    // --- NIVEL 1 con CACHÉ DE CABEZA GRUESA ---
    // FALLBACK LEGACY (P0): el canon pre-existente (p.ej. el pre-calentado de
    // la demo) vive bajo la key cruda vieja `topic.toLowerCase().trim()-…`.
    // Consultar SOLO la key nueva lo dejaba huérfano → regeneración completa
    // en vivo tras pagar (Opus + ~24 Sonnet + ~2.400 unidades de YouTube).
    // Se prueban las candidatas (misma precedencia que el paywall) y la ruta
    // ADOPTA la key del canon encontrado — los lookups y writes de
    // lesson_content_cache de abajo usan ESTA misma key, así canon viejo y
    // nuevo jamás se fragmentan. Solo en MISS total se escribe con la nueva.
    const keyCandidates = skeletonCacheKeyCandidates({
      topic: intake.topic,
      canonicalTopic: intent?.canonicalTopic,
      variant,
      level: intake.level,
      language: intake.language,
    });

    const bumpSkeletonReuse = (id: string) =>
      db
        .update(skeletonCache)
        .set({ timesReused: sql`${skeletonCache.timesReused} + 1`, updatedAt: new Date() })
        .where(eq(skeletonCache.id, id));

    const canonRows = await db
      .select()
      .from(skeletonCache)
      .where(
        and(
          inArray(skeletonCache.cacheKey, keyCandidates),
          eq(skeletonCache.version, PROMPT_VERSION),
        ),
      );
    const cached = keyCandidates
      .map((k) => canonRows.find((r) => r.cacheKey === k))
      .find(Boolean);
    const cacheKey = cached?.cacheKey ?? keyCandidates[0]!;

    let skeleton: PathSkeleton;
    if (cached) {
      skeleton = cached.skeleton as PathSkeleton;
      await bumpSkeletonReuse(cached.id);
    } else {
      // canonical: true (Opción A) — el esqueleto compartido se diseña
      // goal-neutral; la meta del comprador vive en el overlay por ruta.
      skeleton = await generatePathSkeleton(intake, {
        canonical: true,
        promisedModules,
        tracking: { pathId },
      });
      const inserted = await db
        .insert(skeletonCache)
        .values({
          cacheKey,
          topic: intake.topic,
          language: intake.language,
          level: intake.level,
          skeleton,
          version: PROMPT_VERSION,
        })
        .onConflictDoNothing({ target: [skeletonCache.cacheKey, skeletonCache.version] })
        .returning({ id: skeletonCache.id });
      if (!inserted.length) {
        // CARRERA (A-P0.1): otro worker ganó el canon mientras generábamos.
        // Hay que usar SU esqueleto: las celdas de lesson_content_cache van
        // por (cacheKey, índice) y mezclarlas con NUESTROS títulos dejaría
        // el canon corrupto de forma permanente (stub A con contenido B).
        const [stored] = await db
          .select()
          .from(skeletonCache)
          .where(and(eq(skeletonCache.cacheKey, cacheKey), eq(skeletonCache.version, PROMPT_VERSION)))
          .limit(1);
        if (stored) {
          skeleton = stored.skeleton as PathSkeleton;
          await bumpSkeletonReuse(stored.id);
        }
      }
    }

    const totalLessons = skeleton.modules.reduce(
      (n, m) => n + m.lessons.length,
      0,
    );
    await db
      .update(learningPaths)
      .set({
        title: skeleton.title,
        level: skeleton.level,
        estimatedHours: skeleton.estimatedHours,
        skeletonCacheKey: cacheKey,
        totalLessons,
        generationProgress: 18,
        generationStep: `Estructurando ${skeleton.modules.length} módulos…`,
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    // --- PASO 1: insertar módulos + stubs de lección (sin contenido, instantáneo) ---
    const plan: Array<{
      m: PathSkeleton["modules"][number];
      lessons: Array<{
        id: string;
        ls: PathSkeleton["modules"][number]["lessons"][number];
      }>;
    }> = [];

    for (const [mi, m] of skeleton.modules.entries()) {
      const [mod] = await db
        .insert(modulesT)
        .values({
          pathId,
          orderIndex: mi,
          title: m.title,
          description: m.description,
          objective: m.objective,
        })
        .onConflictDoUpdate({
          target: [modulesT.pathId, modulesT.orderIndex],
          set: { title: m.title, description: m.description, objective: m.objective },
        })
        .returning();
      if (!mod) continue;

      const lessons: Array<{ id: string; ls: (typeof m.lessons)[number] }> = [];
      for (const [li, ls] of m.lessons.entries()) {
        const [lesson] = await db
          .insert(lessonsT)
          .values({
            moduleId: mod.id,
            orderIndex: li,
            title: ls.title,
            estimatedMinutes: ls.estimatedMinutes,
            // stub_summary persistido (A-P2): reanchorLesson y los backfills
            // lo necesitan — antes se descartaba tras insertar.
            stubSummary: ls.summary,
          })
          .onConflictDoUpdate({
            target: [lessonsT.moduleId, lessonsT.orderIndex],
            set: { title: ls.title, estimatedMinutes: ls.estimatedMinutes, stubSummary: ls.summary },
          })
          .returning();
        if (lesson) lessons.push({ id: lesson.id, ls });
      }
      plan.push({ m, lessons });
    }

    // Estructura completa → la ruta YA es navegable. El usuario ve el árbol entero.
    await db
      .update(learningPaths)
      .set({
        status: "ready",
        generationProgress: 25,
        generationStep: "Generando el contenido de tus lecciones…",
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    // --- OVERLAY DE PERSONALIZACIÓN POR RUTA (A-P0.3, Opción A) ---
    // El esqueleto y las lecciones son canónicos goal-neutral; lo "hecho para
    // ti" se escribe AQUÍ (route_intro + personal_note por módulo, Haiku,
    // ~$0.005/ruta) y JAMÁS entra al caché. Si falla, no bloquea nada.
    if (!path.routeIntro) {
      try {
        const overlay = await generateRouteOverlay({
          routeTitle: skeleton.title,
          narrativeThread: skeleton.narrativeThread ?? null,
          modules: skeleton.modules.map((m, i) => ({ index: i, title: m.title, objective: m.objective })),
          goal: path.goal,
          priorExperience: meta.priorExperience ?? null,
          level: skeleton.level,
          language: intake.language,
          tracking: { pathId },
        });
        await db
          .update(learningPaths)
          .set({ routeIntro: overlay.routeIntro, updatedAt: new Date() })
          .where(eq(learningPaths.id, pathId));
        for (const n of overlay.moduleNotes) {
          if (!Number.isInteger(n.moduleIndex) || n.moduleIndex < 0 || n.moduleIndex >= skeleton.modules.length) continue;
          await db
            .update(modulesT)
            .set({ personalNote: n.note })
            .where(and(eq(modulesT.pathId, pathId), eq(modulesT.orderIndex, n.moduleIndex)));
        }
      } catch (e) {
        console.error(`[generation] overlay de personalización falló (no bloquea):`, e);
      }
    }

    // --- PASO 2: rellenar contenido por módulo EN ORDEN (prioriza los primeros);
    //     lecciones del módulo en paralelo, módulos en serie → el contexto
    //     acumulado (A-P0.2) es determinístico por esqueleto: los takeaways
    //     vienen del contenido (cacheado o fresco) y el vocab de la columna
    //     terminology del canon, ambos incorporados al CERRAR cada módulo.
    //     CAVEAT conocido: si una lección FALLA, no aporta takeaways al
    //     courseMemory de este run y los módulos posteriores pueden cachearse
    //     con memoria incompleta (determinismo por-historial-de-runs en ese
    //     borde; fix pendiente: no cachear módulos posteriores al 1er fallo). ---
    let done = 0;
    let firstModuleEmailSent = false;
    // Un mismo video de YouTube no se repite entre lecciones de la ruta.
    const usedVideoIds = new Set<string>();
    // Memoria del curso: qué se enseñó ya (takeaways) + vocabulario introducido.
    const courseMemory: ModuleMemory[] = [];
    const vocab = new Set<string>();
    // Lecciones que fallaron: NO tumban el módulo (allSettled); al final del
    // run se lanza para que el retry de Trigger regenere SOLO esas.
    const failedLessons: string[] = [];

    const emitProgress = async (step: string) => {
      const pct =
        totalLessons > 0 ? 25 + Math.round((done / totalLessons) * 70) : 25;
      await db
        .update(learningPaths)
        .set({
          // GREATEST: los UPDATE de lecciones paralelas pueden aterrizar fuera
          // de orden — el progreso jamás debe regredir en la UI (A-P2).
          generationProgress: sql`GREATEST(${learningPaths.generationProgress}, ${pct})`,
          generationStep: step,
          updatedAt: new Date(),
        })
        .where(eq(learningPaths.id, pathId));
    };

    for (const [mi, { m, lessons }] of plan.entries()) {
      const lessonsBefore = plan
        .slice(0, mi)
        .reduce((n, p) => n + p.lessons.length, 0);

      // STAGE A — queries de video del módulo entero en 1 llamada Haiku
      // (desde los STUBS: el video se elige ANTES de escribir la lección).
      let queryByIndex = new Map<number, string>();
      try {
        const q = await generateVideoQueries({
          routeTitle: skeleton.title,
          moduleTitle: m.title,
          moduleObjective: m.objective,
          lessons: lessons.map(({ ls }, i) => ({
            index: i,
            title: ls.title,
            summary: ls.summary,
          })),
          language: intake.language,
          level: skeleton.level,
          tracking: { pathId },
        });
        queryByIndex = new Map(q.queries.map((x) => [x.lessonIndex, x.query]));
      } catch (e) {
        console.error(`[generation] queries de video fallaron (módulo ${m.title}):`, e);
      }

      // Prefetch del canon del módulo (1 query) + metadatos frescos de TODOS
      // sus videos en lotes de 50 (A-P2: antes era 1 unidad por lección).
      let cachedByLesson = new Map<number, CachedLessonRow>();
      try {
        const rows = await db
          .select()
          .from(lessonContentCache)
          .where(
            and(
              eq(lessonContentCache.cacheKey, cacheKey),
              eq(lessonContentCache.moduleIndex, mi),
              eq(lessonContentCache.version, PROMPT_VERSION),
            ),
          );
        cachedByLesson = new Map(rows.map((r) => [r.lessonIndex, r]));
      } catch (e) {
        console.error(`[generation] lectura del canon falló (módulo ${mi}):`, e);
      }
      const allCachedIds = [
        ...new Set(
          [...cachedByLesson.values()].flatMap((r) => (r.videoIds as string[] | null) ?? []),
        ),
      ];
      const freshById = await getVideoDetailsBatched(allCachedIds);

      const settled = await Promise.allSettled(
        lessons.map(async ({ id: lessonId, ls }, li): Promise<LessonOutcome> => {
          const label = `${mi + 1}.${li + 1}`;
          const cachedLesson = cachedByLesson.get(li);

          /* ------------------------- CACHE HIT ------------------------- */
          if (cachedLesson) {
            const cachedContent = cachedLesson.content as LessonContent;
            const cachedQuiz = (cachedLesson.quiz as GeneratedQuizData | null) ?? null;
            const ids = (cachedLesson.videoIds as string[] | null) ?? [];
            // Filas pre-migración (sin columnas de salud): se asume ancla = ids[0].
            const isLegacy =
              cachedLesson.hadDigest == null &&
              cachedLesson.anchoredVideoId == null &&
              cachedLesson.videoQuery == null;
            const anchorId =
              cachedLesson.anchoredVideoId ??
              (cachedLesson.anchored !== false ? ids[0] ?? null : null);
            // Canon honesto SIN video (el coverage gate rechazó al generar):
            // no se cura por usuario — el gate ya decidió que no había video
            // relevante. El HIT NO invierte el gate (A-P0.1).
            const gateRejectedCanon =
              !isLegacy &&
              cachedLesson.anchored === false &&
              (cachedLesson.videoCount ?? 0) === 0;

            let contentToServe = cachedContent;
            let quizToServe = cachedQuiz;

            if (freshById) {
              const alive = ids.filter((id) => freshById.has(id));
              const anchorBroken = anchorId != null && alive[0] !== anchorId;
              if (anchorBroken) {
                // VIDEO ANCLA MUERTO (A-P0.1): la videoGuide y las preguntas
                // con timestamp pertenecen al video viejo — servirlas con un
                // video nuevo es la incoherencia que el pipeline de digests
                // existe para impedir. Se sirve sin guía + quiz solo-lección,
                // el canon queda des-anclado y la lección entra al backfill.
                contentToServe = { ...cachedContent, videoGuide: null };
                quizToServe = stripVideoGroundedQuestions(cachedQuiz);
                await db
                  .update(lessonContentCache)
                  .set({
                    content: contentToServe,
                    quiz: quizToServe,
                    anchored: false,
                    anchoredVideoId: null,
                    videoIds: alive,
                    // Estado TRANSITORIO coherente con el gate: la guía y el
                    // digest murieron con el ancla — reanchorLesson restaura
                    // estas columnas al reparar el canon.
                    hadDigest: false,
                    coverage: null,
                    videoCount: alive.length,
                    quizOk: quizToServe != null,
                    updatedAt: new Date(),
                  })
                  .where(eq(lessonContentCache.id, cachedLesson.id))
                  .catch((e) => console.error(`[generation] no se pudo des-anclar el canon:`, e));
                await enqueueVideoBackfill(lessonId, "link_rot");
              }
              if (alive.length) {
                for (const id of alive) usedVideoIds.add(id);
                await db
                  .insert(videoCandidates)
                  .values(
                    alive.map((id, rank) => {
                      const f = freshById.get(id)!;
                      return {
                        lessonId,
                        youtubeVideoId: id,
                        title: f.title,
                        channelTitle: f.channelTitle,
                        rank,
                        language: f.defaultLanguage ?? intake.language,
                        durationSeconds: f.durationSeconds,
                        reason: anchorBroken
                          ? "candidato del canon (ancla muerta, re-anclaje encolado)"
                          : "canónico verificado (cache)",
                        lastCheckedAt: new Date(),
                      };
                    }),
                  )
                  .onConflictDoNothing()
                  .catch((e) => console.error(`[generation] pin de videos falló:`, e));
              } else if (!gateRejectedCanon) {
                // Ningún video del canon sigue vivo → curación fresca para
                // ESTE usuario (la guía/quiz anclados ya se quitaron arriba).
                const vids = await curateAndSaveVideo(
                  lessonId,
                  cachedLesson.videoQuery ?? queryByIndex.get(li) ?? ls.title,
                  m.objective,
                  intake.language,
                  skeleton.title,
                  usedVideoIds,
                );
                for (const v of vids) usedVideoIds.add(v.videoId);
              }
            }

            await Promise.all([
              db
                .update(lessonsT)
                .set({
                  content: contentToServe,
                  notes: contentToServe.keyTakeaways.join("\n• "),
                })
                .where(eq(lessonsT.id, lessonId)),
              quizToServe?.questions?.length
                ? saveQuizData(lessonId, ls.title, quizToServe).catch((e) =>
                    console.error(`[generation] quiz cacheado falló:`, e),
                  )
                : Promise.resolve(),
              db
                .update(lessonContentCache)
                .set({
                  timesReused: sql`${lessonContentCache.timesReused} + 1`,
                  updatedAt: new Date(),
                })
                .where(eq(lessonContentCache.id, cachedLesson.id)),
            ]);
            done++;
            await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
            return {
              title: ls.title,
              label,
              takeaways: contentToServe.keyTakeaways,
              // Vocabulario desde el canon (columna terminology): el resume
              // tras timeout y los compradores B..N reconstruyen el MISMO
              // vocab que el run fresco (filas legacy sin la columna → []).
              terminology: cachedLesson.terminology ?? [],
            };
          }

          /* ------------------------- CACHE MISS ------------------------ */
          // STAGE B — curar video + digest del top-1 (con coverage gate).
          const query = queryByIndex.get(li) ?? ls.title;
          // El ranker recibe lección específica + nivel DENTRO del objetivo
          // (A-P1.7; curate.ts es de Track E — este es el canal existente).
          const rankObjective = `${m.objective} · LECCIÓN: ${ls.title} — ${ls.summary} · NIVEL DEL ESTUDIANTE: ${skeleton.level}`;
          const curated = await curateAndSaveVideoDetailed(
            lessonId,
            query,
            rankObjective,
            intake.language,
            skeleton.title,
            usedVideoIds,
          );
          const vids = curated.vids;
          for (const v of vids) usedVideoIds.add(v.videoId);
          let topVideo = vids[0] ?? null;
          let digest: VideoDigest | null = null;
          if (topVideo) {
            try {
              // El contexto de la RUTA viaja al coverage: un video del tema
              // correcto pero del medio equivocado (DSLR vs celular) puntúa bajo.
              const coverageSummary = `${ls.summary} (contexto de la ruta: ${skeleton.title})`;
              let ins = await getVideoInsights({
                videoId: topVideo.videoId,
                lessonSummary: coverageSummary,
                language: intake.language,
                durationSeconds: topVideo.durationSeconds ?? null,
              });
              // Coverage gate con coverage EFECTIVO (penaliza nivel roto):
              // si el video no cubre la lección, prueba el #2 y gana el mejor.
              const alt = vids[1];
              if (ins && effectiveCoverage(ins.digest, skeleton.level) < 0.5 && alt) {
                const altIns = await getVideoInsights({
                  videoId: alt.videoId,
                  lessonSummary: coverageSummary,
                  language: intake.language,
                  durationSeconds: alt.durationSeconds ?? null,
                });
                if (
                  altIns &&
                  effectiveCoverage(altIns.digest, skeleton.level) >
                    effectiveCoverage(ins.digest, skeleton.level)
                ) {
                  ins = altIns;
                  topVideo = alt;
                  await swapVideoRanks(lessonId, alt.videoId).catch((e) =>
                    console.error(`[generation] swap de rank falló:`, e),
                  );
                }
              }
              // PISO DE COVERAGE: si ni el mejor candidato trata de lo que la
              // lección necesita, mejor SIN video principal que uno irrelevante.
              // Se desactivan TODOS los candidatos (A-P0.1): antes solo caía
              // el rank 0 y la UI promovía al rank 1 jamás verificado.
              if (ins && effectiveCoverage(ins.digest, skeleton.level) < 0.35) {
                await db
                  .update(videoCandidates)
                  .set({ isActive: false })
                  .where(eq(videoCandidates.lessonId, lessonId))
                  .catch(() => {});
                topVideo = null;
                ins = null;
              }
              digest = ins?.digest ?? null;
            } catch (e) {
              console.error(`[generation] digest falló (lección ${lessonId}):`, e);
            }
          }

          // STAGE C — lección ANCLADA al video + CONTEXTO ACUMULADO (A-P0.2).
          const courseContext = renderCourseContext({
            skeleton,
            memory: courseMemory,
            vocab,
            mi,
            li,
            globalIndex: lessonsBefore + li + 1,
            totalLessons,
            siblings: lessons
              .filter((_, i) => i !== li)
              .map(({ ls: sib }) => ({ title: sib.title, summary: sib.summary })),
          });
          const content = await generateLessonContent({
            pathTitle: skeleton.title,
            moduleTitle: m.title,
            moduleObjective: m.objective,
            lessonTitle: ls.title,
            lessonSummary: ls.summary,
            level: skeleton.level,
            language: intake.language,
            videoDigest: digest,
            videoDurationSeconds: topVideo?.durationSeconds ?? null,
            courseContext,
            tracking: { pathId },
          });
          await db
            .update(lessonsT)
            .set({ content, notes: content.keyTakeaways.join("\n• ") })
            .where(eq(lessonsT.id, lessonId));

          // STAGE D — quiz DESPUÉS de la lección, grounded en contenido +
          // anclas + 1 pregunta de repaso espaciado de módulos anteriores.
          const quizData = await generateAndSaveQuiz(
            lessonId,
            ls.title,
            ls.summary,
            skeleton.level,
            intake.language,
            content,
            digest,
            topVideo?.durationSeconds ?? null,
            { reviewContext: renderQuizReviewContext(courseMemory), pathId },
          ).catch((e) => {
            console.error(`[generation] quiz falló (lección ${lessonId}):`, e);
            return null;
          });

          // GATE DE CALIDAD DEL CANON (A-P0.1): SOLO un quiz nulo deja la
          // lección fuera del canon. Si la curación de video falló (cuota
          // YouTube agotada / API caída), el contenido y el quiz ya son
          // válidos y costaron lo mismo → se cachean HONESTOS (videoIds: [],
          // anchored=false) y la lección entra al backfill, que repara el
          // canon una sola vez para todos. No cachear regalaba el costo
          // Sonnet completo x N compradores (y el retry de Trigger lo
          // re-pagaba otra vez).
          const cacheable = quizData != null;
          if (cacheable) {
            // Orden final: el verificado por coverage primero. Si el gate
            // rechazó todos los candidatos → canon honesto con videoIds: [].
            const finalVideoIds = topVideo
              ? [
                  topVideo.videoId,
                  ...vids.filter((v) => v.videoId !== topVideo!.videoId).map((v) => v.videoId),
                ]
              : [];
            await db
              .insert(lessonContentCache)
              .values({
                cacheKey,
                moduleIndex: mi,
                lessonIndex: li,
                version: PROMPT_VERSION,
                content,
                quiz: quizData,
                videoIds: finalVideoIds,
                anchoredVideoId: digest && topVideo ? topVideo.videoId : null,
                videoQuery: query,
                hadDigest: digest != null,
                coverage: digest?.coverage ?? null,
                videoCount: finalVideoIds.length,
                quizOk: true,
                anchored: digest != null && topVideo != null,
                // Vocabulario persistido (A-P0.2): el HIT/resume reconstruye
                // el vocab del run desde aquí — determinístico por esqueleto.
                terminology: digest?.terminology.slice(0, 5) ?? [],
              })
              .onConflictDoNothing({
                target: [
                  lessonContentCache.cacheKey,
                  lessonContentCache.moduleIndex,
                  lessonContentCache.lessonIndex,
                  lessonContentCache.version,
                ],
              })
              .catch((e) =>
                console.error(`[generation] cache de lección falló:`, e),
              );
          } else {
            console.warn(
              `[generation] lección ${label} NO entra al canon (quiz nulo; digest=${digest != null}, videos=${vids.length}) — el próximo miss la reintenta completa.`,
            );
          }

          // Curación REVENTADA (cuota/API) y sin videos: la celda quedó
          // cacheada honesta sin video — el cron backfill-videos la re-ancla
          // y escribe de vuelta al canon (reanchorLesson). Una búsqueda
          // legítimamente vacía NO se encola: el gate ya decidió que no hay
          // video para esto (mismo trato que el coverage rechazado).
          if (curated.failed && vids.length === 0) {
            await enqueueVideoBackfill(
              lessonId,
              curated.quotaError ? "quota_exceeded" : "curation_failed",
            );
          }

          done++;
          await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
          // La terminología NO muta `vocab` aquí (carrera intra-módulo: las
          // hermanas corren en paralelo): viaja en el outcome y se incorpora
          // tras el allSettled, en orden de lección.
          return {
            title: ls.title,
            label,
            takeaways: content.keyTakeaways,
            terminology: digest?.terminology.slice(0, 5) ?? [],
          };
        }),
      );

      // allSettled (A-P0.1): una lección caída NO tumba el módulo ni los
      // siguientes. Las fallidas se acumulan y el run termina lanzando para
      // que el retry de Trigger regenere SOLO esas (idempotente por lección).
      const moduleOutcomes: LessonOutcome[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          moduleOutcomes.push(r.value);
        } else {
          const t = lessons[i]?.ls.title ?? `lección ${i + 1}`;
          failedLessons.push(`${mi + 1}.${i + 1} «${t}»`);
          console.error(
            `[generation] lección ${mi + 1}.${i + 1} "${t}" falló (las demás continúan):`,
            r.reason,
          );
        }
      });
      courseMemory.push({ moduleTitle: m.title, lessons: moduleOutcomes });
      // Vocabulario del curso (A-P0.2): se incorpora SOLO al cerrar el módulo
      // y en orden de lección. Mutarlo dentro de la lambda paralela hacía que
      // el contexto de la 3.2 incluyera (o no) la terminología de la 3.1
      // según el orden de término — el canon dejaba de ser determinístico.
      // (Las hermanas no se ven la terminología entre sí, consistente con que
      // tampoco se ven los takeaways vía courseMemory.)
      for (const o of moduleOutcomes) for (const t of o.terminology) vocab.add(t);

      // El PRIMER módulo con contenido completo → correo "tu ruta está lista,
      // empieza por aquí" (uno solo por ruta; dedupe por moduleId).
      const firstPlan = plan[0];
      if (!firstModuleEmailSent && firstPlan && firstPlan.lessons.length) {
        firstModuleEmailSent = true;
        const [firstModule] = await db
          .select({ id: modulesT.id })
          .from(modulesT)
          .where(and(eq(modulesT.pathId, pathId), eq(modulesT.orderIndex, 0)))
          .limit(1);
        if (firstModule) {
          const { enqueueProgressEmail } = await import("@/lib/email/enqueue");
          await enqueueProgressEmail(path.userId, "module_ready", firstModule.id, {
            pathId,
            pathTitle: skeleton.title,
            moduleId: firstModule.id,
            moduleTitle: firstPlan.m.title,
            lessonTitles: firstPlan.m.lessons.map((l) => l.title),
            language: intake.language,
          });
        }
      }
    }

    if (failedLessons.length) {
      // La ruta sigue 'ready' (lo generado se usa); el throw dispara el retry
      // de Trigger, que resume vía caché y regenera SOLO las fallidas. Si los
      // 3 intentos mueren, onFailure alerta "ready incompleta" al fundador.
      throw new Error(
        `[generation] ${failedLessons.length} lección(es) sin contenido tras el run: ${failedLessons.join(" · ")}.`,
      );
    }

    // Contenido completo (la ruta ya estaba 'ready' desde el Paso 1).
    await db
      .update(learningPaths)
      .set({ generationProgress: 100, generationStep: "Completo", updatedAt: new Date() })
      .where(eq(learningPaths.id, pathId));
  } catch (err) {
    console.error(`[generation] Falló la ruta ${pathId}:`, err);
    // Si la estructura ya existe (status ready), no la marcamos failed: el usuario
    // puede usar lo generado y un reintento rellena lo que falte (idempotente).
    const [p] = await db
      .select({ status: learningPaths.status })
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId))
      .limit(1);
    if (p && p.status !== "ready") {
      await db
        .update(learningPaths)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(learningPaths.id, pathId));
    }
    throw err;
  }
}

/** Inserta un quiz (generado o cacheado) en una transacción idempotente. */
export async function saveQuizData(
  lessonId: string,
  title: string,
  quiz: GeneratedQuizData,
) {
  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  await db.transaction(async (tx) => {
    const [qz] = await tx
      .insert(quizzesT)
      .values({ lessonId, title: `Quiz: ${title}` })
      .onConflictDoUpdate({
        target: quizzesT.lessonId,
        set: { title: `Quiz: ${title}` },
      })
      .returning();
    if (qz && quiz.questions.length) {
      await tx.delete(questionsT).where(eq(questionsT.quizId, qz.id));
      await tx.insert(questionsT).values(
        quiz.questions.map((q, qi) => ({
          quizId: qz.id,
          orderIndex: qi,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correctOptionIds,
          // El grounding validado viaja en la explicación (visible al corregir).
          explanation:
            q.grounding?.timestampSeconds != null
              ? `${q.explanation} ⏱ El video lo explica en ${mmss(q.grounding.timestampSeconds)}.`
              : q.explanation,
        })),
      );
    }
  });
}

/** Genera y guarda el quiz de una lección (devuelve el quiz para cachearlo).
 *  Corre DESPUÉS de la lección: recibe contenido final + digest del video para
 *  que las preguntas evalúen lo que el estudiante realmente vio y leyó. */
export async function generateAndSaveQuiz(
  lessonId: string,
  title: string,
  summary: string,
  level: string,
  language: string,
  lessonContent?: LessonContent | null,
  videoDigest?: VideoDigest | null,
  videoDurationSeconds?: number | null,
  opts?: { reviewContext?: string | null; pathId?: string | null },
): Promise<GeneratedQuizData> {
  const quiz = await generateQuiz({
    lessonTitle: title,
    lessonSummary: summary,
    level,
    language,
    lessonContent,
    videoDigest,
    videoDurationSeconds,
    reviewContext: opts?.reviewContext ?? null,
    tracking: { pathId: opts?.pathId ?? null },
  });
  await saveQuizData(lessonId, title, quiz);
  return quiz;
}

/** Resultado detallado de la curación. `failed` distingue "la curación
 *  REVENTÓ" (cuota agotada / API caída → transitorio, reparable vía backfill)
 *  de "la búsqueda fue legítimamente vacía" (no hay video para esto). */
type CurationResult = {
  vids: Awaited<ReturnType<typeof curateVideoForLesson>>;
  failed: boolean;
  quotaError: boolean;
};

/** Cura y guarda videos de una lección (idempotente; nunca aborta la ruta).
 *  Devuelve los candidatos curados (rank asc) + diagnóstico del fallo, para
 *  que el gate del canon distinga cuota agotada de búsqueda vacía (A-P0.1). */
export async function curateAndSaveVideoDetailed(
  lessonId: string,
  query: string,
  objective: string,
  language: string,
  routeTopic?: string,
  excludeVideoIds?: Set<string>,
): Promise<CurationResult> {
  try {
    const vids = await curateVideoForLesson({
      query,
      objective,
      language,
      routeTopic,
      excludeVideoIds,
    });
    if (vids.length) {
      await db
        .insert(videoCandidates)
        .values(
          vids.map((v) => ({
            lessonId,
            youtubeVideoId: v.videoId,
            title: v.title,
            channelTitle: v.channelTitle,
            rank: v.rank,
            score: v.score,
            language: v.language,
            durationSeconds: v.durationSeconds,
            reason: v.reason,
            lastCheckedAt: new Date(), // cumplimiento: marca temporal de frescura
          })),
        )
        .onConflictDoNothing();
    }
    return { vids, failed: false, quotaError: false };
  } catch (err) {
    console.error(`[generation] Curación de video falló (lección ${lessonId}):`, err);
    return { vids: [], failed: true, quotaError: err instanceof YouTubeQuotaError };
  }
}

/** Wrapper retro-compatible (extend.ts y los backfills consumen el array). */
export async function curateAndSaveVideo(
  lessonId: string,
  query: string,
  objective: string,
  language: string,
  routeTopic?: string,
  excludeVideoIds?: Set<string>,
): Promise<Awaited<ReturnType<typeof curateVideoForLesson>>> {
  const r = await curateAndSaveVideoDetailed(
    lessonId,
    query,
    objective,
    language,
    routeTopic,
    excludeVideoIds,
  );
  return r.vids;
}

/** Promueve a rank 0 el video que ganó el coverage gate (swap seguro con el
 *  índice único lesson+rank: 0→99, ganador→0, 99→1). Exportada: extend.ts y
 *  los backfills de Track E la consumen. */
export async function swapVideoRanks(lessonId: string, winnerVideoId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(videoCandidates)
      .set({ rank: 99 })
      .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.rank, 0)));
    await tx
      .update(videoCandidates)
      .set({ rank: 0 })
      .where(
        and(
          eq(videoCandidates.lessonId, lessonId),
          eq(videoCandidates.youtubeVideoId, winnerVideoId),
        ),
      );
    await tx
      .update(videoCandidates)
      .set({ rank: 1 })
      .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.rank, 99)));
  });
}

/**
 * Re-ancla UNA lección ya generada: digest del video (con coverage gate sobre
 * el candidato #2) → regenera el contenido anclado → regenera el quiz grounded
 * → ESCRIBE DE VUELTA la celda del canon (lesson_content_cache), si existe.
 * Para backfills de rutas generadas sin digest (p.ej. cuota de Gemini agotada)
 * y para drenar video_backfill_queue (cron de Track E).
 * Sin el write-back, el link-rot des-anclaba el canon PARA SIEMPRE: cada
 * comprador futuro recibía la celda degradada (sin guía, quiz despojado) y la
 * reparación solo arreglaba la copia del usuario que la encoló.
 */
export async function reanchorLesson(lessonId: string): Promise<string> {
  const [row] = await db
    .select({
      lessonTitle: lessonsT.title,
      stubSummary: lessonsT.stubSummary,
      lessonIndex: lessonsT.orderIndex,
      moduleTitle: modulesT.title,
      moduleObjective: modulesT.objective,
      moduleIndex: modulesT.orderIndex,
      pathId: learningPaths.id,
      pathTitle: learningPaths.title,
      level: learningPaths.level,
      language: learningPaths.language,
      skeletonCacheKey: learningPaths.skeletonCacheKey,
    })
    .from(lessonsT)
    .innerJoin(modulesT, eq(modulesT.id, lessonsT.moduleId))
    .innerJoin(learningPaths, eq(learningPaths.id, modulesT.pathId))
    .where(eq(lessonsT.id, lessonId))
    .limit(1);
  if (!row) return "lección no encontrada";

  // Celda del canon de esta lección: (skeletonCacheKey de la ruta, índices de
  // módulo/lección, versión vigente). Aporta el videoQuery original para la
  // re-curación y es el destino del write-back final.
  const canonWhere = row.skeletonCacheKey
    ? and(
        eq(lessonContentCache.cacheKey, row.skeletonCacheKey),
        eq(lessonContentCache.moduleIndex, row.moduleIndex),
        eq(lessonContentCache.lessonIndex, row.lessonIndex),
        eq(lessonContentCache.version, PROMPT_VERSION),
      )
    : null;
  let canonVideoQuery: string | null = null;
  if (canonWhere) {
    const [cell] = await db
      .select({ videoQuery: lessonContentCache.videoQuery })
      .from(lessonContentCache)
      .where(canonWhere)
      .limit(1);
    canonVideoQuery = cell?.videoQuery ?? null;
  }

  const activeCandidates = () =>
    db
      .select()
      .from(videoCandidates)
      .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.isActive, true)))
      .orderBy(videoCandidates.rank)
      .limit(2);

  let vids = await activeCandidates();
  if (!vids.length) {
    // Sin candidatos vivos (cuota agotada al generar, o todos muertos):
    // curación FRESCA en vez de devolver "sin video" — la cola existe justo
    // para reparar estas lecciones cuando la cuota se repone.
    await curateAndSaveVideo(
      lessonId,
      canonVideoQuery ?? row.lessonTitle,
      row.moduleObjective ?? "",
      row.language,
      row.pathTitle,
    );
    vids = await activeCandidates();
    if (!vids.length) return "sin video";
  }

  // stub_summary real (A-P2): antes se usaba el título como summary y el
  // coverage gate + la lección regenerada perdían la descripción original.
  const baseSummary = row.stubSummary?.trim() ? row.stubSummary : row.lessonTitle;
  const summary = `${baseSummary} (contexto de la ruta: ${row.pathTitle})`;
  let top = vids[0]!;
  let ins = await getVideoInsights({
    videoId: top.youtubeVideoId,
    lessonSummary: summary,
    language: row.language,
    durationSeconds: top.durationSeconds ?? null,
  });
  const alt = vids[1];
  if (ins && effectiveCoverage(ins.digest, row.level) < 0.5 && alt) {
    const altIns = await getVideoInsights({
      videoId: alt.youtubeVideoId,
      lessonSummary: summary,
      language: row.language,
      durationSeconds: alt.durationSeconds ?? null,
    });
    if (altIns && effectiveCoverage(altIns.digest, row.level) > effectiveCoverage(ins.digest, row.level)) {
      ins = altIns;
      top = alt;
      await swapVideoRanks(lessonId, alt.youtubeVideoId).catch(() => {});
    }
  }
  if (!ins) return "digest no disponible";

  const content = await generateLessonContent({
    pathTitle: row.pathTitle,
    moduleTitle: row.moduleTitle,
    moduleObjective: row.moduleObjective ?? "",
    lessonTitle: row.lessonTitle,
    lessonSummary: baseSummary,
    level: row.level,
    language: row.language,
    videoDigest: ins.digest,
    videoDurationSeconds: top.durationSeconds ?? null,
    tracking: { pathId: row.pathId, label: "generator.reanchor" },
  });
  await db
    .update(lessonsT)
    .set({ content, notes: content.keyTakeaways.join("\n• ") })
    .where(eq(lessonsT.id, lessonId));

  const quizData = await generateAndSaveQuiz(
    lessonId,
    row.lessonTitle,
    baseSummary,
    row.level,
    row.language,
    content,
    ins.digest,
    top.durationSeconds ?? null,
    { pathId: row.pathId },
  );

  // WRITE-BACK AL CANON: el link-rot se repara UNA vez (no por usuario).
  // Restaura el invariante del gate de calidad: contenido anclado + quiz
  // grounded + diagnóstico coherente. Si la celda no existe (ruta legacy
  // jamás cacheada), el UPDATE afecta 0 filas y no pasa nada.
  let canonNote = "";
  if (canonWhere) {
    const videoIds = [
      top.youtubeVideoId,
      ...vids.filter((v) => v.youtubeVideoId !== top.youtubeVideoId).map((v) => v.youtubeVideoId),
    ];
    const updated = await db
      .update(lessonContentCache)
      .set({
        content,
        quiz: quizData,
        videoIds,
        anchoredVideoId: top.youtubeVideoId,
        anchored: true,
        hadDigest: true,
        coverage: ins.digest.coverage,
        videoCount: videoIds.length,
        quizOk: true,
        terminology: ins.digest.terminology.slice(0, 5),
        updatedAt: new Date(),
      })
      .where(canonWhere)
      .returning({ id: lessonContentCache.id })
      .catch((e) => {
        console.error(`[generation] write-back del canon falló (lección ${lessonId}):`, e);
        return [] as { id: string }[];
      });
    canonNote = updated.length ? ", canon reparado" : "";
  }
  return `anclada (coverage ${ins.digest.coverage.toFixed(2)}, video ${top.youtubeVideoId}${canonNote})`;
}

/**
 * Encola la generación.
 * - Producción: Trigger.dev (sin límite de tiempo). Obligatorio.
 * - Dev (`next dev`): corre inline (el proceso de Node persiste, no hay timeout).
 * - Serverless sin Trigger: se rechaza (el `void` moriría al responder la acción).
 */
export async function enqueuePathGeneration(pathId: string): Promise<void> {
  if (env.TRIGGER_SECRET_KEY) {
    const { tasks } = await import("@trigger.dev/sdk");
    await tasks.trigger("generate-path", { pathId });
  } else if (env.NODE_ENV !== "production") {
    // Solo dev: en `next dev` el proceso sigue vivo tras responder la acción.
    void runPathGeneration(pathId).catch((e) =>
      console.error("[generation] inline (dev) falló:", e),
    );
  } else {
    throw new Error(
      "[config] En producción se requiere TRIGGER_SECRET_KEY: no hay modo inline seguro en serverless.",
    );
  }
}
