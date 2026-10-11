import { outputsMatch } from "./output";
import { deriveVerdict, type CaseEval, type Verdict } from "./verdict";
import type { RunOutcome } from "./execution";

export type GradeCase = { input: string; expected: string; isSample: boolean };

export type SampleResult = {
  input: string;
  expected: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timeMs: number;
  passed: boolean;
};

// Hidden cases appear only as counts: no input, expected output, actual output or stderr leaves the server.
export type GradeResult = {
  verdict: Verdict;
  sampleResults: SampleResult[];
  hiddenPassed: number;
  hiddenTotal: number;
  passedTotal: number;
  total: number;
  allPassed: boolean;
};

export type RunFn = (stdin: string) => Promise<RunOutcome>;

const STDERR_LIMIT = 4_000;

async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function matches(outcome: RunOutcome, expected: string) {
  return (
    outcome.exitCode === 0 && outcome.signal === null && outputsMatch(outcome.stdout, expected)
  );
}

export async function gradeCases(
  run: RunFn,
  cases: readonly GradeCase[],
  options: { parallel?: number } = {},
): Promise<GradeResult> {
  const outcomes = await mapWithLimit(cases, options.parallel ?? 4, (c) => run(c.input));
  const evals: CaseEval[] = [];
  const sampleResults: SampleResult[] = [];
  let hiddenPassed = 0;
  let hiddenTotal = 0;
  let passedTotal = 0;

  cases.forEach((c, index) => {
    const outcome = outcomes[index] as RunOutcome;
    const passed = matches(outcome, c.expected);
    evals.push({ passed, exitCode: outcome.exitCode, signal: outcome.signal });
    if (passed) passedTotal += 1;
    if (c.isSample) {
      sampleResults.push({
        input: c.input,
        expected: c.expected,
        stdout: outcome.stdout,
        stderr: outcome.stderr.slice(0, STDERR_LIMIT),
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timeMs: outcome.timeMs,
        passed,
      });
    } else {
      hiddenTotal += 1;
      if (passed) hiddenPassed += 1;
    }
  });

  return {
    verdict: deriveVerdict(evals),
    sampleResults,
    hiddenPassed,
    hiddenTotal,
    passedTotal,
    total: cases.length,
    allPassed: cases.length > 0 && passedTotal === cases.length,
  };
}
