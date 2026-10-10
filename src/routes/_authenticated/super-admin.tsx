import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminDashboard } from "@/components/super-admin/SuperAdminDashboard";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/super-admin")({
  beforeLoad: roleGuard(["super_admin"]),
  head: () => ({ meta: [{ title: "Super Admin — Avanthi CRT Portal" }] }),
  component: SuperAdminDashboard,
});
