// Three real graded attempts is where withholding the answer stops teaching and starts blocking.
export const ATTEMPTS_TO_UNLOCK_SOLUTION = 3;

export type AttemptStats = {
  passed: boolean;
  // Graded attempts only; a judge outage never counts toward the unlock.
  attempts: number;
};

export function hasEarnedSolution(stats: AttemptStats): boolean {
  return stats.passed || stats.attempts >= ATTEMPTS_TO_UNLOCK_SOLUTION;
}

export function attemptsRemaining(stats: AttemptStats): number {
  if (hasEarnedSolution(stats)) return 0;
  return Math.max(0, ATTEMPTS_TO_UNLOCK_SOLUTION - stats.attempts);
}
