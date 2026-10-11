import { describe, expect, it, vi } from "vitest";

import {
  LIMITS,
  ExecutionError,
  createExecutor,
  createLimiter,
  selectBackend,
} from "@/lib/coding/execution";
import { gradeCases } from "@/lib/coding/grading";
import { LANGUAGES, languageSpec } from "@/lib/coding/languages";
import { normalizeOutput, outputsMatch } from "@/lib/coding/output";
import {
  ATTEMPTS_TO_UNLOCK_SOLUTION,
  attemptsRemaining,
  hasEarnedSolution,
} from "@/lib/coding/solution-access";
import { deriveVerdict } from "@/lib/coding/verdict";

describe("output normalisation", () => {
  it("ignores CRLF, trailing spaces and trailing blank lines", () => {
    expect(normalizeOutput("a\r\nb  \r\n\r\n")).toBe("a\nb");
    expect(outputsMatch("1 2 3 \n", "1 2 3")).toBe(true);
    expect(outputsMatch("x\r\n", "x\n")).toBe(true);
    expect(outputsMatch("old\rmac\r", "old\nmac")).toBe(true);
  });

  it("keeps leading whitespace, inner blank lines and case significant", () => {
    expect(outputsMatch(" a", "a")).toBe(false);
    expect(outputsMatch("a\n\nb", "a\nb")).toBe(false);
    expect(outputsMatch("Hello", "hello")).toBe(false);
    expect(outputsMatch("", "\n\n")).toBe(true);
  });
});

describe("verdicts", () => {
  const ok = { passed: true, exitCode: 0 };
  it("accepts only when every case passes", () => {
    expect(deriveVerdict([ok, ok])).toBe("ACCEPTED");
    expect(deriveVerdict([])).toBe("INTERNAL_ERROR");
  });

  it("reports wrong answer, runtime error and time limit distinctly", () => {
    expect(deriveVerdict([ok, { passed: false, exitCode: 0 }])).toBe("WRONG_ANSWER");
    expect(deriveVerdict([ok, { passed: false, exitCode: 1 }])).toBe("RUNTIME_ERROR");
    expect(deriveVerdict([ok, { passed: false, exitCode: null, signal: "SIGKILL" }])).toBe(
      "TIME_LIMIT",
    );
    expect(deriveVerdict([{ passed: false, exitCode: 124, signal: "SIGXCPU" }])).toBe("TIME_LIMIT");
  });

  it("lets a timeout outrank a crash and a wrong answer", () => {
    const mixed = [
      { passed: false, exitCode: 0 },
      { passed: false, exitCode: 1 },
      { passed: false, exitCode: null, signal: "SIGKILL" },
    ];
    expect(deriveVerdict(mixed)).toBe("TIME_LIMIT");
  });
});

describe("solution reveal rule", () => {
  it("unlocks on a pass or after three graded attempts", () => {
    expect(hasEarnedSolution({ passed: false, attempts: 0 })).toBe(false);
    expect(hasEarnedSolution({ passed: false, attempts: ATTEMPTS_TO_UNLOCK_SOLUTION - 1 })).toBe(
      false,
    );
    expect(hasEarnedSolution({ passed: false, attempts: ATTEMPTS_TO_UNLOCK_SOLUTION })).toBe(true);
    expect(hasEarnedSolution({ passed: true, attempts: 1 })).toBe(true);
    expect(attemptsRemaining({ passed: false, attempts: 1 })).toBe(2);
    expect(attemptsRemaining({ passed: true, attempts: 0 })).toBe(0);
  });
});

describe("languages", () => {
  it("maps each id to a runtime and a file name, with Java fixed to Main", () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(["python", "javascript", "c", "cpp", "java"]);
    expect(languageSpec("java")?.filename).toBe("Main.java");
    expect(languageSpec("cpp")?.piston).toBe("c++");
    expect(languageSpec("cobol")).toBeUndefined();
  });
});

