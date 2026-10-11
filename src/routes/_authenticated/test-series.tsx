import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { testSeriesList } from "@/lib/test-series.functions";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/test-series")({
  beforeLoad: roleGuard(["student"]),
  head: () => ({ meta: [{ title: "Test series — Avanthi CRT Portal" }] }),
  component: TestSeriesPage,
});

function TestSeriesPage() {
  const query = useQuery({
    queryKey: ["test-series"],
    queryFn: () => testSeriesList(),
    retry: false,
  });
  return (
    <AppShell title="Test series">
      <p className="mb-5 text-sm text-muted-foreground">
        Published examinations are timed by the server. Your answers and results stay private to
        your account.
      </p>
      {query.isPending && <p className="text-sm text-muted-foreground">Loading examinations...</p>}
      {query.isError && (
        <p role="alert" className="rounded-lg border border-border bg-card p-5 text-sm">
          Could not load examinations.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {(query.data ?? []).map((test) => (
          <Link
            key={test.id}
            to="/test-series/$testId"
            params={{ testId: test.id }}
            className="rounded-lg border border-border bg-card p-5 hover:bg-accent"
          >
            <h2 className="font-display text-lg text-card-foreground">{test.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {test.description || "Examination"}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              {test.durationMinutes ? `${test.durationMinutes} minutes` : "No time limit"} ·{" "}
              {test.testType.toUpperCase()}
            </p>
          </Link>
        ))}
      </div>
      {!query.isPending && !query.isError && query.data?.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No examinations are available.
        </p>
      )}
    </AppShell>
  );
}
