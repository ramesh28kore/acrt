import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { QuizReview, QuizRunner } from "@/components/quiz/QuizRunner";
import { errorText } from "@/lib/learning/error-text";
import type { QuizAnswers } from "@/lib/quiz/quiz.contracts";
import { quizSave, quizStart, quizState, quizSubmit } from "@/lib/quiz/quiz.functions";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/quizzes/$setId")({
  beforeLoad: roleGuard(["student"]),
  head: () => ({ meta: [{ title: "Quiz — Avanthi CRT Portal" }] }),
  component: QuizPage,
});

function QuizPage() {
  const { setId } = Route.useParams();
  const queryClient = useQueryClient();
  const key = ["quiz", "state", setId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => quizState({ data: { setId } }),
    retry: false,
    // The server decides what is current: always refetch so a refresh or second tab cannot go stale.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const start = useMutation({
    mutationFn: () => quizStart({ data: { setId } }),
    onSuccess: (next) => {
      submit.reset();
      queryClient.setQueryData(key, next);
    },
  });
  const submit = useMutation({
    mutationFn: (input: { attemptId: string; answers?: QuizAnswers }) =>
      quizSubmit({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quiz"] });
    },
  });

  const data = state.data;
  const attemptId = data?.phase === "active" ? data.attemptId : null;

  const onSave = useCallback(
    (answers: QuizAnswers) => quizSave({ data: { attemptId: attemptId ?? "", answers } }),
    [attemptId],
  );
  const onSubmit = useCallback(
    (answers: QuizAnswers) => {
      if (attemptId) submit.mutate({ attemptId, answers });
    },
    [attemptId, submit],
  );

  return (
    <AppShell title={data?.set.name ?? "Quiz"}>
      <Link to="/quizzes" className="text-sm text-muted-foreground underline">
        All quizzes
      </Link>
      {state.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {state.isError && (
        <p role="alert" className="mt-4 rounded-lg border border-border bg-card p-5 text-sm">
          {errorText(state.error)}
        </p>
      )}
      {submit.isError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {errorText(submit.error)}
        </p>
      )}

      {submit.data && (
        <div className="mt-4">
          <QuizReview result={submit.data} />
        </div>
      )}

      {!submit.data && data?.phase === "intro" && (
        <section className="mt-4 rounded-lg border border-border bg-card p-5">
          <p className="text-sm">
            {data.set.timed
              ? `This is a timed quiz: you have ${data.set.durationMinutes} minutes once you start. The timer is kept by the server and cannot be paused.`
              : "This is a practice quiz. You can retake it as often as you like."}
          </p>
          {data.history.length > 0 && (
            <ul className="mt-3 text-sm text-muted-foreground">
              {data.history.map((h) => (
                <li key={h.attemptId}>
                  {new Date(h.submittedAt).toLocaleString()}: {h.scored ?? 0} of {h.gradeable ?? 0}{" "}
                  correct
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => start.mutate()}
            className="mt-4 min-h-11 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {start.isPending ? "Starting…" : data.history.length > 0 ? "Retake quiz" : "Start quiz"}
          </button>
          {start.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {errorText(start.error)}
            </p>
          )}
        </section>
      )}

      {!submit.data && data?.phase === "active" && (
        <div className="mt-4">
          <QuizRunner
            key={data.attemptId}
            attemptId={data.attemptId}
            questions={data.questions}
            initialAnswers={data.answers}
            deadlineAt={data.deadlineAt}
            serverNow={data.serverNow}
            onSave={onSave}
            onSubmit={onSubmit}
            submitting={submit.isPending}
          />
        </div>
      )}

      {!submit.data && data?.phase === "result" && (
        <div className="mt-4 space-y-4">
          <QuizReview result={data.result} />
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => start.mutate()}
            className="min-h-11 rounded-md border border-border px-5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {start.isPending ? "Starting…" : "Retake quiz"}
          </button>
          {start.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(start.error)}
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}
