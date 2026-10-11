import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  testSeriesAnswer,
  testSeriesExpire,
  testSeriesFeedback,
  testSeriesLoad,
  testSeriesResult,
  testSeriesStart,
  testSeriesViolation,
} from "@/lib/test-series.functions";
import type {
  AttemptSummary,
  TestSeriesQuestion,
  TestSeriesResult,
} from "@/lib/test-series.contracts";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/test-series/$testId")({
  beforeLoad: roleGuard(["student"]),
  head: () => ({ meta: [{ title: "Examination — Avanthi CRT Portal" }] }),
  component: TestSeriesAttemptPage,
});

function TestSeriesAttemptPage() {
  const { testId } = Route.useParams();
  const client = useQueryClient();
  const load = useQuery({
    queryKey: ["test-series", testId],
    queryFn: () => testSeriesLoad({ data: { testId } }),
    retry: false,
  });
  const [attempt, setAttempt] = useState<AttemptSummary | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState<TestSeriesResult | null>(null);
  const start = useMutation({
    mutationFn: () => testSeriesStart({ data: { testId } }),
    onSuccess: setAttempt,
  });
  const answer = useMutation({
    mutationFn: (input: { attemptId: string; questionId: string; selected: string }) =>
      testSeriesAnswer({ data: input }),
    onSuccess: async (totals) => {
      if (totals.status === "completed" && attempt) {
        setResult(await testSeriesResult({ data: { attemptId: attempt.id } }));
        return;
      }
      setQuestionIndex((index) => index + 1);
    },
  });
  const expire = useMutation({
    mutationFn: () => testSeriesExpire({ data: { attemptId: attempt?.id ?? "" } }),
  });
  const questions = load.data?.questions ?? [];
  const current = questions[questionIndex];

  useEffect(() => {
    if (!attempt || result) return;
    const leave = (reason: "hidden" | "blur") => {
      void testSeriesViolation({ data: { attemptId: attempt.id, reason } }).then((state) => {
        if (state.status === "completed")
          void testSeriesResult({ data: { attemptId: attempt.id } }).then(setResult);
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", () => leave("blur"));
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [attempt, result]);

  useEffect(() => {
    if (!attempt || result || !attempt.deadlineAt) return;
    const timer = window.setInterval(() => {
      if (attempt.deadlineAt && Date.now() >= Date.parse(attempt.deadlineAt)) {
        void expire
          .mutateAsync()
          .then(() => testSeriesResult({ data: { attemptId: attempt.id } }))
          .then(setResult);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, result, expire]);

  return (
    <AppShell title={load.data?.test.title ?? "Examination"}>
      <Link to="/test-series" className="text-sm text-muted-foreground underline">
        All examinations
      </Link>
      {load.isPending && (
        <p className="mt-5 text-sm text-muted-foreground">Loading examination...</p>
      )}
      {load.isError && (
        <p role="alert" className="mt-5 rounded-lg border border-border bg-card p-5 text-sm">
          This examination is unavailable.
        </p>
      )}
      {load.data && !attempt && !result && (
        <section className="mt-5 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            {load.data.test.instructions ||
              "Answer each question in order. The server controls the deadline and grading."}
          </p>
          <button
            type="button"
            onClick={() => start.mutate()}
            disabled={start.isPending}
            className="mt-5 min-h-11 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {start.isPending ? "Starting..." : "Start examination"}
          </button>
          {start.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Could not start this examination.
            </p>
          )}
        </section>
      )}
      {attempt && !result && current && (
        <QuestionCard
          attempt={attempt}
          question={current}
          index={questionIndex}
          total={questions.length}
          busy={answer.isPending}
          onAnswer={(selected) =>
            answer.mutate({ attemptId: attempt.id, questionId: current.id, selected })
          }
        />
      )}
      {result && (
        <ResultCard
          result={result}
          onFeedback={(rating, comment) =>
            testSeriesFeedback({ data: { attemptId: result.attempt.id, rating, comment } })
          }
        />
      )}
    </AppShell>
  );
}

function QuestionCard({
  attempt,
  question,
  index,
  total,
  busy,
  onAnswer,
}: {
  attempt: AttemptSummary;
  question: TestSeriesQuestion;
  index: number;
  total: number;
  busy: boolean;
  onAnswer: (selected: string) => void;
}) {
  return (
    <section className="mt-5 rounded-lg border border-border bg-card p-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Question {index + 1} of {total} · {attempt.violations} warnings
      </p>
      <h2 className="mt-4 text-lg text-card-foreground">{question.questionText}</h2>
      <div className="mt-5 grid gap-3">
        {question.options.map((option, optionIndex) => (
          <button
            key={optionIndex}
            type="button"
            disabled={busy}
            onClick={() => onAnswer(String.fromCharCode(65 + optionIndex))}
            className="rounded-md border border-border px-4 py-3 text-left text-sm hover:bg-accent disabled:opacity-50"
          >
            {String.fromCharCode(65 + optionIndex)}. {option}
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultCard({
  result,
  onFeedback,
}: {
  result: TestSeriesResult;
  onFeedback: (rating: number, comment: string | null) => Promise<unknown>;
}) {
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);
  return (
    <section className="mt-5 space-y-5">
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Result</p>
        <p className="mt-2 text-3xl font-semibold">
          {result.attempt.score} / {result.attempt.totalMarks}
        </p>
        <p className="mt-2 text-sm">
          {result.passed === null ? "Completed" : result.passed ? "Passed" : "Not passed"}
          {result.attempt.autoSubmitted ? " · Auto-submitted" : ""}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-lg">Feedback</h2>
        {sent ? (
          <p className="mt-3 text-sm text-muted-foreground">Thanks for your feedback.</p>
        ) : (
          <div className="mt-3 flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRating(value);
                  void onFeedback(value, null).then(() => setSent(true));
                }}
                className="min-h-10 min-w-10 rounded-md border border-border hover:bg-accent"
              >
                {value}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
