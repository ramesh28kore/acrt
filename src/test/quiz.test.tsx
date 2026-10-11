import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuizReview, QuizRunner } from "@/components/quiz/QuizRunner";
import { parsePrompt } from "@/lib/quiz/prompt";
import {
  QuizError,
  listQuizzes,
  quizResult,
  quizState,
  resolveLearner,
  saveAnswers,
  setQuizDuration,
  setQuizPublished,
  startQuiz,
  submitQuiz,
  type Learner,
} from "@/lib/quiz/quiz.server";
import type { QuizAnswers, QuizQuestion, QuizResult } from "@/lib/quiz/quiz.contracts";
import { answersSchema, saveInputSchema } from "@/lib/quiz/quiz.contracts";
import { clockOffsetMs, formatRemaining, questionStatus, remainingMs } from "@/lib/quiz/timing";

describe("question prompts", () => {
  it("splits text, fenced code and images in order", () => {
    const segments = parsePrompt(
      "What prints?\n```python\nprint(1)\n```\nSee ![chart](https://cdn.example/a.png) above",
    );
    expect(segments).toEqual([
      { kind: "text", text: "What prints?" },
      { kind: "code", text: "print(1)", lang: "python" },
      { kind: "text", text: "See" },
      { kind: "image", url: "https://cdn.example/a.png", alt: "chart" },
      { kind: "text", text: "above" },
    ]);
  });

  it("keeps an unterminated fence as readable text and refuses unsafe image addresses", () => {
    expect(parsePrompt("a ``` stray\nmore")[0]).toMatchObject({ kind: "text" });
    const unsafe = parsePrompt("![x](javascript:alert(1))");
    expect(unsafe.every((s) => s.kind === "text")).toBe(true);
    expect(parsePrompt("![x](http://insecure.example/a.png)").some((s) => s.kind === "image")).toBe(
      false,
    );
  });
});

describe("timing and palette", () => {
  it("anchors the countdown to the server deadline, not the browser clock", () => {
    const serverNow = "2026-10-10T10:00:00.000Z";
    const deadline = "2026-10-10T10:30:00.000Z";
    // A browser running two hours fast sees the same 30 minutes left.
    const fastClient = new Date("2026-10-10T12:00:00.000Z").getTime();
    const offset = clockOffsetMs(serverNow, fastClient);
    expect(remainingMs(deadline, offset, fastClient)).toBe(30 * 60_000);
    // Ten minutes later by the browser's own ticking, twenty minutes remain.
    expect(remainingMs(deadline, offset, fastClient + 10 * 60_000)).toBe(20 * 60_000);
    expect(remainingMs(deadline, offset, fastClient + 40 * 60_000)).toBe(0);
    expect(remainingMs(null, offset, fastClient)).toBeNull();
  });

  it("formats the remaining time", () => {
    expect(formatRemaining(61_000)).toBe("01:01");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
    expect(formatRemaining(0)).toBe("00:00");
  });

  it("classifies questions as answered, unanswered or marked", () => {
    const answers = { options: { a: ["x"], b: [] }, text: { c: "  " }, marked: ["d", "a"] };
    expect(questionStatus("a", answers)).toBe("marked");
    expect(questionStatus("b", answers)).toBe("unanswered");
    expect(questionStatus("c", answers)).toBe("unanswered");
    expect(questionStatus("e", { ...answers, text: { e: "42" } })).toBe("answered");
  });
});

describe("answer validation", () => {
  it("fills defaults and rejects oversized or malformed input", () => {
    expect(answersSchema.parse({})).toEqual({ options: {}, text: {}, marked: [] });
    expect(answersSchema.safeParse({ options: { q: "not-an-array" } }).success).toBe(false);
    expect(answersSchema.safeParse({ text: { q: "x".repeat(2001) } }).success).toBe(false);
    expect(saveInputSchema.safeParse({ attemptId: "nope", answers: {} }).success).toBe(false);
  });
});

