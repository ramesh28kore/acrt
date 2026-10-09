import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: roleGuard(["admin"]),
  head: () => ({ meta: [{ title: "Admin — Avanthi CRT Portal" }] }),
  component: () => (
    <AppShell title="Admin dashboard">
      <p className="text-muted-foreground">User management is coming next.</p>
    </AppShell>
  ),
});
