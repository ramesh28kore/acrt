import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ScheduleView } from "@/components/learning/ScheduleView";
import { scheduleMine } from "@/lib/schedule/schedule.functions";
import { roleGuard } from "@/lib/role-guard";
import { todayDate } from "@/lib/schedule/plan";
export const Route = createFileRoute("/_authenticated/schedule")({
  beforeLoad: roleGuard(["student"]),
  head: () => ({ meta: [{ title: "My schedule — Avanthi CRT Portal" }] }),
  component: SchedulePage,
});
function SchedulePage() {
  const query = useQuery({
    queryKey: ["schedule", "mine"],
    queryFn: () => scheduleMine({ data: {} }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  return (
    <AppShell title="My schedule">
      {query.isPending && <p role="status">Building your schedule…</p>}
      {query.isError && (
        <p role="alert" className="rounded border p-5">
          {query.error.message}
          <button className="ml-3 underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {query.data && (
        <>
          <ScheduleView plan={query.data} today={todayDate()} />
          {query.data.warnings.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Some curriculum items are unavailable and have been omitted. Your completed activity
              remains saved.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
