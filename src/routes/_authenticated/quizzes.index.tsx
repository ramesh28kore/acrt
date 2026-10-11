import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { errorText } from "@/lib/learning/error-text";
import { meQuery } from "@/lib/me";
import { quizDuration, quizList, quizPublish } from "@/lib/quiz/quiz.functions";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/quizzes/")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Quizzes — Avanthi CRT Portal" }] }),
  component: QuizzesPage,
});

function QuizzesPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const staff = Boolean(me?.roles.some((role) => role === "faculty" || role === "admin"));
  const quizzes = useQuery({ queryKey: ["quiz", "list"], queryFn: () => quizList() });

  return (
    <AppShell title="Quizzes">
      {quizzes.isPending && <p className="text-sm text-muted-foreground">Loading quizzes…</p>}
      {quizzes.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(quizzes.error)}
        </p>
      )}
      {quizzes.data && quizzes.data.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No quizzes are published yet. Check back soon.
        </p>
      )}
      <div className="space-y-8">
        {quizzes.data?.map((topic) => (
          <section key={topic.topicId}>
            <h2 className="font-display text-xl text-foreground">{topic.topicName}</h2>
            <ol className="mt-3 space-y-2">
              {topic.quizzes.map((quiz) => (
                <li
                  key={quiz.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {quiz.locked ? (
                      <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : quiz.completed ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <Circle
                        className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0">
                      {quiz.locked || staff ? (
                        <span className="font-medium text-card-foreground">{quiz.name}</span>
                      ) : (
                        <Link
                          to="/quizzes/$setId"
                          params={{ setId: quiz.id }}
                          className="font-medium text-card-foreground hover:underline"
                        >
                          {quiz.name}
                        </Link>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {quiz.locked && quiz.lockReason
                          ? quiz.lockReason
                          : [
                              quiz.durationMinutes
                                ? `Timed · ${quiz.durationMinutes} min`
                                : "Practice",
                              quiz.questionCount > 0 ? `${quiz.questionCount} questions` : null,
                              quiz.attempts > 0
                                ? `${quiz.attempts} attempt${quiz.attempts === 1 ? "" : "s"}`
                                : null,
                              quiz.bestScore !== null
                                ? `best ${Math.round(quiz.bestScore * 100)}%`
                                : null,
                              quiz.isPublished ? null : "draft",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </p>
                    </div>
                  </div>
                  {staff && (
                    <StaffControls
                      id={quiz.id}
                      name={quiz.name}
                      published={quiz.isPublished}
                      minutes={quiz.durationMinutes}
                    />
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function StaffControls({
  id,
  name,
  published,
  minutes,
}: {
  id: string;
  name: string;
  published: boolean;
  minutes: number | null;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(minutes === null ? "" : String(minutes));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["quiz"] });
  const publish = useMutation({
    mutationFn: () => quizPublish({ data: { setId: id, published: !published } }),
    onSuccess: refresh,
  });
  const duration = useMutation({
    mutationFn: () =>
      quizDuration({ data: { setId: id, minutes: value.trim() === "" ? null : Number(value) } }),
    onSuccess: refresh,
  });
  const error = publish.error ?? duration.error;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">
        <span className="mb-1 block">Minutes (blank = practice)</span>
        <input
          type="number"
          min={1}
          max={600}
          value={value}
          aria-label={`Duration in minutes for ${name}`}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-9 w-24 rounded-md border border-input bg-background px-2"
        />
      </label>
      <button
        type="button"
        disabled={duration.isPending}
        onClick={() => duration.mutate()}
        className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent"
      >
        Save duration
      </button>
      <button
        type="button"
        disabled={publish.isPending}
        onClick={() => publish.mutate()}
        aria-label={`${published ? "Unpublish" : "Publish"} ${name}`}
        className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent"
      >
        {published ? "Unpublish" : "Publish"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {errorText(error)}
        </span>
      )}
    </div>
  );
}
