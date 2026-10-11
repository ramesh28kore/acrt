import { describe, expect, it, vi } from "vitest";

import {
  CodingError,
  deleteProgram,
  getProblemDetail,
  getSolution,
  getTutorial,
  listPrograms,
  listProblems,
  resolveCoder,
  runPlayground,
  runSamples,
  saveDraft,
  saveProgram,
  submit,
  validateReference,
  type Coder,
  type Deps,
} from "@/lib/coding/coding.server";
import { ExecutionError, type Executor, type RunOutcome } from "@/lib/coding/execution";

type Row = Record<string, unknown>;

// In-memory database. It returns every row it holds regardless of the caller, so anything a student
// must not see has to be removed by the service itself, and the tests below prove that it is.
function fakeDb(tables: Record<string, Row[]>, rpc: Record<string, (args: Row) => unknown> = {}) {
  const log = {
    upserts: [] as Row[],
    inserts: [] as Row[],
    rpc: [] as { name: string; args: Row }[],
  };
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let mode: "select" | "update" | "delete" | "insert" | "upsert" = "select";
    let patch: Row = {};
    let head = false;
    const api: Record<string, unknown> = {};
    const filter = (fn: (r: Row) => boolean) => {
      rows = rows.filter(fn);
      return api;
    };
    Object.assign(api, {
      select: (_cols?: string, options?: { head?: boolean }) => {
        head = Boolean(options?.head);
        return api;
      },
      eq: (key: string, value: unknown) => filter((r) => r[key] === value),
      in: (key: string, values: unknown[]) => filter((r) => values.includes(r[key])),
      gte: (key: string, value: unknown) => filter((r) => String(r[key]) >= String(value)),
      order: () => api,
      limit: () => api,
      insert: (row: Row) => {
        mode = "insert";
        patch = row;
        return api;
      },
      upsert: (row: Row) => {
        mode = "upsert";
        patch = row;
        log.upserts.push(row);
        return api;
      },
      update: (row: Row) => {
        mode = "update";
        patch = row;
        return api;
      },
      delete: () => {
        mode = "delete";
        return api;
      },
      single: async () => commit().then((d) => ({ data: d[0] ?? null, error: null })),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (mode === "select")
          return resolve({ data: head ? null : rows, count: rows.length, error: null });
        return commit().then((data) => resolve({ data, error: null }));
      },
    });
    async function commit(): Promise<Row[]> {
      const store = (tables[table] ??= []);
      if (mode === "insert") {
        const row = { id: `new-${store.length + 1}`, ...patch };
        store.push(row);
        log.inserts.push(row);
        return [row];
      }
      if (mode === "upsert") {
        const at = store.findIndex((r) =>
          ["student_id", "problem_id"].every((k) => r[k] === patch[k]),
        );
        if (at >= 0) store[at] = { ...store[at], ...patch };
        else store.push(patch);
        return [patch];
      }
      if (mode === "update") {
        rows.forEach((r) => Object.assign(r, patch));
        return rows;
      }
      if (mode === "delete") {
        tables[table] = store.filter((r) => !rows.includes(r));
        return rows;
      }
      return rows;
    }
    return api;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => {
      log.rpc.push({ name, args });
      const handler = rpc[name];
      return handler
        ? { data: handler(args), error: null }
        : { data: null, error: { message: "no such function", code: "42883" } };
    },
  };
  return { client: client as never, log, tables };
}

const STUDENT = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const FACULTY = "00000000-0000-0000-0000-0000000000f1";
const T1 = "00000000-0000-0000-0000-0000000000d1";
const T2 = "00000000-0000-0000-0000-0000000000d2";
const S1 = "00000000-0000-0000-0000-0000000000e1";
const S2 = "00000000-0000-0000-0000-0000000000e2";
const P1 = "00000000-0000-0000-0000-0000000000b1";
const P2 = "00000000-0000-0000-0000-0000000000b2";
const P3 = "00000000-0000-0000-0000-0000000000b3";
const P4 = "00000000-0000-0000-0000-0000000000b4";

