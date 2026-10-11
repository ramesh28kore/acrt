import { z } from "zod";
import { LANGUAGE_IDS } from "./languages";

const uuid = z.string().uuid();
const MAX_CODE = 64 * 1024;
const code = z.string().max(MAX_CODE, "The program is too large.");

export const problemInputSchema = z.object({ problemId: uuid });
export const runInputSchema = z.object({ problemId: uuid, code });
export const draftInputSchema = z.object({ problemId: uuid, code });
export const playgroundRunSchema = z.object({
  language: z.enum(LANGUAGE_IDS),
  code,
  stdin: z.string().max(MAX_CODE).default(""),
});
export const playgroundSaveSchema = z.object({
  id: uuid.optional(),
  title: z.string().trim().min(1).max(120),
  language: z.enum(LANGUAGE_IDS),
  code,
  stdin: z.string().max(MAX_CODE).default(""),
});
export const playgroundDeleteSchema = z.object({ id: uuid });

export type SolutionPayload = {
  solution: string;
  language: string;
  approach: string | null;
  algorithm: string | null;
  explanation: string | null;
  timeComplexity: string | null;
  spaceComplexity: string | null;
};

export type SolutionResult =
  | { ok: true; solution: SolutionPayload }
  | {
      ok: false;
      reason: "not_solved" | "not_available" | "test_source";
      attemptsRemaining?: number;
    };

export type TutorialSections = {
  understandProblem: string | null;
  given: string | null;
  exampleWalkthrough: string | null;
  thinkingPrompts: string | null;
  solutionSteps: { title?: string; body?: string; code?: string }[] | null;
  pseudocode: string | null;
  dryRun: string | null;
  commonMistakes: string | null;
  practiceChallenges: string | null;
  hints: string[] | null;
  approach: string | null;
  algorithm: string | null;
  explanation: string | null;
  timeComplexity: string | null;
  spaceComplexity: string | null;
};

export type TutorialResult =
  | {
      ok: true;
      codeLocked: boolean;
      attemptsRemaining: number;
      tutorial: Partial<TutorialSections>;
      solution: { solution: string; language: string } | null;
    }
  | { ok: false; reason: "not_available" | "test_source" };

export type ProblemListItem = {
  id: string;
  title: string;
  difficulty: string | null;
  setName: string;
  solved: boolean;
  attempted: boolean;
  locked: boolean;
  lockReason: string | null;
  isPublished: boolean;
};

export type TopicProblems = { topicId: string; topicName: string; problems: ProblemListItem[] };

export type SubmissionSummary = {
  id: string;
  status: string;
  verdict: string | null;
  passedTotal: number | null;
  total: number | null;
  createdAt: string;
  code: string;
};

export type ProblemDetail = {
  problem: {
    id: string;
    title: string;
    difficulty: string | null;
    blocks: import("../learning/blocks").SheetBlock[];
    samples: { input: string; output: string }[];
    isPublished: boolean;
  };
  draft: string | null;
  submissions: SubmissionSummary[];
  attempts: number;
  solved: boolean;
  staff: boolean;
  backend: "piston" | "endpoint" | "none";
};

export type ProgramRow = {
  id: string;
  title: string;
  language: string;
  code: string;
  stdin: string;
  updatedAt: string;
};
