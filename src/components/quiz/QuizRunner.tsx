import { useEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "@/components/learning/SheetContent";
import { parseInline } from "@/lib/learning/blocks";
import { parsePrompt } from "@/lib/quiz/prompt";
import type {
  GradedQuestion,
  QuizAnswers,
  QuizQuestion,
  QuizResult,
} from "@/lib/quiz/quiz.contracts";
import {
  clockOffsetMs,
  formatRemaining,
  questionStatus,
  remainingMs,
  type QuestionStatus,
} from "@/lib/quiz/timing";

const AUTOSAVE_MS = 700;

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        let node: React.ReactNode = segment.text;
        if (segment.code)
          node = (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{node}</code>
          );
        if (segment.em) node = <em>{node}</em>;
        if (segment.strong) node = <strong>{node}</strong>;
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

export function QuestionPrompt({
  question,
}: {
  question: Pick<QuizQuestion, "prompt" | "code" | "codeLang">;
}) {
  const segments = useMemo(() => parsePrompt(question.prompt), [question.prompt]);
  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        if (segment.kind === "code")
          return <CodeBlock key={index} code={segment.text} lang={segment.lang ?? undefined} />;
        if (segment.kind === "image")
          return (
            <img
              key={index}
              src={segment.url}
              alt={segment.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-auto max-w-full rounded-lg border border-border"
            />
          );
        return (
          <p key={index} className="leading-7 break-words whitespace-pre-wrap">
            <Inline text={segment.text} />
          </p>
        );
      })}
      {question.code && <CodeBlock code={question.code} lang={question.codeLang ?? undefined} />}
    </div>
  );
}

const STATUS_STYLE: Record<QuestionStatus, string> = {
  unanswered: "border-border bg-background",
  answered: "border-primary bg-primary/15",
  marked: "border-amber-500 bg-amber-500/20",
};