const student: Coder = { userId: STUDENT, staff: false, admin: false };
const faculty: Coder = { userId: FACULTY, staff: true, admin: false };

function catalogue(extra: Record<string, Row[]> = {}) {
  return {
    topics: [
      { id: T1, name: "Python CCBP Basics", position: 1, is_published: true },
      { id: T2, name: "Draft topic", position: 2, is_published: false },
    ],
    sets: [
      { id: S1, topic_id: T1, name: "Set 1", position: 1, is_published: true },
      { id: S2, topic_id: T1, name: "Draft set", position: 2, is_published: false },
    ],
    problems: [
      {
        id: P1,
        set_id: S1,
        topic_id: T1,
        title: "First",
        difficulty: "EASY",
        position: 1,
        content: [{ type: "paragraph", text: "Add NxtWave numbers" }],
        samples: [{ input: "1", output: "1" }],
      },
      {
        id: P2,
        set_id: S1,
        topic_id: T1,
        title: "Second",
        difficulty: "EASY",
        position: 2,
        content: [],
        samples: [],
      },
      {
        id: P3,
        set_id: S2,
        topic_id: T1,
        title: "In draft set",
        difficulty: null,
        position: 1,
        content: [],
        samples: [],
      },
      {
        id: P4,
        set_id: S1,
        topic_id: T2,
        title: "In draft topic",
        difficulty: null,
        position: 1,
        content: [],
        samples: [],
      },
    ],
    test_cases: [
      { problem_id: P1, input: "1", expected_output: "1", is_sample: true, position: 1 },
    ],
    submissions: [],
    practice_drafts: [],
    playground_programs: [],
    feature_flags: [],
    ...extra,
  };
}

const outcome = (
  stdout: string,
  exitCode: number | null = 0,
  signal: string | null = null,
): RunOutcome => ({
  stdout,
  stderr: "",
  exitCode,
  signal,
  timeMs: 5,
});

function deps(
  run: (language: string, source: string, stdin: string) => Promise<RunOutcome>,
  service: () => never = () => {
    throw new Error("service client should not be used");
  },
): Deps & { calls: { language: string; stdin: string }[] } {
  const calls: { language: string; stdin: string }[] = [];
  const executor: Executor = {
    backend: "piston",
    run: async (language, source, stdin) => {
      calls.push({ language, stdin });
      return run(language, source, stdin);
    },
  };
  return { executor, limit: (_user, task) => task(), service, calls };
}

function serviceDb(cases: Row[], recorded: Row[] = []) {
  return fakeDb(
    {},
    {
      grading_cases: () => cases,
      record_graded_submission: (args) => {
        recorded.push(args);
        return "sub-1";
      },
    },
  );
}

