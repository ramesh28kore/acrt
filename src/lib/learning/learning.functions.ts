import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  progressInputSchema,
  publishInputSchema,
  sheetInputSchema,
  topicInputSchema,
} from "./learning.contracts";

export const learningTopics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const service = await import("./learning.server");
    const viewer = await service.resolveViewer(context.supabase, context.userId);
    return service.listTopics(context.supabase, viewer);
  });

export const learningTopic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => topicInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./learning.server");
    const viewer = await service.resolveViewer(context.supabase, context.userId);
    return service.getTopicDetail(context.supabase, viewer, data.topicId);
  });

export const learningSheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => sheetInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./learning.server");
    const viewer = await service.resolveViewer(context.supabase, context.userId);
    return service.getSheetDetail(context.supabase, viewer, data.topicId, data.sheetId);
  });

export const learningProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => progressInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./learning.server");
    const viewer = await service.resolveViewer(context.supabase, context.userId);
    return service.recordProgress(
      context.supabase,
      viewer,
      data.topicId,
      data.sheetId,
      data.status,
    );
  });

export const learningPublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => publishInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./learning.server");
    const viewer = await service.resolveViewer(context.supabase, context.userId);
    return service.setPublished(context.supabase, viewer, data);
  });
