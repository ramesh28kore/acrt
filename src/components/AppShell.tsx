import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LogOut, ChevronDown } from "lucide-react";
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
  const college = (me?.profile as { institutes?: { code: string } | null } | null)?.institutes?.code;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/dashboard" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-primary font-display text-lg text-primary-foreground">
              A
            </span>
            <span className="font-display text-lg tracking-tight text-foreground">Avanthi CRT</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent">
              <span className="max-w-40 truncate">{name}</span>
              {me?.primary && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                  {ROLE_LABEL[me.primary]}
                </span>
              )}
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="truncate text-sm">{me?.user.email}</div>
                {college && <div className="text-xs text-muted-foreground">College {college}</div>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-3xl tracking-tight text-foreground">{title}</h1>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
