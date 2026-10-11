import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  answerKeySchema,
  answerSchema,
  attemptIdSchema,
  feedbackSchema,
  testSeriesIdSchema,
  violationSchema,
} from "./test-series.contracts";

async function load(context: { supabase: unknown; userId: string }) {
  const service = await import("./test-series.server");
  const db = context.supabase as Parameters<typeof service.resolveActor>[0];
  const actor = await service.resolveActor(db, context.userId);
  return { service, db, actor };
}

export const testSeriesList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { service, db, actor } = await load(context);
    return service.listTests(db, actor);
  });

export const testSeriesLoad = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => testSeriesIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return {
      test: await service.loadTest(db, actor, data.testId),
      questions: await service.questions(db, actor, data.testId),
    };
  });

export const testSeriesStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => testSeriesIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.start(db, actor, data.testId);
  });

export const testSeriesAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => answerSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.submitAnswer(db, actor, data.attemptId, data.questionId, data.selected);
  });

export const testSeriesExpire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => attemptIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.finishIfExpired(db, actor, data.attemptId);
  });

export const testSeriesViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => violationSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.recordViolation(db, actor, data.attemptId, data.reason);
  });

export const testSeriesResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => attemptIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.result(db, actor, data.attemptId);
  });

export const testSeriesFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => feedbackSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.submitFeedback(db, actor, data.attemptId, data.rating, data.comment);
  });

export const testSeriesSetAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => answerKeySchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.setAnswer(db, actor, data.questionId, data.correctOption, data.explanation);
  });

export const testSeriesConfirmAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => testSeriesIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, actor } = await load(context);
    return service.confirmAnswers(db, actor, data.testId);
  });
