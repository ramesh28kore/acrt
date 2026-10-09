import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/super-admin")({
  beforeLoad: roleGuard(["super_admin"]),
  head: () => ({ meta: [{ title: "Super Admin — Avanthi CRT Portal" }] }),
  component: () => (
    <AppShell title="Super Admin dashboard">
      <p className="text-muted-foreground">User management across all colleges is coming next.</p>
    </AppShell>
  ),
});
