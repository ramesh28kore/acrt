import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { errorText } from "@/lib/learning/error-text";
import { PublishToggle } from "@/components/learning/PublishToggle";
import { Progress } from "@/components/ui/progress";
import { learningTopics } from "@/lib/learning/learning.functions";
import { meQuery } from "@/lib/me";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/learn/")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Learning library — Avanthi CRT Portal" }] }),
  component: LearnPage,
});

function LearnPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const staff = Boolean(me?.roles.some((role) => role === "faculty" || role === "admin"));
  const topics = useQuery({ queryKey: ["learning", "topics"], queryFn: () => learningTopics() });

  return (
    <AppShell title="Learning library">
      {topics.isPending && <p className="text-sm text-muted-foreground">Loading topics…</p>}
      {topics.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(topics.error)}
        </p>
      )}
      {topics.data && topics.data.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No topics are published yet. Check back soon.
        </p>
      )}
      {topics.data && topics.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.data.map((topic) => (
            <li
              key={topic.id}
              className="flex flex-col rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/learn/$topicId"
                  params={{ topicId: topic.id }}
                  className="font-display text-lg text-card-foreground hover:underline"
                >
                  {topic.position}. {topic.name}
                </Link>
                {!topic.isPublished && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                    Draft
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {topic.sheetCount === 0
                  ? "No cheat sheets yet"
                  : `${topic.completed} of ${topic.sheetCount} cheat sheets complete`}
              </p>
              <Progress
                className="mt-3"
                value={topic.percent}
                aria-label={`${topic.name} progress`}
              />
              {staff && (
                <div className="mt-4">
                  <PublishToggle
                    kind="topic"
                    id={topic.id}
                    published={topic.isPublished}
                    label={topic.name}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