describe("backend selection", () => {
  it("prefers a configured Piston, then the secured endpoint, and never runs code locally", () => {
    expect(selectBackend({ PISTON_URL: "http://runner:2000/api/v2" })).toBe("piston");
    expect(selectBackend({ CODE_EXEC_URL: "https://x/api/execute", CODE_EXEC_SECRET: "s" })).toBe(
      "endpoint",
    );
    expect(selectBackend({ CODE_EXEC_URL: "https://x/api/execute" })).toBe("none");
    expect(selectBackend({ PISTON_URL: "  " })).toBe("none");
  });

  it("refuses to execute when nothing is configured", async () => {
    const executor = createExecutor({});
    await expect(executor.run("python", "print(1)", "")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

function pistonFetch(handler: (body: Record<string, unknown>) => unknown, status = 200) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/runtimes")) {
      calls.push({ url: target });
      return Response.json([
        { language: "python", version: "3.12.0" },
        { language: "c++", version: "10.2.0" },
      ]);
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: target, body });
    return Response.json(handler(body), { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("execution client", () => {
  it("sends bounded limits to Piston and returns the run outcome", async () => {
    const { fetchImpl, calls } = pistonFetch(() => ({
      run: { stdout: "3\n", stderr: "", code: 0, signal: null },
    }));
    const executor = createExecutor({ PISTON_URL: "http://runner/api/v2/" }, fetchImpl);
    const outcome = await executor.run("python", "print(1+2)", "in");
    expect(outcome).toMatchObject({ stdout: "3\n", exitCode: 0, signal: null });
    const request = calls.find((c) => c.body)?.body;
    expect(request).toMatchObject({
      language: "python",
      version: "3.12.0",
      files: [{ name: "main.py", content: "print(1+2)" }],
      stdin: "in",
      run_timeout: LIMITS.runTimeoutMs,
      compile_timeout: LIMITS.compileTimeoutMs,
      run_memory_limit: LIMITS.runMemoryBytes,
    });
    expect(calls[0]?.url).toBe("http://runner/api/v2/runtimes");
  });

  it("reports a compile failure as the outcome and a killed run with its signal", async () => {
    const compile = pistonFetch(() => ({
      compile: { stderr: "error: boom", code: 1 },
      run: { code: null },
    }));
    const compiled = await createExecutor({ PISTON_URL: "http://r" }, compile.fetchImpl).run(
      "cpp",
      "x",
      "",
    );
    expect(compiled).toMatchObject({ exitCode: 1, stderr: "error: boom" });

    const killed = pistonFetch(() => ({
      run: { stdout: "", stderr: "", code: null, signal: "SIGKILL" },
    }));
    const outcome = await createExecutor({ PISTON_URL: "http://r" }, killed.fetchImpl).run(
      "python",
      "while 1: pass",
      "",
    );
    expect(outcome).toMatchObject({ exitCode: null, signal: "SIGKILL" });
  });

  it("truncates oversized output", async () => {
    const big = "x".repeat(LIMITS.maxOutputChars + 500);
    const { fetchImpl } = pistonFetch(() => ({
      run: { stdout: big, stderr: "", code: 0, signal: null },
    }));
    const outcome = await createExecutor({ PISTON_URL: "http://r" }, fetchImpl).run(
      "python",
      "x",
      "",
    );
    expect(outcome.stdout.length).toBeLessThan(big.length);
    expect(outcome.stdout).toContain("output truncated");
  });

  it("rejects malformed or oversized requests before contacting the runner", async () => {
    const { fetchImpl } = pistonFetch(() => ({ run: {} }));
    const executor = createExecutor({ PISTON_URL: "http://r" }, fetchImpl);
    await expect(executor.run("cobol", "x", "")).rejects.toMatchObject({ kind: "unsupported" });
    await expect(
      executor.run("python", "x".repeat(LIMITS.maxSourceBytes + 1), ""),
    ).rejects.toMatchObject({ kind: "rejected" });
    await expect(
      executor.run("python", "x", "y".repeat(LIMITS.maxStdinBytes + 1)),
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hides backend detail from the caller when the runner fails", async () => {
    const { fetchImpl } = pistonFetch(
      () => ({ message: "internal stack at /opt/piston/secret" }),
      500,
    );
    const error = await createExecutor({ PISTON_URL: "http://r" }, fetchImpl)
      .run("python", "x", "")
      .catch((e) => e);
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error.message).not.toContain("/opt/piston");
  });

  it("sends the shared secret to the bundled endpoint and refuses non-Python there", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ stdout: "ok", stderr: "", exitCode: 0, signal: null }),
    );
    const executor = createExecutor(
      { CODE_EXEC_URL: "https://runner.example/api/execute", CODE_EXEC_SECRET: "s3cret" },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(executor.run("python", "print(1)", "")).resolves.toMatchObject({ stdout: "ok" });
    const init = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]?.[1];
    expect((init?.headers as Record<string, string>)["x-exec-secret"]).toBe("s3cret");
    await expect(executor.run("c", "x", "")).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("run limiter", () => {
  it("caps one user's concurrent runs and the overall queue", async () => {
    const limited = createLimiter({ maxConcurrent: 1, maxQueue: 1, maxPerUser: 2 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = limited("a", () => gate);
    const second = limited("a", async () => "second");
    await expect(limited("a", async () => "third")).rejects.toMatchObject({ kind: "busy" });
    await expect(limited("b", async () => "b")).rejects.toMatchObject({ kind: "busy" });
    release();
    await first;
    await expect(second).resolves.toBe("second");
  });

  it("rejects new work when the queue is full and recovers afterwards", async () => {
    const limited = createLimiter({ maxConcurrent: 1, maxQueue: 0, maxPerUser: 5 });
    let release: () => void = () => {};
    const running = limited("a", () => new Promise<void>((resolve) => (release = resolve)));
    await expect(limited("b", async () => 1)).rejects.toMatchObject({ kind: "busy" });
    release();
    await running;
    await expect(limited("b", async () => 2)).resolves.toBe(2);
  });
});

describe("grading", () => {
  const cases = [
    { input: "2", expected: "4", isSample: true },
    { input: "secret-hidden-input", expected: "secret-hidden-output", isSample: false },
  ];
  const outcome = (stdout: string, exitCode: number | null = 0, signal: string | null = null) => ({
    stdout,
    stderr: "",
    exitCode,
    signal,
    timeMs: 1,
  });

  it("accepts when every case matches under normalisation", async () => {
    const result = await gradeCases(
      async (stdin) => outcome(stdin === "2" ? "4  \r\n" : "secret-hidden-output\n"),
      cases,
    );
    expect(result).toMatchObject({
      verdict: "ACCEPTED",
      allPassed: true,
      passedTotal: 2,
      total: 2,
      hiddenPassed: 1,
      hiddenTotal: 1,
    });
  });

  it("returns only counts for hidden cases, even when the program echoes its input", async () => {
    const result = await gradeCases(async (stdin) => outcome(stdin), cases);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("secret-hidden-input");
    expect(serialised).not.toContain("secret-hidden-output");
    expect(result.sampleResults).toHaveLength(1);
    expect(result.hiddenTotal).toBe(1);
  });

  it("does not count a crash or killed run as a pass even if its output matched", async () => {
    const crashed = await gradeCases(async () => outcome("4", 1), [cases[0]!]);
    expect(crashed).toMatchObject({ verdict: "RUNTIME_ERROR", allPassed: false });
    const killed = await gradeCases(async () => outcome("4", null, "SIGKILL"), [cases[0]!]);
    expect(killed).toMatchObject({ verdict: "TIME_LIMIT", allPassed: false });
  });

  it("never reports success for an empty case list", async () => {
    const result = await gradeCases(async () => outcome(""), []);
    expect(result).toMatchObject({ verdict: "INTERNAL_ERROR", allPassed: false, total: 0 });
  });
});
