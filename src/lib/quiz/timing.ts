// Countdown helpers. The browser clock is only ever used for the difference since the page loaded:
// the deadline is the server's, and the displayed time is offset by how far the browser is from it.
export function clockOffsetMs(serverNowIso: string, clientNowMs: number): number {
  return new Date(serverNowIso).getTime() - clientNowMs;
}

// Estimated server "now" for a given client reading.
export function estimatedServerNow(offsetMs: number, clientNowMs: number): number {
  return clientNowMs + offsetMs;
}

export function remainingMs(
  deadlineIso: string | null,
  offsetMs: number,
  clientNowMs: number,
): number | null {
  if (!deadlineIso) return null;
  return Math.max(0, new Date(deadlineIso).getTime() - estimatedServerNow(offsetMs, clientNowMs));
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export type QuestionStatus = "unanswered" | "answered" | "marked";

// Marked wins over answered so a flagged question always stands out in the palette.
export function questionStatus(
  questionId: string,
  answers: { options: Record<string, string[]>; text: Record<string, string>; marked: string[] },
): QuestionStatus {
  if (answers.marked.includes(questionId)) return "marked";
  const picked = answers.options[questionId];
  const typed = answers.text[questionId];
  return (picked && picked.length > 0) || (typed && typed.trim() !== "")
    ? "answered"
    : "unanswered";
}
