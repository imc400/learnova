import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, LayoutGrid, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/server/queries/gamification";
import { Logo } from "@/components/brand/logo";
import { UserStatsChips } from "@/components/app/user-stats-chips";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const stats = await getUserStats(user.id);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container-page flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo href="/app" />
            <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
              <Link href="/app" className="flex items-center gap-1.5 hover:text-foreground">
                <LayoutGrid className="size-4" /> Mis rutas
              </Link>
              <Link href="/app/crear" className="flex items-center gap-1.5 hover:text-foreground">
                <Plus className="size-4" /> Crear ruta
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {stats && (
              <UserStatsChips
                level={stats.level}
                totalXp={stats.totalXp}
                streak={stats.currentStreak}
                levelProgress={stats.levelProgress}
              />
            )}
            <span className="hidden text-sm text-muted-foreground lg:inline">
              {user.email}
            </span>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="icon" aria-label="Cerrar sesión">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="container-page py-8">{children}</main>
      <footer className="border-t border-border">
        <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-xs text-muted-foreground">
          <span>© Aulia</span>
          <Link href="/terminos" className="hover:text-foreground">
            Términos
          </Link>
          <Link href="/privacidad" className="hover:text-foreground">
            Privacidad
          </Link>
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Términos de YouTube
          </a>
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Privacidad de Google
          </a>
        </div>
      </footer>
    </div>
  );
}
