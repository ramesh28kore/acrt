import type { SupabaseClient } from "@supabase/supabase-js";
import { loadIdentity } from "../identity";
import { parseBlocks } from "../learning/blocks";
import { rebrand, rebrandBlocks } from "../learning/branding";
import { computeGate, lockReason, type GateItem } from "../learning/gating";
import type {
  ProblemDetail,
  ProblemListItem,
  ProgramRow,
  SolutionResult,
  SubmissionSummary,
  TopicProblems,
  TutorialResult,
} from "./coding.contracts";
import { ExecutionError, type Executor, type RunOutcome } from "./execution";
import { gradeCases, type GradeCase, type GradeResult } from "./grading";
import { PRACTICE_LANGUAGE } from "./languages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type Limiter = <T>(userId: string, task: () => Promise<T>) => Promise<T>;
export type Deps = { executor: Executor; limit: Limiter; service: () => Db };

export type Coder = { userId: string; staff: boolean; admin: boolean };

export class CodingError extends Error {
  constructor(
    message: string,
    readonly kind:
      "forbidden" | "not_found" | "locked" | "busy" | "unavailable" | "invalid" | "failed",
  ) {
    super(message);
    this.name = "CodingError";
  }
}

const UNAVAILABLE = "This problem isn't available.";
const SUBMISSIONS_PER_MINUTE = { student: 10, staff: 60 } as const;

type TopicRow = { id: string; name: string; position: number; is_published: boolean };
type SetRow = {
  id: string;
  topic_id: string;
  name: string;
  position: number;
  is_published: boolean;
};
type ProblemRow = {
  id: string;
  set_id: string;
  topic_id: string;
  title: string;
  difficulty: string | null;
  position: number;
};

export async function resolveCoder(client: Db, userId: string): Promise<Coder> {
  const identity = await loadIdentity(client, userId);
  if (!identity?.active || identity.roles.length === 0) {
    throw new CodingError("An active account is required.", "forbidden");
  }
  return {
    userId,
    staff: identity.roles.includes("faculty") || identity.roles.includes("admin"),
    admin: identity.roles.includes("admin"),
  };
}

function fail(error: { code?: string; message: string } | null, what: string) {
  if (!error) return;
  if (error.code === "42501" || error.code === "P0001")
    throw new CodingError(error.message, "forbidden");
  console.error(`Coding: ${what} failed`, error.code);
  throw new CodingError("That could not be completed. Refresh and try again.", "failed");
}

function executionFailure(error: unknown): never {
  if (error instanceof ExecutionError) {
    throw new CodingError(
      error.message,
      error.kind === "busy" ? "busy" : error.kind === "rejected" ? "invalid" : "unavailable",
    );
  }
  throw error;
}

// A catalogue ordered the way a student works through it: set position, then problem position.
async function loadCatalogue(db: Db, coder: Coder) {
  const [topics, sets, problems] = await Promise.all([
    db.from("topics").select("id,name,position,is_published").order("position"),
    db.from("sets").select("id,topic_id,name,position,is_published").order("position"),
    db.from("problems").select("id,set_id,topic_id,title,difficulty,position").order("position"),
  ]);
  fail(topics.error, "topic read");
  fail(sets.error, "set read");
  fail(problems.error, "problem read");

  const visibleTopics = new Map(
    ((topics.data ?? []) as TopicRow[])
      .filter((t) => coder.staff || t.is_published)
      .map((t) => [t.id, t]),
  );
  const visibleSets = new Map(
    ((sets.data ?? []) as SetRow[])
      .filter((s) => visibleTopics.has(s.topic_id) && (coder.staff || s.is_published))
      .map((s) => [s.id, s]),
  );
  const visibleProblems = ((problems.data ?? []) as ProblemRow[]).filter(
    (p) => visibleSets.has(p.set_id) && visibleTopics.has(p.topic_id),
  );
  const rank = (p: ProblemRow) => [visibleSets.get(p.set_id)?.position ?? 0, p.position] as const;
  visibleProblems.sort((a, b) => {
    const [as, ap] = rank(a);
    const [bs, bp] = rank(b);
    return as - bs || ap - bp || a.id.localeCompare(b.id);
  });
  return { topics: visibleTopics, sets: visibleSets, problems: visibleProblems };
}

