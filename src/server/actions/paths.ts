"use server";

import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths, xpEvents } from "@/db/schema";
import { intakeSchema } from "@/lib/ai/schemas";
import {
  generateWizardQuestions,
  fallbackQuestions,
  type WizardQuestion,
} from "@/lib/ai/wizard";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { getEntitlement, FREE_PATH_LIMIT } from "@/lib/subscription";
import { slugify } from "@/lib/utils";

/**
 * Paso 1 → 2 del intake adaptativo: preguntas a medida del tema (Haiku).
 * Nunca falla hacia el usuario: si la IA no responde, hay set de respaldo.
 */
export async function wizardQuestionsAction(args: {
  topic: string;
  level: string;
  language: string;
}): Promise<{ questions: WizardQuestion[]; adaptive: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const topic = String(args.topic ?? "").trim().slice(0, 120);
  const level = ["principiante", "intermedio", "avanzado"].includes(args.level)
    ? args.level
    : "principiante";
  const language = ["es", "en", "pt"].includes(args.language) ? args.language : "es";
  if (topic.length < 2) {
    return { questions: fallbackQuestions(topic || "este tema"), adaptive: false };
  }
  return generateWizardQuestions({ topic, level, language });
}

/** Crea una ruta desde el cuestionario de intake y dispara su generación. */
export async function createPathAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Techo de costos con "cupo ganado": el límite free crece con cada ruta
  // COMPLETADA (ledger path_completed, no gameable por URL). Quien termina,
  // desbloquea la siguiente — solo los que aprenden generan costo nuevo.
  const { isPro } = await getEntitlement(user.id);
  if (!isPro) {
    const [[created], [completed]] = await Promise.all([
      db
        .select({ n: count() })
        .from(learningPaths)
        .where(eq(learningPaths.userId, user.id)),
      db
        .select({ n: count() })
        .from(xpEvents)
        .where(
          and(eq(xpEvents.userId, user.id), eq(xpEvents.source, "path_completed")),
        ),
    ]);
    const allowed = FREE_PATH_LIMIT + Number(completed?.n ?? 0);
    if (Number(created?.n ?? 0) >= allowed) {
      redirect("/app/planes?motivo=limite-rutas");
    }
  }

  // Métrica norte del "Siguiente paso": de qué ruta completada nació esta.
  const fromRaw = String(formData.get("from") ?? "");
  let sourcePathId: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(fromRaw)) {
    const [owned] = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(and(eq(learningPaths.id, fromRaw), eq(learningPaths.userId, user.id)))
      .limit(1);
    if (owned) sourcePathId = owned.id;
  }

  const weekly = formData.get("weeklyHours");
  const parsed = intakeSchema.safeParse({
    topic: String(formData.get("topic") ?? "").trim(),
    goal: String(formData.get("goal") ?? "").trim(),
    level: String(formData.get("level") ?? "principiante"),
    priorExperience: formData.get("priorExperience")
      ? String(formData.get("priorExperience"))
      : undefined,
    weeklyHours: weekly ? Number(weekly) : undefined,
    language: String(formData.get("language") || "es"),
  });

  if (!parsed.success) {
    redirect("/app/crear?error=validacion");
  }

  const intake = parsed.data;
  const slug = `${slugify(intake.topic)}-${Math.random().toString(36).slice(2, 7)}`;

  const [path] = await db
    .insert(learningPaths)
    .values({
      userId: user.id,
      title: intake.topic,
      slug,
      goal: intake.goal,
      topic: intake.topic,
      level: intake.level,
      language: intake.language,
      status: "generating",
      intake,
      sourcePathId,
    })
    .returning();

  if (!path) throw new Error("No se pudo crear la ruta.");

  await enqueuePathGeneration(path.id);
  redirect(`/app/rutas/${path.id}`);
}
