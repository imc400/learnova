import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { Flame, Trophy, BookOpen, Eye, EyeOff, Medal, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getWeeklyBoard,
  getAllTimeBoard,
  getMyWeeklyRank,
  type BoardRow,
} from "@/lib/leaderboard";
import { updateLeaderboardIdentityAction } from "@/server/actions/profile";
import { SubmitButton } from "@/components/app/submit-button";
import { PageHeader } from "@/components/app/brand/page-header";
import { EmptyState } from "@/components/app/brand/empty-state";

export const metadata = { title: "Comunidad" };

/* Podio de marca: 1° ámbar resaltador, 2°/3° papel. Rotación de sticker
   estática (sin -auto: el ranking es estado persistente, no celebración). */
const PODIUM_STYLES = [
  "border-accent bg-highlight-soft", // 1°
  "border-border bg-card", // 2°
  "border-border bg-card", // 3°
];
const PODIUM_ROTATIONS = ["-2deg", "1.5deg", "-1deg"];

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Row({ row, isMe }: { row: BoardRow; isMe: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 ${
        isMe ? "bg-primary/5" : ""
      }`}
    >
      <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-muted-foreground">
        {row.rank}
      </span>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {initials(row.displayName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {row.displayName}
          {isMe && <span className="ml-1.5 text-xs font-normal text-primary">(tú)</span>}
        </p>
        {row.studying && (
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <BookOpen className="size-3 shrink-0" />
            <span className="truncate">Estudiando {row.studying}</span>
          </p>
        )}
      </div>
      <span className="hidden items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground sm:flex">
        <Star className="size-3" /> Nv {row.level}
      </span>
      {row.streak > 0 && (
        <span className="hidden items-center gap-0.5 text-xs font-semibold text-accent-foreground sm:flex">
          <Flame className="size-3.5 text-accent" /> {row.streak}
        </span>
      )}
      <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums text-primary">
        {row.xp.toLocaleString("es-CL")} XP
      </span>
    </li>
  );
}

export default async function ComunidadPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isAllTime = tab === "historico";
  const [board, myRank, [myProfile]] = await Promise.all([
    isAllTime ? getAllTimeBoard() : getWeeklyBoard(),
    getMyWeeklyRank(user.id),
    db
      .select({
        visible: profiles.leaderboardVisible,
        alias: profiles.leaderboardAlias,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const podium = board.rows.slice(0, 3);
  const rest = board.rows.slice(3);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <PageHeader
          className="mb-0"
          nota={isAllTime ? "de siempre ✺" : "tu semana ✺"}
          titulo="Comunidad"
          subtitulo="Quienes están aprendiendo en Aulia, esta semana y de siempre."
        />
        <p className="hand mt-2 inline-block rotate-[-2deg]">
          aquí nadie estudia solo ✺
        </p>
      </div>

      {/* Mi posición — el dato es semanal: solo en el tab "Esta semana". */}
      {!isAllTime && myRank && myRank.rank !== null && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-soft">
          <Trophy className="size-5 text-primary" />
          <p className="text-sm">
            Esta semana vas <strong>#{myRank.rank}</strong> de{" "}
            {myRank.total.toLocaleString("es-CL")} con{" "}
            <strong>{myRank.xp.toLocaleString("es-CL")} XP</strong>. ¡Sigue así!
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Link
          href="/app/comunidad"
          aria-current={!isAllTime ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
            !isAllTime
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Esta semana
        </Link>
        <Link
          href="/app/comunidad?tab=historico"
          aria-current={isAllTime ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
            isAllTime
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          De siempre
        </Link>
      </div>

      {board.rows.length === 0 ? (
        isAllTime ? (
          <EmptyState
            nota="aquí va a estar tu gente ✺"
            titulo="Aún no hay actividad"
            descripcion="Cuando alguien complete su primera lección, aparece aquí para siempre. Puedes ser tú."
            cta={{ href: "/app", label: "Ir a mis rutas" }}
          />
        ) : (
          <EmptyState
            nota="aquí va a estar tu gente ✺"
            titulo="Aún no hay actividad esta semana"
            descripcion="Completa una lección y estrena el ranking de la semana."
            cta={{ href: "/app", label: "Ir a mis rutas" }}
          />
        )
      ) : (
        <>
          {/* Podio */}
          {podium.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {podium.map((row, i) => {
                const isMe = row.userId === user.id;
                return (
                  <div
                    key={row.userId}
                    className={`sticker-pop w-full flex-col items-center rounded-xl border p-4 text-center shadow-soft ${PODIUM_STYLES[i]} ${
                      isMe ? "ring-2 ring-primary" : ""
                    }`}
                    style={{ "--pop-rotate": PODIUM_ROTATIONS[i] } as CSSProperties}
                  >
                    <p className="flex items-center justify-center gap-1.5 font-display text-sm font-bold">
                      <Medal className="size-5 text-accent" /> {i + 1}°
                    </p>
                    <span className="mx-auto mt-2 grid size-11 place-items-center rounded-full bg-card text-sm font-bold text-primary">
                      {initials(row.displayName)}
                    </span>
                    <p className="mt-2 w-full truncate text-sm font-bold">
                      {row.displayName}
                      {isMe && (
                        <span className="ml-1.5 text-xs font-normal text-primary">(tú)</span>
                      )}
                    </p>
                    <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      Nivel {row.level}
                      {row.streak > 0 && (
                        <>
                          {" · "}
                          <Flame className="size-3 text-accent" /> {row.streak}
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-sm font-extrabold text-primary">
                      {row.xp.toLocaleString("es-CL")} XP
                    </p>
                    {row.studying && (
                      <p className="mt-1 w-full truncate text-[11px] text-muted-foreground">
                        {row.studying}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Resto del ranking */}
          {rest.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {rest.map((row) => (
                <Row key={row.userId} row={row} isMe={row.userId === user.id} />
              ))}
            </ul>
          )}
        </>
      )}

      {/* Privacidad: visibilidad + alias — zona de sobriedad (formulario). */}
      <details className="rounded-lg border border-border bg-card px-4 py-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground">
          {myProfile?.visible ? (
            <Eye className="size-4" />
          ) : (
            <EyeOff className="size-4" />
          )}
          Tu privacidad en la comunidad
        </summary>
        <form
          action={updateLeaderboardIdentityAction}
          className="mt-4 flex flex-col gap-3"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="visible"
              defaultChecked={myProfile?.visible ?? true}
              className="accent-primary"
            />
            Aparecer en el ranking de la comunidad
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              Alias público (opcional — reemplaza tu nombre)
            </span>
            <input
              type="text"
              name="alias"
              defaultValue={myProfile?.alias ?? ""}
              placeholder="Ej: FotoNinja"
              maxLength={24}
              className="w-full max-w-xs rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Solo mostramos tu nombre de pila e inicial (o tu alias), nivel,
            racha y el tema que estudias. Nunca tu correo ni tus metas.
          </p>
          <SubmitButton variant="outline" size="sm" pendingText="Guardando…" className="self-start">
            Guardar
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
