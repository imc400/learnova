import Link from "next/link";
import { redirect } from "next/navigation";
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

export const metadata = { title: "Comunidad" };

const PODIUM_STYLES = [
  "border-amber-400/60 bg-amber-400/10", // 1°
  "border-zinc-400/60 bg-zinc-300/10", // 2°
  "border-orange-700/40 bg-orange-700/10", // 3°
];

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
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <BookOpen className="size-3 shrink-0" /> Estudiando {row.studying}
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
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Comunidad
        </h1>
        <p className="text-sm text-muted-foreground">
          Quienes están aprendiendo en Aulia, esta semana y de siempre.
        </p>
      </div>

      {/* Mi posición */}
      {myRank && myRank.rank !== null && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <Trophy className="size-5 text-primary" />
          <p className="text-sm">
            Esta semana vas <strong>#{myRank.rank}</strong> de{" "}
            {myRank.total.toLocaleString("es-CL")} con{" "}
            <strong>{myRank.xp} XP</strong>. ¡Sigue así!
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Link
          href="/app/comunidad"
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            !isAllTime
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Esta semana
        </Link>
        <Link
          href="/app/comunidad?tab=historico"
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            isAllTime
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Histórico
        </Link>
      </div>

      {board.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <Medal className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-display font-semibold">
            Aún no hay actividad esta semana
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Completa una lección y estrena el ranking.
          </p>
        </div>
      ) : (
        <>
          {/* Podio */}
          {podium.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {podium.map((row, i) => (
                <div
                  key={row.userId}
                  className={`rounded-xl border p-4 text-center ${PODIUM_STYLES[i]}`}
                >
                  <p className="text-2xl">{["🥇", "🥈", "🥉"][i]}</p>
                  <span className="mx-auto mt-2 grid size-11 place-items-center rounded-full bg-card text-sm font-bold text-primary">
                    {initials(row.displayName)}
                  </span>
                  <p className="mt-2 truncate text-sm font-bold">{row.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    Nivel {row.level}
                    {row.streak > 0 && ` · 🔥 ${row.streak}`}
                  </p>
                  <p className="mt-1 text-sm font-extrabold text-primary">
                    {row.xp.toLocaleString("es-CL")} XP
                  </p>
                  {row.studying && (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {row.studying}
                    </p>
                  )}
                </div>
              ))}
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

      {/* Privacidad: visibilidad + alias */}
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