async function loadProgress(db: Db, coder: Coder) {
  const solved = new Set<string>();
  const attempted = new Set<string>();
  if (coder.staff) return { solved, attempted };
  const { data, error } = await db
    .from("submissions")
    .select("problem_id,status")
    .eq("student_id", coder.userId)
    .in("status", ["passed", "failed"]);
  fail(error, "progress read");
  for (const row of (data ?? []) as { problem_id: string; status: string }[]) {
    attempted.add(row.problem_id);
    if (row.status === "passed") solved.add(row.problem_id);
  }
  return { solved, attempted };
}

function topicGate(coder: Coder, problems: ProblemRow[], solved: Set<string>) {
  const items: GateItem[] = problems.map((p) => ({
    id: p.id,
    stage: "problem",
    title: rebrand(p.title),
    completed: solved.has(p.id),
  }));
  return computeGate(items, { bypass: coder.staff });
}

export async function listProblems(db: Db, coder: Coder): Promise<TopicProblems[]> {
  const catalogue = await loadCatalogue(db, coder);
  const { solved, attempted } = await loadProgress(db, coder);
  const result: TopicProblems[] = [];

  for (const topic of [...catalogue.topics.values()].sort((a, b) => a.position - b.position)) {
    const own = catalogue.problems.filter((p) => p.topic_id === topic.id);
    if (own.length === 0) continue;
    const gate = topicGate(coder, own, solved);
    const problems: ProblemListItem[] = own.map((p) => {
      const set = catalogue.sets.get(p.set_id);
      return {
        id: p.id,
        title: rebrand(p.title),
        difficulty: p.difficulty,
        setName: rebrand(set?.name ?? ""),
        solved: solved.has(p.id),
        attempted: attempted.has(p.id),
        locked: gate.states.get(p.id)?.locked ?? false,
        lockReason: lockReason(gate, p.id),
        isPublished: Boolean(set?.is_published && topic.is_published),
      };
    });
    result.push({ topicId: topic.id, topicName: rebrand(topic.name), problems });
  }
  return result;
}

// Every route that touches a problem passes through here: visibility, then the ladder gate.
async function accessProblem(db: Db, coder: Coder, problemId: string) {
  const catalogue = await loadCatalogue(db, coder);
  const problem = catalogue.problems.find((p) => p.id === problemId);
  if (!problem) throw new CodingError(UNAVAILABLE, "not_found");
  const { solved, attempted } = await loadProgress(db, coder);
  const topicProblems = catalogue.problems.filter((p) => p.topic_id === problem.topic_id);
  const gate = topicGate(coder, topicProblems, solved);
  if (gate.states.get(problemId)?.locked) {
    throw new CodingError(lockReason(gate, problemId) ?? "This problem is locked.", "locked");
  }
  const set = catalogue.sets.get(problem.set_id);
  const topic = catalogue.topics.get(problem.topic_id);
  return {
    problem,
    solved,
    attempted,
    isPublished: Boolean(set?.is_published && topic?.is_published),
  };
}

async function sampleCases(
  db: Db,
  problemId: string,
  fallback: { input: string; output: string }[],
) {
  const { data, error } = await db
    .from("test_cases")
    .select("input,expected_output,position")
    .eq("problem_id", problemId)
    .eq("is_sample", true)
    .order("position");
  fail(error, "sample read");
  const rows = (data ?? []) as { input: string; expected_output: string }[];
  return rows.length > 0
    ? rows.map((r) => ({ input: r.input, output: r.expected_output }))
    : fallback;
}

type SubmissionRow = {
  id: string;
  status: string;
  code: string;
  results: { verdict?: string; passedTotal?: number; total?: number } | null;
  created_at: string;
};

