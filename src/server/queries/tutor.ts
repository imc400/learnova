import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tutorConversations, tutorMessages } from "@/db/schema";

/*
  Persistencia del Tutor de IA — SIN migración: usa las tablas existentes
  tutor_conversations / tutor_messages tal como están.

  DECISIÓN (schema sin lessonId ni metadata): la conversación es POR LECCIÓN
  y la clave determinista viaja en `title` con el formato "leccion:<lessonId>".
  userId + pathId + title identifican la conversación. Si algún día se agrega
  una columna lesson_id, migrar es un UPDATE parseando el title.
*/

export type TutorMsg = { role: "user" | "assistant"; content: string };

/** Máximo de mensajes conservados por conversación (los más viejos se podan). */
export const TUTOR_MAX_STORED_MESSAGES = 60;

/** Cuántos mensajes se hidratan en la página de lección. */
export const TUTOR_INITIAL_MESSAGES = 24;

export function lessonConversationKey(lessonId: string): string {
  return `leccion:${lessonId}`;
}

/** Conversación de esta lección + sus últimos mensajes (orden cronológico). */
export async function getLessonConversation(
  userId: string,
  pathId: string,
  lessonId: string,
): Promise<TutorMsg[]> {
  const [conv] = await db
    .select({ id: tutorConversations.id })
    .from(tutorConversations)
    .where(
      and(
        eq(tutorConversations.userId, userId),
        eq(tutorConversations.pathId, pathId),
        eq(tutorConversations.title, lessonConversationKey(lessonId)),
      ),
    )
    // Determinista ante un duplicado por carrera: siempre la más antigua.
    .orderBy(asc(tutorConversations.createdAt))
    .limit(1);
  if (!conv) return [];

  const rows = await db
    .select({ role: tutorMessages.role, content: tutorMessages.content })
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conv.id))
    .orderBy(desc(tutorMessages.createdAt), desc(tutorMessages.id))
    .limit(TUTOR_INITIAL_MESSAGES);
  return rows.reverse();
}

/**
 * Persiste un intercambio user+assistant (creando la conversación si no
 * existe) y poda al máximo de mensajes. Best-effort: pensado para llamarse
 * post-stream sin bloquear la respuesta — el caller hace .catch().
 */
export async function appendTutorExchange(params: {
  userId: string;
  pathId: string;
  lessonId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  const { userId, pathId, lessonId, userText, assistantText } = params;
  if (!userText.trim() || !assistantText.trim()) return;

  const key = lessonConversationKey(lessonId);
  const [existing] = await db
    .select({ id: tutorConversations.id })
    .from(tutorConversations)
    .where(
      and(
        eq(tutorConversations.userId, userId),
        eq(tutorConversations.pathId, pathId),
        eq(tutorConversations.title, key),
      ),
    )
    .orderBy(asc(tutorConversations.createdAt))
    .limit(1);

  let conversationId = existing?.id;
  if (!conversationId) {
    const [created] = await db
      .insert(tutorConversations)
      .values({ userId, pathId, title: key })
      .returning({ id: tutorConversations.id });
    conversationId = created?.id;
  }
  if (!conversationId) return;

  // Timestamps explícitos y escalonados: defaultNow() en lote empata y el
  // orden user→assistant se volvería ambiguo al hidratar.
  const t = new Date();
  await db.insert(tutorMessages).values([
    { conversationId, role: "user", content: userText, createdAt: t },
    {
      conversationId,
      role: "assistant",
      content: assistantText,
      createdAt: new Date(t.getTime() + 1),
    },
  ]);

  // Poda best-effort: conserva solo los últimos N mensajes.
  await db
    .execute(
      sql`delete from tutor_messages
          where conversation_id = ${conversationId}
            and id not in (
              select id from tutor_messages
              where conversation_id = ${conversationId}
              order by created_at desc, id desc
              limit ${TUTOR_MAX_STORED_MESSAGES}
            )`,
    )
    .catch(() => {});
}
