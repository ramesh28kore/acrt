import type { SupabaseClient } from "@supabase/supabase-js";
import { loadIdentity } from "./identity";
import type {
  AttemptSummary,
  ReviewRow,
  RunningTotals,
  TestSeries,
  TestSeriesQuestion,
  TestSeriesResult,
} from "./test-series.contracts";

// The shared live backend has M07 tables but the generated ACRT types do not yet include them.
type Db = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type TestSeriesActor = { userId: string; student: boolean; staff: boolean; admin: boolean };

export class TestSeriesError extends Error {
  constructor(
    message: string,
    readonly kind: "forbidden" | "not_found" | "invalid" | "failed",
  ) {
    super(message);
    this.name = "TestSeriesError";
  }
}

function fail(error: { code?: string; message: string } | null, what: string): void {
  if (!error) return;
  if (error.code === "42501") throw new TestSeriesError(error.message, "forbidden");
  if (error.code === "P0001" || error.code === "P0002") {
    throw new TestSeriesError(error.message, error.code === "P0002" ? "not_found" : "invalid");
  }
  console.error(`Test series: ${what} failed`, error.code);
  throw new TestSeriesError("That examination request could not be completed.", "failed");
}

export async function resolveActor(db: Db, userId: string): Promise<TestSeriesActor> {
  const identity = await loadIdentity(db, userId);
  if (!identity?.active || identity.roles.length === 0) {
    throw new TestSeriesError("An active account is required.", "forbidden");
  }
  return {
    userId,
    student: identity.roles.includes("student"),
    staff: identity.roles.includes("faculty") || identity.roles.includes("admin"),
    admin: identity.roles.includes("admin"),
  };
}

function requireStudent(actor: TestSeriesActor) {
  if (!actor.student)
    throw new TestSeriesError("Only students can take examinations.", "forbidden");
}
function requireStaff(actor: TestSeriesActor) {
  if (!actor.staff) throw new TestSeriesError("Faculty or admin access is required.", "forbidden");
}

function mapTest(row: Record<string, unknown>): TestSeries {
  return {
    id: String(row["id"]),
    title: String(row["title"]),
    description: (row["description"] as string | null) ?? null,
    instructions: (row["instructions"] as string | null) ?? null,
    status: row["status"] === "ready" ? "ready" : "draft",
    isEnabled: row["is_enabled"] === true,
    testType: row["test_type"] === "coding" ? "coding" : "mcq",
    durationMinutes: row["duration_minutes"] == null ? null : Number(row["duration_minutes"]),
    cutoffMarks: row["cutoff_marks"] == null ? null : Number(row["cutoff_marks"]),
    maxViolations: Number(row["max_violations"] ?? 3),
  };
}

function mapAttempt(row: Record<string, unknown>): AttemptSummary {
  return {
    id: String(row["id"]),
    testId: String(row["test_id"]),
    studentId: String(row["student_id"]),
    totalQuestions: Number(row["total_questions"]),
    correctAnswers: Number(row["correct_answers"]),
    wrongAnswers: Number(row["wrong_answers"]),
    score: Number(row["score"]),
    totalMarks: Number(row["total_marks"]),
    status: row["status"] === "completed" ? "completed" : "in_progress",
    startedAt: String(row["started_at"]),
    deadlineAt: (row["deadline_at"] as string | null) ?? null,
    completedAt: (row["completed_at"] as string | null) ?? null,
    violations: Number(row["violations"] ?? 0),
    autoSubmitted: row["auto_submitted"] === true,
  };
}

export async function listTests(db: Db, actor: TestSeriesActor): Promise<TestSeries[]> {
  const query = db
    .from("test_series")
    .select(
      "id,title,description,instructions,status,is_enabled,test_type,duration_minutes,cutoff_marks,max_violations",
    )
    .order("created_at", { ascending: false });
  const { data, error } = await query;
  fail(error, "list");
  return ((data ?? []) as Record<string, unknown>[]).map(mapTest);
}

export async function loadTest(db: Db, actor: TestSeriesActor, testId: string) {
  if (!actor.student && !actor.staff) throw new TestSeriesError("Access denied.", "forbidden");
  const { data, error } = await db.from("test_series").select("*").eq("id", testId).maybeSingle();
  fail(error, "test read");
  if (!data) throw new TestSeriesError("This examination was not found.", "not_found");
  const test = mapTest(data as Record<string, unknown>);
  if (actor.student && !test.isEnabled)
    throw new TestSeriesError("This examination is not available.", "not_found");
  return test;
}

