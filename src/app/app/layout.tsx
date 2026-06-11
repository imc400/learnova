import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { getUserStats } from "@/server/queries/gamification";
import { Logo } from "@/components/brand/logo";
import { AppNavDesktop, AppNavMobile } from "@/components/app/app-nav";
import { UserStatsChips } from "@/components/app/user-stats-chips";
import { SupportBubble } from "@/components/app/support-bubble";
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

  const [stats, admin] = await Promise.all([getUserStats(user.id), isAdminUser()]);

  // Nombre de pila para el chip de perfil (visible desde sm; antes el email
  // vivía escondido tras `hidden lg:inline`).
  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.trim().split(/\s+/)[0] ||
    "Mi perfil";

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background md:bg-background/90 md:backdrop-blur-sm">
        <div className="container-page flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo href="/app" />
            <AppNavDesktop admin={!!admin} />
          </div>
          <div className="flex items-center gap-3">
            {stats && (
              <UserStatsChips
                level={stats.level}
                totalXp={stats.totalXp}
                streak={stats.currentStreak}
                levelProgress={stats.levelProgress}
                freezes={stats.streakFreezes}
              />
            )}
            <Link
              href="/app/perfil"
              className="hidden min-h-11 items-center rounded-full border border-border bg-card px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              {firstName}
            </Link>
            <form action="/auth/signout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Cerrar sesión"
              >
                <LogOut className="size-4" />
              </Button>
            </form>
            <AppNavMobile admin={!!admin} perfilLabel={firstName} />
          </div>
        </div>
      </header>
      <main className="container-page py-8">{children}</main>
      <SupportBubble />
      <footer className="border-t border-border bg-muted">
        <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-xs text-muted-foreground">
          <span>© Aulia</span>
          <span>Garantía de 7 días</span>
          <a href="mailto:hola@aulia.ai" className="hover:text-foreground">
            hola@aulia.ai
          </a>
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