type Row = Record<string, unknown>;

// A stand-in for the database: it answers the quiz functions with what the real ones return, and records the
// calls so the tests can check what the service sends. It also leaks answer keys in table reads, to prove the
// service never asks for them.
function fakeDb(
  tables: Record<string, Row[]>,
  rpc: Record<
    string,
    (args: Row) => { data?: unknown; error?: { code?: string; message: string } }
  >,
) {
  const calls: { name: string; args: Row }[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const api: Record<string, unknown> = {};
    Object.assign(api, {
      select: () => api,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((r) => r[key] === value);
        return api;
      },
      order: () => api,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    });
    return api;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      const handler = rpc[name];
      const out = handler
        ? handler(args)
        : { error: { code: "42883", message: "no such function" } };
      return { data: out.data ?? null, error: out.error ?? null };
    },
  };
  return { client: client as never, calls };
}

const STUDENT = "00000000-0000-0000-0000-0000000000a1";
const T1 = "00000000-0000-0000-0000-0000000000d1";
const S1 = "00000000-0000-0000-0000-0000000000e1";
const S2 = "00000000-0000-0000-0000-0000000000e2";
const S3 = "00000000-0000-0000-0000-0000000000e3";
const ATTEMPT = "00000000-0000-0000-0000-0000000000f1";

const student: Learner = { userId: STUDENT, student: true, staff: false };
const faculty: Learner = { userId: "f", student: false, staff: true };

describe("quiz list and ladder", () => {
  const tables = () => ({
    topics: [
      { id: T1, name: "Python CCBP Basics", position: 1, is_published: true },
      { id: "t2", name: "Draft topic", position: 2, is_published: false },
    ],
    mcq_sets: [
      {
        id: S1,
        topic_id: T1,
        name: "Quiz 1",
        position: 1,
        expected_count: 3,
        duration_minutes: null,
        is_published: true,
      },
      {
        id: S2,
        topic_id: T1,
        name: "Quiz 2",
        position: 2,
        expected_count: 2,
        duration_minutes: 30,
        is_published: true,
      },
      {
        id: S3,
        topic_id: T1,
        name: "Draft quiz",
        position: 3,
        expected_count: 1,
        duration_minutes: null,
        is_published: false,
      },
      {
        id: "s4",
        topic_id: "t2",
        name: "In draft topic",
        position: 1,
        expected_count: 1,
        duration_minutes: null,
        is_published: true,
      },
    ],
    mcq_attempts: [] as Row[],
  });

  it("shows students published quizzes only, in order, with the next one locked and branding applied", async () => {
    const { client } = fakeDb(tables(), {});
    const topics = await listQuizzes(client, student);
    expect(topics.map((t) => t.topicName)).toEqual(["Python KORE Basics"]);
    expect(topics[0]?.quizzes.map((q) => [q.name, q.locked, q.durationMinutes])).toEqual([
      ["Quiz 1", false, null],
      ["Quiz 2", true, 30],
    ]);
    expect(topics[0]?.quizzes[1]?.lockReason).toMatch(/Finish the quiz “Quiz 1” first/);
  });

  it("unlocks the next quiz after a submitted attempt and reports attempts and best score", async () => {
    const t = tables();
    t.mcq_attempts.push(
      { student_id: STUDENT, mcq_set_id: S1, score: 0.5, submitted_at: "2026-01-01" },
      { student_id: STUDENT, mcq_set_id: S1, score: 0.9, submitted_at: "2026-01-02" },
      { student_id: STUDENT, mcq_set_id: S2, score: null, submitted_at: null },
      { student_id: "someone-else", mcq_set_id: S2, score: 1, submitted_at: "2026-01-03" },
    );
    const { client } = fakeDb(t, {});
    const quizzes = (await listQuizzes(client, student))[0]?.quizzes ?? [];
    expect(quizzes[0]).toMatchObject({ completed: true, attempts: 2, bestScore: 0.9 });
    expect(quizzes[1]).toMatchObject({ locked: false, completed: false, attempts: 0 });
  });

  it("lets staff see drafts without being gated, and never reads questions or answer keys", async () => {
    const { client } = fakeDb(tables(), {});
    const topics = await listQuizzes(client, faculty);
    expect(topics.flatMap((t) => t.quizzes).every((q) => !q.locked)).toBe(true);
    expect(topics.flatMap((t) => t.quizzes).map((q) => q.name)).toContain("Draft quiz");
  });
});