export function QuizRunner({
  attemptId,
  questions,
  initialAnswers,
  deadlineAt,
  serverNow,
  onSave,
  onSubmit,
  submitting,
}: {
  attemptId: string;
  questions: QuizQuestion[];
  initialAnswers: QuizAnswers;
  deadlineAt: string | null;
  serverNow: string;
  onSave: (answers: QuizAnswers) => Promise<{ ok: boolean; expired?: boolean }>;
  onSubmit: (answers: QuizAnswers) => void;
  submitting: boolean;
}) {
  const [answers, setAnswers] = useState<QuizAnswers>(initialAnswers);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(clockOffsetMs(serverNow, Date.now()));
  const dirty = useRef(false);
  const submitted = useRef(false);

  const remaining = remainingMs(deadlineAt, offset.current, now);
  const expired = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (deadlineAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  // Convenience only: the server enforces the deadline whether or not this fires.
  useEffect(() => {
    if (expired && !submitted.current) {
      submitted.current = true;
      onSubmit(answers);
    }
  }, [expired, answers, onSubmit]);

  useEffect(() => {
    if (!dirty.current || submitted.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      onSave(answers)
        .then((result) => setSaveState(result.ok ? "saved" : "failed"))
        .catch(() => setSaveState("failed"));
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [answers, onSave]);

  const question = questions[index];
  if (!question) return <p role="alert">This quiz has no questions.</p>;

  function update(next: QuizAnswers) {
    dirty.current = true;
    setAnswers(next);
  }

  function toggleOption(optionId: string) {
    const current = answers.options[question!.id] ?? [];
    const next = question!.multiple
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : [optionId];
    update({ ...answers, options: { ...answers.options, [question!.id]: next } });
  }

  function toggleMark() {
    const marked = answers.marked.includes(question!.id)
      ? answers.marked.filter((id) => id !== question!.id)
      : [...answers.marked, question!.id];
    update({ ...answers, marked });
  }

  const counts = questions.reduce(
    (acc, q) => {
      acc[questionStatus(q.id, answers)] += 1;
      return acc;
    },
    { unanswered: 0, answered: 0, marked: 0 } as Record<QuestionStatus, number>,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_15rem]" data-attempt={attemptId}>
      <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          {remaining !== null && (
            <span
              role="timer"
              aria-label="Time remaining"
              className={remaining < 60_000 ? "font-medium text-destructive" : ""}
            >
              {formatRemaining(remaining)}
            </span>
          )}
        </div>

        <QuestionPrompt question={question} />

        <fieldset className="mt-5 space-y-2" disabled={expired || submitting}>
          <legend className="sr-only">
            {question.textual
              ? "Your answer"
              : question.multiple
                ? "Choose all that apply"
                : "Choose one answer"}
          </legend>
          {question.textual ? (
            <input
              type="text"
              aria-label="Your answer"
              value={answers.text[question.id] ?? ""}
              maxLength={500}
              onChange={(event) =>
                update({ ...answers, text: { ...answers.text, [question.id]: event.target.value } })
              }
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
            />
          ) : (
            question.options.map((option) => {
              const checked = (answers.options[question.id] ?? []).includes(option.id);
              return (
                <label
                  key={option.id}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${checked ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <input
                    type={question.multiple ? "checkbox" : "radio"}
                    name={`q-${question.id}`}
                    checked={checked}
                    onChange={() => toggleOption(option.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0 break-words">
                    <span className="mr-2 font-medium">{option.label}.</span>
                    <Inline text={option.content} />
                  </span>
                </label>
              );
            })
          )}
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
            className="min-h-11 rounded-md border border-border px-4 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={index === questions.length - 1}
            onClick={() => setIndex(index + 1)}
            className="min-h-11 rounded-md border border-border px-4 text-sm disabled:opacity-50"
          >
            Next
          </button>
          <button
            type="button"
            aria-pressed={answers.marked.includes(question.id)}
            onClick={toggleMark}
            className="min-h-11 rounded-md border border-border px-4 text-sm"
          >
            {answers.marked.includes(question.id) ? "Unmark" : "Mark for review"}
          </button>
          <span role="status" className="text-xs text-muted-foreground">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Answers saved"}
            {saveState === "failed" &&
              "Could not save. Your answers are kept here; check your connection."}
          </span>
        </div>
      </section>

      <aside className="space-y-4">
        <nav aria-label="Question palette" className="rounded-lg border border-border bg-card p-3">
          <ol className="grid grid-cols-5 gap-2">
            {questions.map((q, i) => {
              const status = questionStatus(q.id, answers);
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    aria-label={`Question ${i + 1}, ${status}`}
                    aria-current={i === index ? "true" : undefined}
                    onClick={() => setIndex(i)}
                    className={`h-10 w-full rounded-md border text-sm ${STATUS_STYLE[status]} ${i === index ? "ring-2 ring-ring" : ""}`}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            {counts.answered} answered · {counts.unanswered} unanswered · {counts.marked} marked
          </p>
        </nav>
        <button
          type="button"
          disabled={submitting || expired}
          onClick={() => {
            if (
              counts.unanswered > 0 &&
              !window.confirm(`${counts.unanswered} question(s) are unanswered. Submit anyway?`)
            )
              return;
            submitted.current = true;
            onSubmit(answers);
          }}
          className="min-h-11 w-full rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit quiz"}
        </button>
      </aside>
    </div>
  );
}

export function QuizReview({ result }: { result: QuizResult }) {
  const questions = useMemo(
    () => new Map(result.questions.map((q) => [q.id, q])),
    [result.questions],
  );
  const percent = result.score === null ? null : Math.round(result.score * 100);
  return (
    <div className="space-y-6">
      <section aria-live="polite" className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-xl">
          {result.gradeable === 0 ? "Submitted" : `${result.scored} of ${result.gradeable} correct`}
          {percent !== null && ` (${percent}%)`}
        </h2>
        {result.late && (
          <p className="mt-1 text-sm text-muted-foreground">
            Time ran out, so only the answers saved before the deadline were graded.
          </p>
        )}
        {result.gradeable < result.total && (
          <p className="mt-1 text-sm text-muted-foreground">
            {result.total - result.gradeable} question(s) have no answer key yet and are not
            counted.
          </p>
        )}
      </section>
      <ol className="space-y-4">
        {result.graded.map((graded, i) => (
          <ReviewItem
            key={graded.mcqId}
            index={i}
            graded={graded}
            question={questions.get(graded.mcqId)}
          />
        ))}
      </ol>
    </div>
  );
}

function ReviewItem({
  index,
  graded,
  question,
}: {
  index: number;
  graded: GradedQuestion;
  question: QuizQuestion | undefined;
}) {
  const label = (id: string) => question?.options.find((o) => o.id === id)?.label ?? id;
  const verdict =
    graded.isCorrect === null ? "Not graded" : graded.isCorrect ? "Correct" : "Incorrect";
  return (
    <li className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Question {index + 1}</span>
        <span
          className={
            graded.isCorrect
              ? "text-primary"
              : graded.isCorrect === false
                ? "text-destructive"
                : "text-muted-foreground"
          }
        >
          {verdict}
        </span>
      </div>
      {question && (
        <div className="mt-2">
          <QuestionPrompt question={question} />
        </div>
      )}
      {graded.expectedText !== null ? (
        <p className="mt-2">
          Your answer: <strong>{graded.submittedText || "(blank)"}</strong>. Expected:{" "}
          <strong>{graded.expectedText}</strong>
        </p>
      ) : (
        <p className="mt-2">
          Your answer:{" "}
          <strong>{graded.selectedOptionIds.map(label).join(", ") || "(blank)"}</strong>
          {graded.correctOptionIds && (
            <>
              {" "}
              · Correct: <strong>{graded.correctOptionIds.map(label).join(", ")}</strong>
            </>
          )}
        </p>
      )}
      {graded.explanation && <p className="mt-2 text-muted-foreground">{graded.explanation}</p>}
    </li>
  );
}
