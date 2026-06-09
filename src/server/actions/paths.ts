"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths } from "@/db/schema";
import { intakeSchema } from "@/lib/ai/schemas";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { slugify } from "@/lib/utils";

/** Crea una ruta desde el cuestionario de intake y dispara su generación. */
export async function createPathAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
    })
    .returning();

  if (!path) throw new Error("No se pudo crear la ruta.");

  await enqueuePathGeneration(path.id);
  redirect(`/app/rutas/${path.id}`);
}