describe("problem visibility", () => {
  it("shows students only published problems and applies branding", async () => {
    const { client } = fakeDb(catalogue());
    const topics = await listProblems(client, student);
    expect(topics.map((t) => t.topicName)).toEqual(["Python KORE Basics"]);
    expect(topics[0]?.problems.map((p) => p.id)).toEqual([P1, P2]);
  });

  it("denies unpublished problems behind a changed id, without revealing they exist", async () => {
    const { client } = fakeDb(catalogue());
    const hidden = await getProblemDetail(client, student, "piston", P3).catch((e) => e);
    const missing = await getProblemDetail(
      client,
      student,
      "piston",
      "00000000-0000-0000-0000-00000000ffff",
    ).catch((e) => e);
    expect(hidden).toBeInstanceOf(CodingError);
    expect(hidden.kind).toBe("not_found");
    expect(hidden.message).toBe(missing.message);
    await expect(getProblemDetail(client, student, "piston", P4)).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("lets staff review drafts and bypass the ladder", async () => {
    const { client } = fakeDb(catalogue());
    const topics = await listProblems(client, faculty);
    expect(topics.flatMap((t) => t.problems.map((p) => p.id)).sort()).toEqual(
      [P1, P2, P3, P4].sort(),
    );
    expect(topics.flatMap((t) => t.problems).every((p) => !p.locked)).toBe(true);
    expect((await getProblemDetail(client, faculty, "piston", P3)).problem.isPublished).toBe(false);
  });

  it("locks the next problem until the previous one is solved, and never re-locks a solved one", async () => {
    const tables = catalogue({ submissions: [] });
    const { client } = fakeDb(tables);
    expect((await listProblems(client, student))[0]?.problems.map((p) => p.locked)).toEqual([
      false,
      true,
    ]);
    await expect(getProblemDetail(client, student, "piston", P2)).rejects.toMatchObject({
      kind: "locked",
    });

    (tables.submissions as Row[]).push({ student_id: STUDENT, problem_id: P1, status: "passed" });
    expect((await listProblems(client, student))[0]?.problems.map((p) => p.locked)).toEqual([
      false,
      false,
    ]);
    expect((await getProblemDetail(client, student, "piston", P2)).problem.id).toBe(P2);
  });

  it("ignores another student's submissions when computing progress", async () => {
    const { client } = fakeDb(
      catalogue({ submissions: [{ student_id: OTHER, problem_id: P1, status: "passed" }] }),
    );
    // The fake returns every row; the service must filter to the caller.
    expect((await listProblems(client, student))[0]?.problems.map((p) => p.locked)).toEqual([
      false,
      true,
    ]);
  });
});

describe("Run", () => {
  it("grades only the sample cases, stores nothing and never reads hidden cases", async () => {
    const { client, log } = fakeDb(catalogue());
    const d = deps(async (_l, _s, stdin) => outcome(stdin));
    const result = await runSamples(d, client, student, P1, "print(input())");
    expect(result).toMatchObject({ verdict: "ACCEPTED", total: 1, hiddenTotal: 0 });
    expect(d.calls).toEqual([{ language: "python", stdin: "1" }]);
    expect(log.inserts).toHaveLength(0);
    expect(log.rpc).toHaveLength(0);
  });

  it("refuses a locked or unpublished problem", async () => {
    const { client } = fakeDb(catalogue());
    const d = deps(async () => outcome("1"));
    await expect(runSamples(d, client, student, P2, "x")).rejects.toMatchObject({ kind: "locked" });
    await expect(runSamples(d, client, student, P3, "x")).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(d.calls).toHaveLength(0);
  });

  it("reports a judge outage as unavailable instead of a verdict", async () => {
    const { client } = fakeDb(catalogue());
    const d = deps(async () => {
      throw new ExecutionError("The code runner is unavailable.", "unavailable");
    });
    await expect(runSamples(d, client, student, P1, "x")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

describe("Submit", () => {
  const hiddenCases = [
    { input: "1", expected_output: "1", is_sample: true },
    { input: "secret-hidden-input", expected_output: "secret-hidden-output", is_sample: false },
  ];

  it("grades every case with a server-side read and records the verdict through the grader", async () => {
    const recorded: Row[] = [];
    const service = serviceDb(hiddenCases, recorded);
    const { client } = fakeDb(catalogue());
    const d = deps(
      async (_l, _s, stdin) => outcome(stdin === "1" ? "1" : "secret-hidden-output"),
      () => service.client,
    );
    const result = await submit(d, client, student, P1, "print(1)");
    expect(result).toMatchObject({
      verdict: "ACCEPTED",
      allPassed: true,
      total: 2,
      hiddenTotal: 1,
      submissionId: "sub-1",
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        p_student: STUDENT,
        p_problem: P1,
        p_status: "passed",
        p_language: "python",
        p_code: "print(1)",
      }),
    ]);
  });

  it("never returns hidden input or expected output, even when the program leaks its input", async () => {
    const recorded: Row[] = [];
    const service = serviceDb(hiddenCases, recorded);
    const { client } = fakeDb(catalogue());
    const d = deps(
      async (_l, _s, stdin) => outcome(stdin),
      () => service.client,
    );
    const result = await submit(d, client, student, P1, "print(input())");
    for (const text of [JSON.stringify(result), JSON.stringify(recorded)]) {
      expect(text).not.toContain("secret-hidden-input");
      expect(text).not.toContain("secret-hidden-output");
    }
    expect(result.verdict).toBe("WRONG_ANSWER");
  });

  it("records a failed submission with the right verdict for errors and timeouts", async () => {
    const recorded: Row[] = [];
    const service = serviceDb(hiddenCases, recorded);
    const { client } = fakeDb(catalogue());
    const crash = await submit(
      deps(
        async () => outcome("", 1),
        () => service.client,
      ),
      client,
      student,
      P1,
      "x",
    );
    expect(crash.verdict).toBe("RUNTIME_ERROR");
    const slow = await submit(
      deps(
        async () => outcome("", null, "SIGKILL"),
        () => service.client,
      ),
      client,
      student,
      P1,
      "x",
    );
    expect(slow.verdict).toBe("TIME_LIMIT");
    expect(recorded.map((r) => r["p_status"])).toEqual(["failed", "failed"]);
  });

  it("records nothing when the judge is down, so an outage never counts as an attempt", async () => {
    const recorded: Row[] = [];
    const service = serviceDb(hiddenCases, recorded);
    const { client } = fakeDb(catalogue());
    const d = deps(
      async () => {
        throw new ExecutionError("The code runner is unavailable.", "unavailable");
      },
      () => service.client,
    );
    await expect(submit(d, client, student, P1, "x")).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(recorded).toHaveLength(0);
  });

  it("rate-limits repeated submissions before any code runs", async () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({
      student_id: STUDENT,
      problem_id: P1,
      status: "failed",
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));
    const { client } = fakeDb(catalogue({ submissions: recent }));
    const d = deps(
      async () => outcome("1"),
      () => serviceDb(hiddenCases).client,
    );
    await expect(submit(d, client, student, P1, "x")).rejects.toMatchObject({ kind: "busy" });
    expect(d.calls).toHaveLength(0);
  });

  it("refuses to grade a problem with no test cases, and a locked or unpublished one", async () => {
    const empty = serviceDb([]);
    const { client } = fakeDb(catalogue());
    const d = deps(
      async () => outcome(""),
      () => empty.client,
    );
    await expect(submit(d, client, student, P1, "x")).rejects.toMatchObject({ kind: "invalid" });
    await expect(submit(d, client, student, P2, "x")).rejects.toMatchObject({ kind: "locked" });
    await expect(submit(d, client, student, P3, "x")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("solution reveal", () => {
  const solution = { ok: true, solution: { solution: "print(input())", language: "python" } };
  const notSolved = { ok: false, reason: "not_solved", attemptsRemaining: 2 };

  it("returns what the database decides for students and never reads the solution table itself", async () => {
    const tables = catalogue({
      problem_solutions: [{ problem_id: P1, solution: "SECRET-CODE", language: "python" }],
    });
    const locked = fakeDb(tables, { student_solution: () => notSolved });
    await expect(getSolution(locked.client, student, P1)).resolves.toEqual(notSolved);
    expect(JSON.stringify(await getSolution(locked.client, student, P1))).not.toContain(
      "SECRET-CODE",
    );

    const earned = fakeDb(tables, { student_solution: () => solution });
    await expect(getSolution(earned.client, student, P1)).resolves.toEqual(solution);
  });

  it("does not offer the solution of a locked or unpublished problem", async () => {
    const { client } = fakeDb(catalogue(), { student_solution: () => solution });
    await expect(getSolution(client, student, P2)).rejects.toMatchObject({ kind: "locked" });
    await expect(getSolution(client, student, P3)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("serves the tutorial from the database rule and gives staff no student tutorial", async () => {
    const payload = {
      ok: true,
      codeLocked: true,
      attemptsRemaining: 3,
      tutorial: { understandProblem: "Read a number." },
      solution: null,
    };
    const { client } = fakeDb(catalogue(), { student_tutorial: () => payload });
    await expect(getTutorial(client, student, P1)).resolves.toEqual(payload);
    await expect(getTutorial(client, faculty, P1)).resolves.toEqual({
      ok: false,
      reason: "not_available",
    });
  });

  it("lets staff read the stored solution for review", async () => {
    const { client } = fakeDb(
      catalogue({
        problem_solutions: [
          { problem_id: P1, solution: "print(1)", language: "python", approach: "a" },
        ],
      }),
    );
    await expect(getSolution(client, faculty, P1)).resolves.toMatchObject({
      ok: true,
      solution: { solution: "print(1)" },
    });
  });
});

describe("drafts", () => {
  it("autosaves the student's own draft and reloads it with the problem", async () => {
    const tables = catalogue();
    const { client } = fakeDb(tables);
    await expect(saveDraft(client, student, P1, "x = 1")).resolves.toEqual({ saved: true });
    await saveDraft(client, student, P1, "x = 2");
    expect(tables.practice_drafts).toEqual([
      expect.objectContaining({ student_id: STUDENT, problem_id: P1, code: "x = 2" }),
    ]);
    expect((await getProblemDetail(client, student, "piston", P1)).draft).toBe("x = 2");
  });

  it("does not load another student's draft or submissions", async () => {
    const tables = catalogue({
      practice_drafts: [{ student_id: OTHER, problem_id: P1, code: "their work" }],
      submissions: [
        {
          id: "s",
          student_id: OTHER,
          problem_id: P1,
          status: "failed",
          code: "their code",
          results: null,
          created_at: "2026-01-01",
        },
      ],
    });
    const { client } = fakeDb(tables);
    const detail = await getProblemDetail(client, student, "piston", P1);
    expect(detail.draft).toBeNull();
    expect(detail.submissions).toEqual([]);
  });

  it("does not save a draft for a locked or unpublished problem, and staff do not store drafts", async () => {
    const tables = catalogue();
    const { client } = fakeDb(tables);
    await expect(saveDraft(client, student, P2, "x")).rejects.toMatchObject({ kind: "locked" });
    await expect(saveDraft(client, student, P3, "x")).rejects.toMatchObject({ kind: "not_found" });
    await expect(saveDraft(client, faculty, P1, "x")).resolves.toEqual({ saved: false });
    expect(tables.practice_drafts).toHaveLength(0);
  });
});

describe("reference validation", () => {
  const cases = [
    { input: "1", expected_output: "1", is_sample: true },
    { input: "2", expected_output: "2", is_sample: false },
  ];

  it("records a pass when the stored solution satisfies every case", async () => {
    const service = fakeDb({ problem_validations: [] }, { grading_cases: () => cases });
    const { client } = fakeDb(
      catalogue({
        problem_solutions: [{ problem_id: P1, solution: "print(input())", language: "python" }],
      }),
    );
    const d = deps(
      async (_l, _s, stdin) => outcome(stdin),
      () => service.client,
    );
    await expect(validateReference(d, client, faculty, P1)).resolves.toEqual({
      status: "passed",
      passed: 2,
      total: 2,
    });
    expect(service.tables["problem_validations"]).toEqual([
      expect.objectContaining({ problem_id: P1, status: "passed" }),
    ]);
  });

  it("records a failure, a missing solution and a judge outage distinctly", async () => {
    const service = fakeDb({ problem_validations: [] }, { grading_cases: () => cases });
    const withSolution = fakeDb(
      catalogue({
        problem_solutions: [{ problem_id: P1, solution: "print(0)", language: "python" }],
      }),
    );
    const failing = deps(
      async () => outcome("0"),
      () => service.client,
    );
    await expect(
      validateReference(failing, withSolution.client, faculty, P1),
    ).resolves.toMatchObject({ status: "failed", passed: 0 });

    const none = fakeDb(catalogue({ problem_solutions: [] }));
    await expect(validateReference(failing, none.client, faculty, P1)).resolves.toMatchObject({
      status: "no_solution",
    });

    const down = deps(
      async () => {
        throw new ExecutionError("The code runner is unavailable.", "unavailable");
      },
      () => service.client,
    );
    await expect(validateReference(down, withSolution.client, faculty, P1)).resolves.toMatchObject({
      status: "error",
    });
  });

  it("is available to staff only", async () => {
    const { client } = fakeDb(catalogue());
    await expect(
      validateReference(
        deps(async () => outcome("")),
        client,
        student,
        P1,
      ),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("playground", () => {
  const input = { language: "python", code: "print(1)", stdin: "" };

  it("runs code in any supported language through the same executor", async () => {
    const { client } = fakeDb(catalogue());
    const d = deps(async () => outcome("1\n"));
    await expect(
      runPlayground(d, client, student, { ...input, language: "cpp" }),
    ).resolves.toMatchObject({ stdout: "1\n" });
    expect(d.calls).toEqual([{ language: "cpp", stdin: "" }]);
  });

  it("honours the feature flag for everyone except admins", async () => {
    const off = fakeDb(catalogue({ feature_flags: [{ key: "playground", enabled: false }] }));
    const d = deps(async () => outcome("1"));
    await expect(runPlayground(d, off.client, student, input)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(runPlayground(d, off.client, faculty, input)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(
      runPlayground(d, off.client, { ...faculty, admin: true }, input),
    ).resolves.toBeDefined();
    await expect(
      saveProgram(off.client, student, { title: "t", language: "python", code: "x", stdin: "" }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("saves, lists and updates only the caller's own programs", async () => {
    const tables = catalogue({
      playground_programs: [
        {
          id: "theirs",
          owner_id: OTHER,
          title: "Theirs",
          language: "python",
          code: "x",
          stdin: "",
          updated_at: "t",
        },
      ],
    });
    const { client } = fakeDb(tables);
    const saved = await saveProgram(client, student, {
      title: "Mine",
      language: "python",
      code: "print(1)",
      stdin: "",
    });
    expect((await listPrograms(client, student)).map((p) => p.title)).toEqual(["Mine"]);
    await expect(
      saveProgram(client, student, {
        id: "theirs",
        title: "Hijack",
        language: "python",
        code: "evil",
        stdin: "",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(tables.playground_programs?.find((p) => p["id"] === "theirs")?.["code"]).toBe("x");
    await saveProgram(client, student, {
      id: saved.id,
      title: "Renamed",
      language: "python",
      code: "print(2)",
      stdin: "",
    });
    expect((await listPrograms(client, student))[0]?.title).toBe("Renamed");
    await deleteProgram(client, student, "theirs");
    expect(tables.playground_programs?.some((p) => p["id"] === "theirs")).toBe(true);
  });
});

describe("caller resolution", () => {
  it("accepts only active accounts", async () => {
    const profile = (extra: Row) => ({
      id: STUDENT,
      role: "student",
      is_super_admin: false,
      is_disabled: false,
      institute_id: null,
      ...extra,
    });
    await expect(
      resolveCoder(fakeDb({ profiles: [profile({})] }).client, STUDENT),
    ).resolves.toEqual({ userId: STUDENT, staff: false, admin: false });
    await expect(
      resolveCoder(fakeDb({ profiles: [profile({ role: "admin" })] }).client, STUDENT),
    ).resolves.toMatchObject({ staff: true, admin: true });
    await expect(
      resolveCoder(fakeDb({ profiles: [profile({ is_disabled: true })] }).client, STUDENT),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(resolveCoder(fakeDb({ profiles: [] }).client, STUDENT)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });
});

vi.spyOn(console, "error").mockImplementation(() => {});