export async function getProblemDetail(
  db: Db,
  coder: Coder,
  backend: Deps["executor"]["backend"],
  problemId: string,
): Promise<ProblemDetail> {
  const access = await accessProblem(db, coder, problemId);
  const { data, error } = await db
    .from("problems")
    .select("content,samples")
    .eq("id", problemId)
    .maybeSingle();
  fail(error, "problem content read");
  const body = data as { content: unknown; samples: unknown } | null;
  if (!body) throw new CodingError(UNAVAILABLE, "not_found");

  const fallbackSamples = Array.isArray(body.samples)
    ? (body.samples as { input?: unknown; output?: unknown }[])
        .filter((s) => typeof s.input === "string" && typeof s.output === "string")
        .map((s) => ({ input: s.input as string, output: s.output as string }))
    : [];
  const samples = await sampleCases(db, problemId, fallbackSamples);

  let draft: string | null = null;
  let submissions: SubmissionSummary[] = [];
  if (!coder.staff) {
    const [draftResult, subResult] = await Promise.all([
      db
        .from("practice_drafts")
        .select("code")
        .eq("student_id", coder.userId)
        .eq("problem_id", problemId)
        .maybeSingle(),
      db
        .from("submissions")
        .select("id,status,code,results,created_at")
        .eq("student_id", coder.userId)
        .eq("problem_id", problemId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    fail(draftResult.error, "draft read");
    fail(subResult.error, "submission read");
    draft = (draftResult.data as { code: string } | null)?.code ?? null;
    submissions = ((subResult.data ?? []) as SubmissionRow[]).map((s) => ({
      id: s.id,
      status: s.status,
      verdict: s.results?.verdict ?? null,
      passedTotal: s.results?.passedTotal ?? null,
      total: s.results?.total ?? null,
      createdAt: s.created_at,
      code: s.code,
    }));
  }

  return {
    problem: {
      id: access.problem.id,
      title: rebrand(access.problem.title),
      difficulty: access.problem.difficulty,
      blocks: rebrandBlocks(parseBlocks(body.content).blocks),
      samples,
      isPublished: access.isPublished,
    },
    draft,
    submissions,
    attempts: submissions.length,
    solved: access.solved.has(problemId),
    staff: coder.staff,
    backend,
  };
}

// "Run" grades only the permitted sample cases and stores nothing.
export async function runSamples(
  deps: Deps,
  db: Db,
  coder: Coder,
  problemId: string,
  source: string,
): Promise<GradeResult> {
  await accessProblem(db, coder, problemId);
  const { data } = await db.from("problems").select("samples").eq("id", problemId).maybeSingle();
  const raw = (data as { samples: unknown } | null)?.samples;
  const fallback = Array.isArray(raw)
    ? (raw as { input?: unknown; output?: unknown }[])
        .filter((s) => typeof s.input === "string" && typeof s.output === "string")
        .map((s) => ({ input: s.input as string, output: s.output as string }))
    : [];
  const samples = await sampleCases(db, problemId, fallback);
  if (samples.length === 0)
    throw new CodingError("This problem has no sample cases to run.", "invalid");

  const cases: GradeCase[] = samples.map((s) => ({
    input: s.input,
    expected: s.output,
    isSample: true,
  }));
  try {
    return await deps.limit(coder.userId, () =>
      gradeCases((stdin) => deps.executor.run(PRACTICE_LANGUAGE, source, stdin), cases),
    );
  } catch (error) {
    return executionFailure(error);
  }
}

// "Submit" grades every case, hidden ones included, using a server-only read of the cases.
// Only counts for hidden cases are returned; judge outages record nothing.
export async function submit(
  deps: Deps,
  db: Db,
  coder: Coder,
  problemId: string,
  source: string,
): Promise<GradeResult & { submissionId: string }> {
  await accessProblem(db, coder, problemId);

  const limit = coder.staff ? SUBMISSIONS_PER_MINUTE.staff : SUBMISSIONS_PER_MINUTE.student;
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", coder.userId)
    .gte("created_at", since);
  fail(recent.error, "rate check");
  if ((recent.count ?? 0) >= limit) {
    throw new CodingError("Too many submissions. Wait a moment and try again.", "busy");
  }

  const service = deps.service();
  const { data, error } = await service.rpc("grading_cases", { p_problem: problemId });
  fail(error, "case read");
  const rows = (data ?? []) as { input: string; expected_output: string; is_sample: boolean }[];
  if (rows.length === 0) {
    throw new CodingError("This problem has no test cases to check against yet.", "invalid");
  }
  const cases: GradeCase[] = rows.map((r) => ({
    input: r.input,
    expected: r.expected_output,
    isSample: r.is_sample,
  }));

  let result: GradeResult;
  try {
    result = await deps.limit(coder.userId, () =>
      gradeCases((stdin) => deps.executor.run(PRACTICE_LANGUAGE, source, stdin), cases),
    );
  } catch (err) {
    return executionFailure(err);
  }

  const recorded = await service.rpc("record_graded_submission", {
    p_student: coder.userId,
    p_problem: problemId,
    p_code: source,
    p_language: PRACTICE_LANGUAGE,
    p_status: result.allPassed ? "passed" : "failed",
    p_results: result,
  });
  fail(recorded.error, "submission record");
  return { ...result, submissionId: recorded.data as string };
}

export async function getSolution(
  db: Db,
  coder: Coder,
  problemId: string,
): Promise<SolutionResult> {
  await accessProblem(db, coder, problemId);
  if (coder.staff) {
    const { data, error } = await db
      .from("problem_solutions")
      .select("*")
      .eq("problem_id", problemId)
      .maybeSingle();
    fail(error, "solution read");
    const row = data as Record<string, string | null> | null;
    if (!row?.["solution"]) return { ok: false, reason: "not_available" };
    return {
      ok: true,
      solution: {
        solution: row["solution"],
        language: row["language"] ?? "python",
        approach: row["approach"] ?? null,
        algorithm: row["algorithm"] ?? null,
        explanation: row["explanation"] ?? null,
        timeComplexity: row["time_complexity"] ?? null,
        spaceComplexity: row["space_complexity"] ?? null,
      },
    };
  }
  const { data, error } = await db.rpc("student_solution", { p_problem: problemId });
  fail(error, "solution read");
  return data as SolutionResult;
}

export async function getTutorial(
  db: Db,
  coder: Coder,
  problemId: string,
): Promise<TutorialResult> {
  await accessProblem(db, coder, problemId);
  if (coder.staff) return { ok: false, reason: "not_available" };
  const { data, error } = await db.rpc("student_tutorial", { p_problem: problemId });
  fail(error, "tutorial read");
  return data as TutorialResult;
}

export async function saveDraft(db: Db, coder: Coder, problemId: string, source: string) {
  if (coder.staff) return { saved: false };
  await accessProblem(db, coder, problemId);
  const { error } = await db.from("practice_drafts").upsert(
    {
      student_id: coder.userId,
      problem_id: problemId,
      language: PRACTICE_LANGUAGE,
      code: source,
    },
    { onConflict: "student_id,problem_id" },
  );
  fail(error, "draft save");
  return { saved: true };
}

// Runs the stored reference solution against every case and records the verdict that
// later allows the solution to be revealed. Staff only.
export async function validateReference(deps: Deps, db: Db, coder: Coder, problemId: string) {
  if (!coder.staff)
    throw new CodingError("Only faculty or admin can validate solutions.", "forbidden");
  const { data, error } = await db
    .from("problem_solutions")
    .select("solution,language")
    .eq("problem_id", problemId)
    .maybeSingle();
  fail(error, "solution read");
  const row = data as { solution: string | null; language: string } | null;
  const service = deps.service();

  const record = async (status: string, passed: number, total: number, detail: string | null) => {
    const { error: writeError } = await service.from("problem_validations").upsert(
      {
        problem_id: problemId,
        status,
        passed_count: passed,
        total_count: total,
        detail,
        validated_at: new Date().toISOString(),
      },
      { onConflict: "problem_id" },
    );
    fail(writeError, "validation write");
    return { status, passed, total };
  };

  if (!row?.solution) return record("no_solution", 0, 0, "No reference solution is stored.");
  const cases = await service.rpc("grading_cases", { p_problem: problemId });
  fail(cases.error, "case read");
  const rows = (cases.data ?? []) as {
    input: string;
    expected_output: string;
    is_sample: boolean;
  }[];
  if (rows.length === 0) return record("error", 0, 0, "The problem has no test cases.");

  try {
    const result = await deps.limit(coder.userId, () =>
      gradeCases(
        (stdin) => deps.executor.run(row.language, row.solution as string, stdin),
        rows.map((r) => ({ input: r.input, expected: r.expected_output, isSample: r.is_sample })),
      ),
    );
    return record(
      result.allPassed ? "passed" : "failed",
      result.passedTotal,
      result.total,
      `Verdict: ${result.verdict}`,
    );
  } catch (err) {
    if (err instanceof ExecutionError) return record("error", 0, rows.length, err.message);
    throw err;
  }
}

// Playground -------------------------------------------------------------------------------------------
async function assertPlaygroundOn(db: Db, coder: Coder) {
  if (coder.admin) return;
  const { data, error } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "playground")
    .maybeSingle();
  fail(error, "flag read");
  if ((data as { enabled: boolean } | null)?.enabled === false) {
    throw new CodingError("The playground is turned off right now.", "forbidden");
  }
}

export async function runPlayground(
  deps: Deps,
  db: Db,
  coder: Coder,
  input: { language: string; code: string; stdin: string },
): Promise<RunOutcome> {
  await assertPlaygroundOn(db, coder);
  try {
    return await deps.limit(coder.userId, () =>
      deps.executor.run(input.language, input.code, input.stdin),
    );
  } catch (error) {
    return executionFailure(error);
  }
}

export async function listPrograms(db: Db, coder: Coder): Promise<ProgramRow[]> {
  const { data, error } = await db
    .from("playground_programs")
    .select("id,title,language,code,stdin,updated_at")
    .eq("owner_id", coder.userId)
    .order("updated_at", { ascending: false });
  fail(error, "program list");
  return (
    (data ?? []) as {
      id: string;
      title: string;
      language: string;
      code: string;
      stdin: string;
      updated_at: string;
    }[]
  ).map((p) => ({
    id: p.id,
    title: p.title,
    language: p.language,
    code: p.code,
    stdin: p.stdin,
    updatedAt: p.updated_at,
  }));
}

export async function saveProgram(
  db: Db,
  coder: Coder,
  input: { id?: string | undefined; title: string; language: string; code: string; stdin: string },
) {
  await assertPlaygroundOn(db, coder);
  const fields = {
    title: input.title,
    language: input.language,
    code: input.code,
    stdin: input.stdin,
  };
  if (input.id) {
    // Scoped to the owner: another user's id matches no row.
    const { data, error } = await db
      .from("playground_programs")
      .update(fields)
      .eq("id", input.id)
      .eq("owner_id", coder.userId)
      .select("id");
    fail(error, "program update");
    if (((data ?? []) as unknown[]).length === 0)
      throw new CodingError("That program was not found.", "not_found");
    return { id: input.id };
  }
  const { data, error } = await db
    .from("playground_programs")
    .insert({ owner_id: coder.userId, ...fields })
    .select("id")
    .single();
  fail(error, "program save");
  return { id: (data as { id: string }).id };
}

export async function deleteProgram(db: Db, coder: Coder, id: string) {
  const { error } = await db
    .from("playground_programs")
    .delete()
    .eq("id", id)
    .eq("owner_id", coder.userId);
  fail(error, "program delete");
  return { id };
}
