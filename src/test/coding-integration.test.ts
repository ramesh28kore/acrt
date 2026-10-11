import { pathToFileURL } from "node:url";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExecutor, type Executor } from "@/lib/coding/execution";
import { gradeCases } from "@/lib/coding/grading";

// Runs real untrusted programs through the application's own execution client against an isolated
// Docker backend (no network, read-only filesystem, no capabilities, memory/PID/CPU limits).
// Enable with: EXEC_INTEGRATION=1 npx vitest run src/test/coding-integration.test.ts
const enabled = process.env["EXEC_INTEGRATION"] === "1";

describe.skipIf(!enabled)("execution against an isolated backend", () => {
  let executor: Executor;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env["ACRT_TEST_SECRET"] = "must-not-be-visible";
    const shimPath = pathToFileURL(
      path.resolve(__dirname, "../../scripts/execution-shim.mjs"),
    ).href;
    const shim = (await import(/* @vite-ignore */ shimPath)) as {
      startShim: (o: {
        maxTimeoutMs: number;
      }) => Promise<{ url: string; close: () => Promise<void> }>;
    };
    const started = await shim.startShim({ maxTimeoutMs: 4000 });
    close = started.close;
    executor = createExecutor({ PISTON_URL: started.url });
  }, 60_000);

  afterAll(async () => {
    delete process.env["ACRT_TEST_SECRET"];
    await close?.();
  });

  it("runs a program with stdin and captures stdout", async () => {
    const outcome = await executor.run("python", "print(int(input()) * 2)", "21\n");
    expect(outcome).toMatchObject({ stdout: "42\n", exitCode: 0, signal: null });
  }, 60_000);

  it("grades Accepted, Wrong Answer, Runtime Error and Time Limit correctly", async () => {
    const run = (source: string) => (stdin: string) => executor.run("python", source, stdin);
    const cases = [{ input: "3", expected: "6", isSample: true }];

    expect((await gradeCases(run("print(int(input())*2)"), cases)).verdict).toBe("ACCEPTED");
    expect((await gradeCases(run("print(int(input())*3)"), cases)).verdict).toBe("WRONG_ANSWER");
    expect((await gradeCases(run("raise ValueError('boom')"), cases)).verdict).toBe(
      "RUNTIME_ERROR",
    );
    expect((await gradeCases(run("while True: pass"), cases)).verdict).toBe("TIME_LIMIT");
  }, 120_000);

  it("reports the traceback of a crash to the student", async () => {
    const outcome = await executor.run("python", "print(1/0)", "");
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toContain("ZeroDivisionError");
  }, 60_000);

  it("treats CRLF and trailing whitespace in program output as equal to the expected text", async () => {
    const source = "import sys\nsys.stdout.write('a  \\r\\nb \\r\\n\\r\\n')";
    const result = await gradeCases(
      (stdin) => executor.run("python", source, stdin),
      [{ input: "", expected: "a\nb", isSample: true }],
    );
    expect(result.verdict).toBe("ACCEPTED");
  }, 60_000);

  it("blocks all network access", async () => {
    const source = [
      "import socket",
      "s = socket.socket()",
      "s.settimeout(2)",
      "try:",
      "    s.connect(('1.1.1.1', 53))",
      "    print('CONNECTED')",
      "except OSError:",
      "    print('BLOCKED')",
    ].join("\n");
    const outcome = await executor.run("python", source, "");
    expect(outcome.stdout.trim()).toBe("BLOCKED");
  }, 60_000);

  it("does not expose the host environment or application secrets", async () => {
    const source =
      "import os\nprint(os.environ.get('ACRT_TEST_SECRET', 'absent'))\nprint(sorted(k for k in os.environ if 'SUPABASE' in k or 'SERVICE' in k))";
    const outcome = await executor.run("python", source, "");
    expect(outcome.stdout).toContain("absent");
    expect(outcome.stdout).toContain("[]");
    expect(outcome.stdout).not.toContain("must-not-be-visible");
  }, 60_000);

  it("cannot write to the filesystem outside a small scratch area", async () => {
    const source = [
      "try:",
      "    open('/etc/pwned', 'w').write('x')",
      "    print('WROTE')",
      "except OSError:",
      "    print('DENIED')",
    ].join("\n");
    expect((await executor.run("python", source, "")).stdout.trim()).toBe("DENIED");
  }, 60_000);

  it("contains a fork bomb and a memory bomb without taking the backend down", async () => {
    const fork = "import os\nwhile True:\n    os.fork()";
    const forked = await executor.run("python", fork, "");
    expect(forked.exitCode === 0 && forked.signal === null).toBe(false);

    const memory = "x = bytearray(2 * 1024**3)\nprint(len(x))";
    const bombed = await executor.run("python", memory, "");
    expect(bombed.stdout).not.toContain("2147483648");

    const after = await executor.run("python", "print('still alive')", "");
    expect(after.stdout.trim()).toBe("still alive");
  }, 120_000);

  it("truncates a flood of output instead of returning it all", async () => {
    const outcome = await executor.run("python", "print('x' * 10_000_000)", "");
    expect(outcome.stdout.length).toBeLessThan(200_000);
  }, 60_000);
});