describe("quiz operations go through the protected database functions", () => {
  const active = {
    phase: "active",
    attemptId: ATTEMPT,
    deadlineAt: null,
    questions: [
      { id: "q1", prompt: "NxtWave question", options: [{ id: "o", label: "A", content: "CCBP" }] },
    ],
    set: { id: S1, name: "NxtWave quiz" },
    answers: { options: {}, text: {}, marked: [] },
    serverNow: "x",
    startedAt: "x",
    durationMinutes: null,
  };

  it("starts and resumes through the database and applies branding to question text", async () => {
    const { client, calls } = fakeDb(
      {},
      { mcq_quiz_start: () => ({ data: active }), mcq_quiz_state: () => ({ data: active }) },
    );
    const started = await startQuiz(client, student, S1);
    expect(calls[0]).toEqual({ name: "mcq_quiz_start", args: { p_set: S1 } });
    expect(started.phase === "active" && started.questions[0]?.prompt).toBe("Ramesh question");
    expect(started.phase === "active" && started.set.name).toBe("Ramesh quiz");
    const state = await quizState(client, student, S1);
    expect(state.phase).toBe("active");
  });

  it("sends only the attempt id and answers; the score is never supplied by the caller", async () => {
    const { client, calls } = fakeDb(
      {},
      {
        mcq_quiz_save: () => ({ data: { ok: true } }),
        mcq_quiz_submit: () => ({ data: { scored: 1, gradeable: 1, total: 1, score: 1 } }),
      },
    );
    const answers: QuizAnswers = { options: { q1: ["o"] }, text: {}, marked: [] };
    await saveAnswers(client, student, ATTEMPT, answers);
    await submitQuiz(client, student, ATTEMPT, answers);
    await submitQuiz(client, student, ATTEMPT);
    expect(calls.map((c) => Object.keys(c.args).sort())).toEqual([
      ["p_answers", "p_attempt"],
      ["p_answers", "p_attempt"],
      ["p_answers", "p_attempt"],
    ]);
    expect(calls[2]?.args["p_answers"]).toBeNull();
    expect(JSON.stringify(calls)).not.toContain("score");
  });

  it("maps database refusals to clear errors without exposing internals", async () => {
    const { client } = fakeDb(
      {},
      {
        mcq_quiz_start: () => ({
          error: { code: "42501", message: "Finish the earlier quizzes in this topic first." },
        }),
        mcq_quiz_save: () => ({
          error: {
            code: "P0001",
            message: "Too many attempts started. Wait a moment and try again.",
          },
        }),
        mcq_quiz_submit: () => ({
          error: {
            code: "XX000",
            message: "internal: relation mcq_answer_keys has no index on /var/db",
          },
        }),
        mcq_quiz_result: () => ({
          error: { code: "42501", message: "Results are available after you submit." },
        }),
      },
    );
    await expect(startQuiz(client, student, S2)).rejects.toMatchObject({
      kind: "forbidden",
      message: "Finish the earlier quizzes in this topic first.",
    });
    await expect(
      saveAnswers(client, student, ATTEMPT, { options: {}, text: {}, marked: [] }),
    ).rejects.toMatchObject({ kind: "busy" });
    const failure = await submitQuiz(client, student, ATTEMPT).catch((e) => e);
    expect(failure).toBeInstanceOf(QuizError);
    expect(failure.message).not.toContain("/var/db");
    await expect(quizResult(client, student, ATTEMPT)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("refuses staff attempting to take quizzes before any database call", async () => {
    const { client, calls } = fakeDb({}, {});
    await expect(startQuiz(client, faculty, S1)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(submitQuiz(client, faculty, ATTEMPT)).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("limits publishing and duration to staff and validates through the database", async () => {
    const { client, calls } = fakeDb(
      {},
      { set_mcq_set_published: () => ({}), set_mcq_set_duration: () => ({}) },
    );
    await expect(setQuizPublished(client, student, S1, true)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(setQuizDuration(client, student, S1, 30)).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect(calls).toHaveLength(0);
    await setQuizPublished(client, faculty, S1, true);
    await setQuizDuration(client, faculty, S1, null);
    expect(calls).toEqual([
      { name: "set_mcq_set_published", args: { target_id: S1, published: true } },
      { name: "set_mcq_set_duration", args: { target_id: S1, minutes: null } },
    ]);
  });

  it("only treats active accounts as learners", async () => {
    const profile = (extra: Row) => ({
      id: STUDENT,
      role: "student",
      is_super_admin: false,
      is_disabled: false,
      institute_id: null,
      ...extra,
    });
    await expect(
      resolveLearner(fakeDb({ profiles: [profile({})] }, {}).client, STUDENT),
    ).resolves.toEqual({ userId: STUDENT, student: true, staff: false });
    await expect(
      resolveLearner(fakeDb({ profiles: [profile({ is_disabled: true })] }, {}).client, STUDENT),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

const questions: QuizQuestion[] = [
  {
    id: "q1",
    position: 1,
    questionType: "MULTIPLE_CHOICE",
    prompt: "Pick one",
    code: null,
    codeLang: null,
    multiple: false,
    textual: false,
    options: [
      { id: "a", label: "A", content: "first" },
      { id: "b", label: "B", content: "second" },
    ],
  },
  {
    id: "q2",
    position: 2,
    questionType: "MORE_THAN_ONE_MULTIPLE_CHOICE",
    prompt: "Pick several",
    code: null,
    codeLang: null,
    multiple: true,
    textual: false,
    options: [
      { id: "c", label: "A", content: "x" },
      { id: "d", label: "B", content: "y" },
    ],
  },
  {
    id: "q3",
    position: 3,
    questionType: "CODE_ANALYSIS_TEXTUAL",
    prompt: "Type it",
    code: "print(1)",
    codeLang: "python",
    multiple: false,
    textual: true,
    options: [],
  },
];
const empty: QuizAnswers = { options: {}, text: {}, marked: [] };

describe("quiz runner", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  function setup(overrides: Partial<Parameters<typeof QuizRunner>[0]> = {}) {
    const onSave = overrides.onSave ?? vi.fn().mockResolvedValue({ ok: true });
    const onSubmit = overrides.onSubmit ?? vi.fn();
    render(
      <QuizRunner
        attemptId="a1"
        questions={questions}
        initialAnswers={empty}
        deadlineAt={null}
        serverNow={new Date().toISOString()}
        submitting={false}
        {...overrides}
        onSave={onSave}
        onSubmit={onSubmit}
      />,
    );
    return {
      onSave: onSave as ReturnType<typeof vi.fn>,
      onSubmit: onSubmit as ReturnType<typeof vi.fn>,
    };
  }

  it("restores saved answers after a refresh and shows no answer key", () => {
    setup({ initialAnswers: { options: { q1: ["b"] }, text: {}, marked: ["q2"] } });
    expect(screen.getByLabelText(/B\./)).toBeChecked();
    expect(screen.getByRole("button", { name: "Question 1, answered" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 2, marked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 3, unanswered" })).toBeInTheDocument();
    expect(screen.getByText(/1 answered · 1 unanswered · 1 marked/)).toBeInTheDocument();
  });

  it("autosaves selected answers through the server operation after a short pause", async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText(/A\./));
    await vi.advanceTimersByTimeAsync(800);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ options: { q1: ["a"] }, text: {}, marked: [] }),
    );
    expect(screen.getByText("Answers saved")).toBeInTheDocument();
  });

  it("keeps a single choice for single-select and many for multi-select, and navigates the palette", async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText(/A\./));
    fireEvent.click(screen.getByLabelText(/B\./));
    expect(screen.getByLabelText(/A\./)).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Question 2, unanswered" }));
    fireEvent.click(screen.getByLabelText(/A\./));
    fireEvent.click(screen.getByLabelText(/B\./));
    expect(screen.getByLabelText(/A\./)).toBeChecked();
    expect(screen.getByLabelText(/B\./)).toBeChecked();
    await vi.advanceTimersByTimeAsync(800);
    expect(onSave).toHaveBeenLastCalledWith({
      options: { q1: ["b"], q2: ["c", "d"] },
      text: {},
      marked: [],
    });
  });

  it("reports a failed save without losing the typed answers", async () => {
    const { onSave } = setup({ onSave: vi.fn().mockRejectedValue(new Error("offline")) });
    fireEvent.click(screen.getByRole("button", { name: "Question 3, unanswered" }));
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "42" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(onSave).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Could not save/)).toBeInTheDocument());
    expect(screen.getByLabelText("Your answer")).toHaveValue("42");
  });

  it("submits once after confirming unanswered questions", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("3 question(s) are unanswered"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("does not submit when the student declines the confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(onSubmit).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows the server-anchored countdown and auto-submits at expiry, ignoring a wrong browser clock", async () => {
    const serverNow = new Date(Date.now() + 2 * 3600_000).toISOString(); // browser clock is 2 hours behind the server
    const deadline = new Date(Date.parse(serverNow) + 3000).toISOString();
    const { onSubmit } = setup({ serverNow, deadlineAt: deadline });
    expect(screen.getByRole("timer")).toHaveTextContent("00:03");
    await vi.advanceTimersByTimeAsync(4000);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
  });

  it("locks the question inputs once time has run out", async () => {
    const serverNow = new Date().toISOString();
    setup({ serverNow, deadlineAt: new Date(Date.now() + 1000).toISOString() });
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(screen.getByLabelText(/A\./)).toBeDisabled());
  });
});

describe("result review", () => {
  const result: QuizResult = {
    attemptId: "a1",
    mcqSetId: S1,
    scored: 1,
    gradeable: 2,
    total: 3,
    score: 0.5,
    late: true,
    autoSubmitted: false,
    questions,
    graded: [
      {
        mcqId: "q1",
        selectedOptionIds: ["a"],
        correctOptionIds: ["b"],
        submittedText: null,
        expectedText: null,
        isCorrect: false,
        explanation: "Because second.",
      },
      {
        mcqId: "q2",
        selectedOptionIds: ["c", "d"],
        correctOptionIds: ["c", "d"],
        submittedText: null,
        expectedText: null,
        isCorrect: true,
        explanation: null,
      },
      {
        mcqId: "q3",
        selectedOptionIds: [],
        correctOptionIds: null,
        submittedText: "1",
        expectedText: null,
        isCorrect: null,
        explanation: null,
      },
    ],
  };

  it("shows the score, the correct answers, explanations and notes on late and unkeyed questions", () => {
    render(<QuizReview result={result} />);
    expect(screen.getByRole("heading", { name: /1 of 2 correct \(50%\)/ })).toBeInTheDocument();
    expect(
      screen.getByText(/only the answers saved before the deadline were graded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 question\(s\) have no answer key yet/)).toBeInTheDocument();
    expect(screen.getByText("Because second.")).toBeInTheDocument();
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByText("Not graded")).toBeInTheDocument();
  });
});
