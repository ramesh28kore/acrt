import { z } from "zod";
import { parseDate } from "./plan";

export const courseDateSchema = z.string().refine((value) => {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}, "Choose a valid calendar date.");
export const settingsSchema = z
  .object({
    dailyMinutes: z.number().int().min(15).max(1440),
    restDays: z
      .array(z.number().int().min(0).max(6))
      .max(6)
      .refine((days) => new Set(days).size === days.length, "Rest days must be unique."),
    order: z.enum(["stage-first", "topic-first", "topic-interleaved"]),
  })
  .strict();
export type ScheduleSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: ScheduleSettings = {
  dailyMinutes: 120,
  restDays: [0],
  order: "topic-interleaved",
};
export const previewSchema = settingsSchema.extend({
  instituteId: z.string().uuid().optional(),
  startDate: courseDateSchema.optional(),
  includeDrafts: z.boolean().default(false),
});
export type PreviewInput = z.infer<typeof previewSchema>;
export const publishSchema = previewSchema
  .extend({
    expectedVersion: z.number().int().nonnegative(),
    signature: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();
export const exportSchema = publishSchema.extend({ format: z.enum(["xlsx", "docx"]) });
