import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: roleGuard(["admin"]),
  head: () => ({ meta: [{ title: "Admin — Avanthi CRT Portal" }] }),
  component: AdminDashboard,
});
