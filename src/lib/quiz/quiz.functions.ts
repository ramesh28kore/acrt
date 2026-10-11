import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  durationInputSchema,
  publishInputSchema,
  resultInputSchema,
  saveInputSchema,
  setInputSchema,
  submitInputSchema,
} from "./quiz.contracts";

// Quizzes run entirely under the student's own session; the database functions do the grading and
// deadline checks, so no privileged key is involved anywhere in this flow.
async function load(context: { supabase: unknown; userId: string }) {
  const service = await import("./quiz.server");
  const db = context.supabase as Parameters<typeof service.resolveLearner>[0];
  const learner = await service.resolveLearner(db, context.userId);
  return { service, db, learner };
}

export const quizList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { service, db, learner } = await load(context);
    return service.listQuizzes(db, learner);
  });

export const quizState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => setInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.quizState(db, learner, data.setId);
  });

export const quizStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => setInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.startQuiz(db, learner, data.setId);
  });

export const quizSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => saveInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.saveAnswers(db, learner, data.attemptId, data.answers);
  });

export const quizSubmit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => submitInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.submitQuiz(db, learner, data.attemptId, data.answers);
  });

export const quizResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => resultInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.quizResult(db, learner, data.attemptId);
  });

export const quizPublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => publishInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.setQuizPublished(db, learner, data.setId, data.published);
  });

export const quizDuration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => durationInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, learner } = await load(context);
    return service.setQuizDuration(db, learner, data.setId, data.minutes);
  });
