import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ComingSoonGrid } from "@/components/ComingSoon";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/faculty")({
  beforeLoad: roleGuard(["faculty"]),
  head: () => ({ meta: [{ title: "Faculty dashboard — Avanthi CRT Portal" }] }),
  component: () => (
    <AppShell title="Faculty dashboard">
      <ComingSoonGrid
        items={[
          { title: "My sections", text: "Sections and students assigned to you." },
          { title: "Student progress", text: "Track learning and test results." },
          { title: "Attendance", text: "Mark and review attendance." },
        ]}
      />
    </AppShell>
  ),
});
