import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { codingProblems } from "@/lib/coding/coding.functions";
import { errorText } from "@/lib/learning/error-text";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/practice/")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Coding practice — Avanthi CRT Portal" }] }),
  component: PracticePage,
});

function PracticePage() {
  const topics = useQuery({ queryKey: ["coding", "problems"], queryFn: () => codingProblems() });

  return (
    <AppShell title="Coding practice">
      {topics.isPending && <p className="text-sm text-muted-foreground">Loading problems…</p>}
      {topics.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(topics.error)}
        </p>
      )}
      {topics.data && topics.data.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No coding problems are published yet. Check back soon.
        </p>
      )}
      <div className="space-y-8">
        {topics.data?.map((topic) => (
          <section key={topic.topicId}>
            <h2 className="font-display text-xl text-foreground">{topic.topicName}</h2>
            <ol className="mt-3 space-y-2">
              {topic.problems.map((problem) => (
                <li
                  key={problem.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  {problem.locked ? (
                    <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : problem.solved ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0">
                    {problem.locked ? (
                      <span className="font-medium text-muted-foreground">{problem.title}</span>
                    ) : (
                      <Link
                        to="/practice/$problemId"
                        params={{ problemId: problem.id }}
                        className="font-medium text-card-foreground hover:underline"
                      >
                        {problem.title}
                      </Link>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {problem.locked && problem.lockReason
                        ? problem.lockReason
                        : [
                            problem.setName,
                            problem.difficulty?.toLowerCase(),
                            problem.isPublished ? null : "draft",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