export async function start(
  db: Db,
  actor: TestSeriesActor,
  testId: string,
): Promise<AttemptSummary> {
  requireStudent(actor);
  const { data: id, error } = await db.rpc("test_series_start", { p_test_id: testId });
  fail(error, "start");
  const { data, error: readError } = await db
    .from("test_series_attempts")
    .select("*")
    .eq("id", id)
    .single();
  fail(readError, "attempt read");
  return mapAttempt(data as Record<string, unknown>);
}

export async function questions(
  db: Db,
  actor: TestSeriesActor,
  testId: string,
): Promise<TestSeriesQuestion[]> {
  const { data, error } = await db
    .from("test_series_questions")
    .select("id,question_number,question_text,options,marks")
    .eq("test_id", testId)
    .order("question_number");
  fail(error, "question read");
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    questionNumber: Number(row["question_number"]),
    questionText: String(row["question_text"]),
    options: Array.isArray(row["options"]) ? row["options"].map(String) : [],
    marks: Number(row["marks"]),
  }));
}

export async function submitAnswer(
  db: Db,
  actor: TestSeriesActor,
  attemptId: string,
  questionId: string,
  selected: string,
): Promise<RunningTotals> {
  requireStudent(actor);
  const { data, error } = await db.rpc("test_series_submit_answer", {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_selected: selected,
  });
  fail(error, "answer");
  return data as RunningTotals;
}

export async function finishIfExpired(
  db: Db,
  actor: TestSeriesActor,
  attemptId: string,
): Promise<RunningTotals> {
  requireStudent(actor);
  const { data, error } = await db.rpc("test_series_finish_if_expired", {
    p_attempt_id: attemptId,
  });
  fail(error, "expiry");
  return data as RunningTotals;
}

export async function recordViolation(
  db: Db,
  actor: TestSeriesActor,
  attemptId: string,
  reason: "hidden" | "blur",
) {
  requireStudent(actor);
  const { data, error } = await db.rpc("test_series_record_violation", {
    p_attempt_id: attemptId,
    p_reason: reason,
  });
  fail(error, "violation");
  return data as { violations: number; max_violations: number; status: string };
}

export async function result(
  db: Db,
  actor: TestSeriesActor,
  attemptId: string,
): Promise<TestSeriesResult> {
  requireStudent(actor);
  const { data: attempt, error: attemptError } = await db
    .from("test_series_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("student_id", actor.userId)
    .maybeSingle();
  fail(attemptError, "result attempt read");
  if (!attempt) throw new TestSeriesError("This examination attempt was not found.", "not_found");
  const mapped = mapAttempt(attempt as Record<string, unknown>);
  if (mapped.status !== "completed")
    throw new TestSeriesError("The result opens once the test is finished.", "forbidden");
  const [{ data: test, error: testError }, { data: review, error: reviewError }] =
    await Promise.all([
      db.from("test_series").select("cutoff_marks").eq("id", mapped.testId).single(),
      db.rpc("test_series_review", { p_attempt_id: attemptId }),
    ]);
  fail(testError, "result test read");
  fail(reviewError, "review");
  const cutoff = test?.cutoff_marks == null ? null : Number(test.cutoff_marks);
  return {
    attempt: mapped,
    cutoffMarks: cutoff,
    passed: cutoff == null ? null : mapped.score >= cutoff,
    review: (review ?? []) as ReviewRow[],
  };
}

export async function submitFeedback(
  db: Db,
  actor: TestSeriesActor,
  attemptId: string,
  rating: number,
  comment?: string | null,
) {
  requireStudent(actor);
  const { error } = await db.rpc("test_series_submit_feedback", {
    p_attempt_id: attemptId,
    p_rating: rating,
    p_comment: comment ?? null,
  });
  fail(error, "feedback");
  return { ok: true as const };
}

export async function setAnswer(
  db: Db,
  actor: TestSeriesActor,
  questionId: string,
  correctOption: string,
  explanation?: string | null,
) {
  requireStaff(actor);
  const { error } = await db.rpc("test_series_set_answer", {
    p_question_id: questionId,
    p_correct_option: correctOption,
    p_explanation: explanation ?? null,
  });
  fail(error, "answer key");
  return { ok: true as const };
}

export async function confirmAnswers(db: Db, actor: TestSeriesActor, testId: string) {
  requireStaff(actor);
  const { error } = await db.rpc("test_series_confirm_answers", { p_test_id: testId });
  fail(error, "answer confirmation");
  return { ok: true as const };
}
