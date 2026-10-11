import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { errorText } from "@/lib/learning/error-text";
import { PublishToggle } from "@/components/learning/PublishToggle";
import { learningTopic } from "@/lib/learning/learning.functions";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/learn/$topicId/")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Cheat sheets — Avanthi CRT Portal" }] }),
  component: TopicPage,
});

const STATUS_LABEL = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
} as const;

function TopicPage() {
  const { topicId } = Route.useParams();
  const topic = useQuery({
    queryKey: ["learning", "topic", topicId],
    queryFn: () => learningTopic({ data: { topicId } }),
    retry: false,
  });

  return (
    <AppShell title={topic.data?.topic.name ?? "Cheat sheets"}>
      <Link to="/learn" className="text-sm text-muted-foreground underline">
        All topics
      </Link>
      {topic.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {topic.isError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {errorText(topic.error)}
        </p>
      )}
      {topic.data && topic.data.sheets.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No cheat sheets are available in this topic yet.
        </p>
      )}
      {topic.data && topic.data.sheets.length > 0 && (
        <ol className="mt-4 space-y-3">
          {topic.data.sheets.map((sheet) => (
            <li
              key={sheet.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                {sheet.locked ? (
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                ) : sheet.status === "completed" ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0">
                  {sheet.locked ? (
                    <span className="font-medium text-muted-foreground">{sheet.title}</span>
                  ) : (
                    <Link
                      to="/learn/$topicId/$sheetId"
                      params={{ topicId, sheetId: sheet.id }}
                      className="font-medium text-card-foreground hover:underline"
                    >
                      {sheet.title}
                    </Link>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {sheet.locked && sheet.lockReason
                      ? sheet.lockReason
                      : topic.data.staff
                        ? `${sheet.isPublished ? "Published" : "Draft"}`
                        : STATUS_LABEL[sheet.status]}
                    {sheet.id === topic.data.nextSheetId && !topic.data.staff ? " · Up next" : ""}
                  </p>
                </div>
              </div>
              {topic.data.staff && (
                <PublishToggle
                  kind="sheet"
                  id={sheet.id}
                  published={sheet.isPublished}
                  label={sheet.title}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </AppShell>
  );
}
