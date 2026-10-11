import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { previewSchema, publishSchema, exportSchema } from "./contracts";

export const scheduleMine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({})
      .strict()
      .parse(data ?? {}),
  )
  .handler(async ({ context }) => {
    const service = await import("./schedule.server");
    const actor = await service.resolveScheduleActor(context.supabase, context.userId);
    return service.loadSchedule(context.supabase, actor);
  });
export const scheduleAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const service = await import("./schedule.server");
    const actor = await service.resolveScheduleActor(context.supabase, context.userId);
    return service.scheduleAdministration(context.supabase, actor);
  });
export const schedulePreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => previewSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./schedule.server");
    const actor = await service.resolveScheduleActor(context.supabase, context.userId);
    return service.previewSchedule(context.supabase, actor, data);
  });
export const schedulePublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => publishSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./schedule.server");
    const actor = await service.resolveScheduleActor(context.supabase, context.userId);
    return service.publishSchedule(context.supabase, actor, data);
  });
export const scheduleExport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => exportSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./schedule.server");
    const actor = await service.resolveScheduleActor(context.supabase, context.userId);
    const preview = await service.previewSchedule(context.supabase, actor, data);
    if (!preview.context.canExport) throw new Error("Schedule export permission is required.");
    if (
      preview.context.signature !== data.signature ||
      preview.context.version !== data.expectedVersion
    )
      throw new Error("The curriculum or schedule changed. Preview again before exporting.");
    const { exportSchedule } = await import("./office-export");
    return exportSchedule(preview.plan, data.format, {
      drafts: data.includeDrafts,
      version: preview.context.version,
    });
  });
