import { z } from "zod";

const uuid = z.string().uuid();

// Answers are validated for shape and size here; the database re-validates them against the real question set.
const optionIds = z.array(z.string().min(1).max(100)).max(50);
export const answersSchema = z.object({
  options: z.record(z.string().max(64), optionIds).default({}),
  text: z.record(z.string().max(64), z.string().max(2000)).default({}),
  marked: z.array(z.string().max(64)).max(500).default([]),
});

export const setInputSchema = z.object({ setId: uuid });
export const saveInputSchema = z.object({ attemptId: uuid, answers: answersSchema });
export const submitInputSchema = z.object({ attemptId: uuid, answers: answersSchema.optional() });
export const resultInputSchema = z.object({ attemptId: uuid });
export const publishInputSchema = z.object({ setId: uuid, published: z.boolean() });
export const durationInputSchema = z.object({
  setId: uuid,
  minutes: z.number().int().min(1).max(600).nullable(),
});

export type QuizAnswers = z.infer<typeof answersSchema>;

export type QuizOption = { id: string; label: string; content: string };
export type QuizQuestion = {
  id: string;
  position: number;
  questionType: string;
  prompt: string;
  code: string | null;
  codeLang: string | null;
  multiple: boolean;
  textual: boolean;
  options: QuizOption[];
};

export type GradedQuestion = {
  mcqId: string;
  selectedOptionIds: string[];
  correctOptionIds: string[] | null;
  submittedText: string | null;
  expectedText: string | null;
  isCorrect: boolean | null;
  explanation: string | null;
};

export type QuizResult = {
  attemptId: string;
  mcqSetId: string;
  scored: number;
  gradeable: number;
  total: number;
  score: number | null;
  late: boolean;
  autoSubmitted: boolean;
  graded: GradedQuestion[];
  questions: QuizQuestion[];
};

export type QuizSetInfo = {
  id: string;
  name: string;
  durationMinutes: number | null;
  timed?: boolean;
  questionCount?: number;
};

export type HistoryEntry = {
  attemptId: string;
  submittedAt: string;
  score: number | null;
  scored: number | null;
  gradeable: number | null;
  total: number | null;
};

export type QuizState =
  | { phase: "intro"; set: QuizSetInfo; history: HistoryEntry[]; serverNow: string }
  | {
      phase: "active";
      attemptId: string;
      startedAt: string;
      deadlineAt: string | null;
      serverNow: string;
      durationMinutes: number | null;
      set: QuizSetInfo;
      questions: QuizQuestion[];
      answers: QuizAnswers;
    }
  | {
      phase: "result";
      attemptId: string;
      set: QuizSetInfo;
      result: QuizResult;
      history: HistoryEntry[];
      serverNow: string;
    };

export type QuizListItem = {
  id: string;
  name: string;
  position: number;
  durationMinutes: number | null;
  questionCount: number;
  isPublished: boolean;
  completed: boolean;
  attempts: number;
  bestScore: number | null;
  locked: boolean;
  lockReason: string | null;
};

export type QuizTopic = { topicId: string; topicName: string; quizzes: QuizListItem[] };
