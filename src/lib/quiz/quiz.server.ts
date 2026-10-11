import type { SupabaseClient } from "@supabase/supabase-js";
import { loadIdentity } from "../identity";
import { rebrand } from "../learning/branding";
import { computeGate, lockReason, type GateItem } from "../learning/gating";
import type {
  HistoryEntry,
  QuizAnswers,
  QuizListItem,
  QuizResult,
  QuizState,
  QuizTopic,
} from "./quiz.contracts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type Learner = { userId: string; student: boolean; staff: boolean };

export class QuizError extends Error {
  constructor(
    message: string,
    readonly kind: "forbidden" | "not_found" | "busy" | "invalid" | "failed",
  ) {
    super(message);
    this.name = "QuizError";
  }
}

// Messages raised by the database functions are written for students, so they are passed through.
function fail(error: { code?: string; message: string } | null, what: string) {
  if (!error) return;
  if (error.code === "42501") throw new QuizError(error.message, "forbidden");
  if (error.code === "P0001") throw new QuizError(error.message, "busy");
  if (error.code === "P0002") throw new QuizError("This quiz isn't available.", "not_found");
  if (error.code === "22023") throw new QuizError(error.message, "invalid");
  console.error(`Quiz: ${what} failed`, error.code);
  throw new QuizError("That could not be completed. Refresh and try again.", "failed");
}

export async function resolveLearner(db: Db, userId: string): Promise<Learner> {
  const identity = await loadIdentity(db, userId);
  if (!identity?.active || identity.roles.length === 0) {
    throw new QuizError("An active account is required.", "forbidden");
  }
  return {
    userId,
    student: identity.roles.includes("student"),
    staff: identity.roles.includes("faculty") || identity.roles.includes("admin"),
  };
}

type TopicRow = { id: string; name: string; position: number; is_published: boolean };
type SetRow = {
  id: string;
  topic_id: string;
  name: string;
  position: number;
  expected_count: number;
  duration_minutes: number | null;
  is_published: boolean;
};
type AttemptRow = { mcq_set_id: string; score: number | null; submitted_at: string | null };

export async function listQuizzes(db: Db, learner: Learner): Promise<QuizTopic[]> {
  const [topics, sets, attempts] = await Promise.all([
    db.from("topics").select("id,name,position,is_published").order("position"),
    db
      .from("mcq_sets")
      .select("id,topic_id,name,position,expected_count,duration_minutes,is_published")
      .order("position")
      .order("id"),
    learner.student
      ? db
          .from("mcq_attempts")
          .select("mcq_set_id,score,submitted_at")
          .eq("student_id", learner.userId)
      : Promise.resolve({ data: [] as AttemptRow[], error: null }),
  ]);
  fail(topics.error, "topic read");
  fail(sets.error, "set read");
  fail(attempts.error, "attempt read");

  const visibleTopics = ((topics.data ?? []) as TopicRow[]).filter(
    (t) => learner.staff || t.is_published,
  );
  const topicIds = new Set(visibleTopics.map((t) => t.id));
  const visibleSets = ((sets.data ?? []) as SetRow[]).filter(
    (s) => topicIds.has(s.topic_id) && (learner.staff || s.is_published),
  );

  const stats = new Map<string, { attempts: number; completed: boolean; best: number | null }>();
  for (const row of (attempts.data ?? []) as AttemptRow[]) {
    if (!row.submitted_at) continue;
    const entry = stats.get(row.mcq_set_id) ?? { attempts: 0, completed: false, best: null };
    entry.attempts += 1;
    entry.completed = true;
    if (row.score !== null) entry.best = Math.max(entry.best ?? 0, Number(row.score));
    stats.set(row.mcq_set_id, entry);
  }

  const result: QuizTopic[] = [];
  for (const topic of visibleTopics.sort((a, b) => a.position - b.position)) {
    const own = visibleSets.filter((s) => s.topic_id === topic.id);
    if (own.length === 0) continue;
    const gate = computeGate(
      own.map<GateItem>((s) => ({
        id: s.id,
        stage: "quiz",
        title: rebrand(s.name),
        completed: stats.get(s.id)?.completed ?? false,
      })),
      { bypass: learner.staff },
    );
    const quizzes: QuizListItem[] = own.map((s) => ({
      id: s.id,
      name: rebrand(s.name),
      position: s.position,
      durationMinutes: s.duration_minutes,
      questionCount: s.expected_count,
      isPublished: s.is_published && topic.is_published,
      completed: stats.get(s.id)?.completed ?? false,
      attempts: stats.get(s.id)?.attempts ?? 0,
      bestScore: stats.get(s.id)?.best ?? null,
      locked: gate.states.get(s.id)?.locked ?? false,
      lockReason: lockReason(gate, s.id),
    }));
    result.push({ topicId: topic.id, topicName: rebrand(topic.name), quizzes });
  }
  return result;
}

