import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronDown,
  ClipboardList,
  Code2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  CalendarDays,
  X,
} from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { meQuery, ROLE_LABEL } from "@/lib/me";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  const name = me?.profile?.full_name || me?.user.email || "Account";
  const college = (me?.profile as { institutes?: { code: string } | null } | null)?.institutes
    ?.code;
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = [
    { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, group: "Main" },
    { label: "Learning", to: "/learn", icon: BookOpen, group: "Learning" },
    { label: "Practice", to: "/practice", icon: Code2, group: "Learning" },
    { label: "Quizzes", to: "/quizzes", icon: ClipboardList, group: "Learning" },
    { label: "Schedule", to: "/schedule", icon: CalendarDays, group: "Learning" },
    { label: "Test series", to: "/test-series", icon: BarChart3, group: "Assessments" },
  ] as const;

  async function closeAndSignOut() {
    setMobileOpen(false);
    await signOut();
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`${mobileOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-border bg-card lg:flex`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-border px-6">
          <span className="grid size-9 place-items-center rounded-lg bg-primary font-display text-lg text-primary-foreground">
            A
          </span>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">AVANTHI</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              CRT Portal
            </p>
          </div>
          <button
            className="ml-auto text-muted-foreground lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-5 px-3 py-6">
          {["Main", "Learning", "Assessments"].map((group) => (
            <div key={group}>
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group}
              </p>
              <div className="space-y-1">
                {navigation
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      activeProps={{
                        className:
                          "flex items-center gap-3 rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-primary",
                      }}
                    >
                      <item.icon className="size-[17px]" />
                      {item.label}
                    </Link>
                  ))}
              </div>
            </div>
          ))}
          <div>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Useful
            </p>
            <Link
              to="/playground"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings className="size-[17px]" />
              Playground
            </Link>
            <button className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              <Bell className="size-[17px]" />
              Notifications
            </button>
          </div>
        </nav>
        <div className="border-t border-border p-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {me?.primary ? ROLE_LABEL[me.primary] : "Account"}
                </span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="truncate text-sm">{me?.user.email}</div>
                {college && <div className="text-xs text-muted-foreground">College {college}</div>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void closeAndSignOut()}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="flex h-20 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="text-muted-foreground lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                Workspace
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                {college ? `College ${college}` : "Learning portal"}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground">System operational</span>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9">
          <div className="mb-7">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              Avanthi CRT Portal
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
          </div>
          <div>{children}</div>
        </main>
      </div>
    </div>
  );
}
