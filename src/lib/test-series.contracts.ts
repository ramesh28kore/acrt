import { z } from "zod";

const uuid = z.string().uuid();
const option = z.string().regex(/^[A-Z]$/);

export const testSeriesIdSchema = z.object({ testId: uuid });
export const attemptIdSchema = z.object({ attemptId: uuid });
export const answerSchema = z.object({ attemptId: uuid, questionId: uuid, selected: option });
export const violationSchema = z.object({ attemptId: uuid, reason: z.enum(["hidden", "blur"]) });
export const feedbackSchema = z.object({
  attemptId: uuid,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullable().optional(),
});
export const answerKeySchema = z.object({
  questionId: uuid,
  correctOption: option,
  explanation: z.string().max(4000).nullable().optional(),
});

export type TestType = "mcq" | "coding";
export type TestSeries = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: "draft" | "ready";
  isEnabled: boolean;
  testType: TestType;
  durationMinutes: number | null;
  cutoffMarks: number | null;
  maxViolations: number;
};
export type TestSeriesQuestion = {
  id: string;
  questionNumber: number;
  questionText: string;
  options: string[];
  marks: number;
};
export type AttemptSummary = {
  id: string;
  testId: string;
  studentId: string;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  score: number;
  totalMarks: number;
  status: "in_progress" | "completed";
  startedAt: string;
  deadlineAt: string | null;
  completedAt: string | null;
  violations: number;
  autoSubmitted: boolean;
};
export type RunningTotals = {
  answered: number;
  total_questions: number;
  score: number;
  total_marks: number;
  correct_answers: number;
  wrong_answers: number;
  status: "in_progress" | "completed";
};
export type ReviewRow = {
  question_number: number;
  question_text: string;
  options: string[];
  selected_option: string | null;
  correct_option: string | null;
  is_correct: boolean | null;
  explanation: string | null;
};
export type TestSeriesResult = {
  attempt: AttemptSummary;
  cutoffMarks: number | null;
  passed: boolean | null;
  review: ReviewRow[];
};