function requireStudent(learner: Learner) {
  if (!learner.student) {
    throw new QuizError("Only students can take quizzes.", "forbidden");
  }
}

function branded(state: QuizState): QuizState {
  const name = (value: string) => rebrand(value);
  if (state.phase === "active") {
    return {
      ...state,
      set: { ...state.set, name: name(state.set.name) },
      questions: state.questions.map((q) => ({
        ...q,
        prompt: name(q.prompt),
        options: q.options.map((o) => ({ ...o, content: name(o.content) })),
      })),
    };
  }
  return { ...state, set: { ...state.set, name: name(state.set.name) } };
}

export async function quizState(db: Db, learner: Learner, setId: string): Promise<QuizState> {
  requireStudent(learner);
  const { data, error } = await db.rpc("mcq_quiz_state", { p_set: setId });
  fail(error, "state");
  return branded(data as QuizState);
}

export async function startQuiz(db: Db, learner: Learner, setId: string): Promise<QuizState> {
  requireStudent(learner);
  const { data, error } = await db.rpc("mcq_quiz_start", { p_set: setId });
  fail(error, "start");
  return branded(data as QuizState);
}

export async function saveAnswers(
  db: Db,
  learner: Learner,
  attemptId: string,
  answers: QuizAnswers,
): Promise<{ ok: boolean; expired?: boolean; submitted?: boolean; serverNow?: string }> {
  requireStudent(learner);
  const { data, error } = await db.rpc("mcq_quiz_save", {
    p_attempt: attemptId,
    p_answers: answers,
  });
  fail(error, "save");
  return data as { ok: boolean; expired?: boolean; submitted?: boolean; serverNow?: string };
}

export async function submitQuiz(
  db: Db,
  learner: Learner,
  attemptId: string,
  answers?: QuizAnswers,
): Promise<QuizResult> {
  requireStudent(learner);
  const { data, error } = await db.rpc("mcq_quiz_submit", {
    p_attempt: attemptId,
    p_answers: answers ?? null,
  });
  fail(error, "submit");
  return data as QuizResult;
}

export async function quizResult(db: Db, learner: Learner, attemptId: string): Promise<QuizResult> {
  requireStudent(learner);
  const { data, error } = await db.rpc("mcq_quiz_result", { p_attempt: attemptId });
  fail(error, "result");
  return data as QuizResult;
}

export async function setQuizPublished(
  db: Db,
  learner: Learner,
  setId: string,
  published: boolean,
) {
  if (!learner.staff)
    throw new QuizError("Only faculty or admin can publish quizzes.", "forbidden");
  const { error } = await db.rpc("set_mcq_set_published", { target_id: setId, published });
  fail(error, "publish");
  return { setId, published };
}

export async function setQuizDuration(
  db: Db,
  learner: Learner,
  setId: string,
  minutes: number | null,
) {
  if (!learner.staff)
    throw new QuizError("Only faculty or admin can set quiz duration.", "forbidden");
  const { error } = await db.rpc("set_mcq_set_duration", { target_id: setId, minutes });
  fail(error, "duration");
  return { setId, minutes };
}

export type { HistoryEntry };
