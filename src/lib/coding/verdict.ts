export type Verdict =
  "ACCEPTED" | "WRONG_ANSWER" | "RUNTIME_ERROR" | "TIME_LIMIT" | "INTERNAL_ERROR";

export const VERDICT_LABEL: Record<Verdict, string> = {
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong Answer",
  RUNTIME_ERROR: "Runtime Error",
  TIME_LIMIT: "Time Limit Exceeded",
  INTERNAL_ERROR: "Judge error",
};

export type CaseEval = { passed: boolean; exitCode: number | null; signal?: string | null };

// A timeout or crash is reported even when some cases matched, because the submission is not correct.
// A killed process has a null exit code or SIGKILL/SIGXCPU, which is how every backend reports a limit.
export function deriveVerdict(cases: readonly CaseEval[]): Verdict {
  if (cases.length === 0) return "INTERNAL_ERROR";
  if (cases.every((c) => c.passed)) return "ACCEPTED";
  if (
    cases.some(
      (c) => !c.passed && (c.exitCode === null || c.signal === "SIGKILL" || c.signal === "SIGXCPU"),
    )
  ) {
    return "TIME_LIMIT";
  }
  if (cases.some((c) => !c.passed && c.exitCode !== 0)) return "RUNTIME_ERROR";
  return "WRONG_ANSWER";
}
