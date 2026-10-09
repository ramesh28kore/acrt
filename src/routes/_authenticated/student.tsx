import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ComingSoonGrid } from "@/components/ComingSoon";
import { meQuery } from "@/lib/me";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/student")({
  beforeLoad: roleGuard(["student"]),
  head: () => ({ meta: [{ title: "Student dashboard — Avanthi CRT Portal" }] }),
  component: StudentPage,
});

function StudentPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const p = me?.profile;
  return (
    <AppShell title={`Welcome, ${p?.full_name || "student"}`}>
      <div className="mb-8 rounded-lg border border-border bg-card p-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Email" value={me?.user.email} />
          <Field label="Roll number" value={p?.roll_number} />
          <Field label="College" value={(p as { institutes?: { code: string } | null })?.institutes?.code} />
        </div>
      </div>
      <ComingSoonGrid
        items={[
          { title: "My courses", text: "Python lessons and cheat sheets." },
          { title: "Practice & tests", text: "MCQ practice, timed exams and test series." },
          { title: "Coding", text: "Problems, submissions and the playground." },
        ]}
      />
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-card-foreground">{value || "—"}</div>
    </div>
  );
}
