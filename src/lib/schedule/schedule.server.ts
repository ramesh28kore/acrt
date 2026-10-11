import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadIdentity } from "@/lib/identity";
import { buildCurriculum, type CurriculumSource } from "./curriculum";
import { buildPlan, parseDate, todayDate } from "./plan";
import { previewSchema, publishSchema, settingsSchema, type PreviewInput } from "./contracts";

// The canonical backend types are being reconciled by M01–M07.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;
export type ScheduleActor = {
  userId: string;
  student: boolean;
  staff: boolean;
  admin: boolean;
  instituteId: string | null;
};

export async function resolveScheduleActor(db: Db, userId: string): Promise<ScheduleActor> {
  const identity = await loadIdentity(db, userId);
  if (!identity?.active || identity.roles.length === 0)
    throw new Error("An active account is required.");
  const admin = identity.roles.includes("admin");
  return {
    userId,
    student: identity.roles.includes("student"),
    staff: admin || identity.roles.includes("faculty"),
    admin,
    instituteId: identity.profile.institute_id,
  };
}
function fail(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (["42501", "40001", "22023", "23514"].includes(error.code ?? ""))
    throw new Error(error.message);
  if (["PGRST202", "42P01"].includes(error.code ?? ""))
    throw new Error(
      "Schedule storage is not installed. Ask your administrator to complete the M08 database update.",
    );
  throw new Error("The schedule could not be loaded. Refresh and try again.");
}
const contextSchema = z.object({
  instituteId: z.string().uuid().nullable(),
  version: z.number().int().nonnegative(),
  settings: settingsSchema,
  canConfigure: z.boolean(),
  canExport: z.boolean(),
  signature: z.string().nullable(),
  academicStart: z.string().nullable(),
});
export async function loadContext(db: Db, instituteId?: string) {
  const response = await db.rpc("schedule_context", { p_institute: instituteId ?? null });
  fail(response.error);
  return contextSchema.parse(response.data);
}
// Every catalogue/activity read is paginated; no silent PostgREST 1,000-row truncation.
async function rows(
  db: Db,
  table: string,
  columns: string,
  filters: Record<string, string> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const result = [];
  for (let offset = 0; offset < 100_000; offset += 500) {
    let query = db
      .from(table)
      .select(columns)
      .order(table === "lesson_progress" ? "sheet_id" : "id")
      .range(offset, offset + 499);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const response = await query;
    fail(response.error);
    const page = response.data ?? [];
    result.push(...page);
    if (page.length < 500) return result;
  }
  throw new Error("This curriculum exceeds the supported size. Contact your administrator.");
}
export async function loadSource(db: Db): Promise<CurriculumSource> {
  const [topics, sheets, sets, quizzes, problems, questions] = await Promise.all([
    rows(db, "topics", "id,name,position,is_published"),
    rows(db, "sheets", "id,topic_id,title,position,is_published"),
    rows(db, "sets", "id,topic_id,name,position,is_published"),
    rows(db, "mcq_sets", "id,topic_id,name,position,is_published"),
    rows(db, "problems", "id,topic_id,set_id,title,position"),
    rows(db, "mcqs", "id,mcq_set_id"),
  ]);
  const counts = new Map<string, number>();
  for (const row of questions) counts.set(row.mcq_set_id, (counts.get(row.mcq_set_id) ?? 0) + 1);
  return {
    topics: topics.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      isPublished: r.is_published,
    })),
    sheets: sheets.map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      title: r.title,
      position: r.position,
      isPublished: r.is_published,
    })),
    sets: sets.map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      name: r.name,
      position: r.position,
      isPublished: r.is_published,
    })),
    quizzes: quizzes.map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      name: r.name,
      position: r.position,
      isPublished: r.is_published,
      questionCount: counts.get(r.id) ?? 0,
    })),
    problems: problems.map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      setId: r.set_id,
      title: r.title,
      position: r.position,
    })),
  };
}
export async function loadStudentStartDate(
  db: Db,
  actor: ScheduleActor,
  academicStart: string | null = null,
): Promise<string> {
  if (!actor.student) throw new Error("Only students have personal schedules.");
  const response = await db
    .from("profiles")
    .select("course_start_date,created_at")
    .eq("id", actor.userId)
    .maybeSingle();
  fail(response.error);
  // Explicit student date wins. Never rewrite academic calendars or the documented 15 Aug 2026 default.
  const start =
    response.data?.course_start_date ?? academicStart ?? response.data?.created_at?.slice(0, 10);
  if (!start) throw new Error("Your course start date is not configured.");
  parseDate(start);
  return start;
}
export async function loadSchedule(db: Db, actor: ScheduleActor) {
  if (!actor.student) throw new Error("Only students have personal schedules.");
  const [context, source, progress, attempts, submissions] = await Promise.all([
    loadContext(db),
    loadSource(db),
    rows(db, "lesson_progress", "sheet_id,status", { student_id: actor.userId }),
    rows(db, "mcq_attempts", "id,mcq_set_id,submitted_at", { student_id: actor.userId }),
    rows(db, "submissions", "id,problem_id,status", { student_id: actor.userId, status: "passed" }),
  ]);
  const built = buildCurriculum(source, context.settings.order);
  const done = {
    sheet: new Set(progress.filter((r) => r.status === "completed").map((r) => r.sheet_id)),
    quiz: new Set(attempts.filter((r) => r.submitted_at).map((r) => r.mcq_set_id)),
    problem: new Set(submissions.map((r) => r.problem_id)),
  };
  const items = built.items.map((item) => ({ ...item, completed: done[item.kind].has(item.id) }));
  const plan = buildPlan(
    items,
    await loadStudentStartDate(db, actor, context.academicStart),
    context.settings,
  );
  return {
    ...plan,
    warnings: built.warnings,
    settings: context.settings,
    version: context.version,
  };
}
export async function scheduleAdministration(db: Db, actor: ScheduleActor) {
  if (!actor.admin) throw new Error("Admin access is required.");
  const institutes = await rows(db, "institutes", "id,code,name");
  // The RPC independently checks scope; listing institutes is already permitted by their existing RLS.
  const selected = actor.instituteId ?? institutes[0]?.id;
  const context = await loadContext(db, selected);
  return {
    context,
    institutes: institutes.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
    })),
  };
}
export async function previewSchedule(db: Db, actor: ScheduleActor, raw: PreviewInput) {
  if (!actor.admin) throw new Error("Admin access is required.");
  const input = previewSchema.parse(raw);
  const before = await loadContext(db, input.instituteId);
  const source = await loadSource(db);
  const after = await loadContext(db, input.instituteId);
  if (before.signature !== after.signature)
    throw new Error("The curriculum changed while loading. Preview again.");
  const built = buildCurriculum(source, input.order, input.includeDrafts);
  const startDate = input.startDate ?? before.academicStart ?? todayDate();
  const plan = buildPlan(built.items, startDate, input);
  const warnings = [...built.warnings];
  const oversized = built.items.filter((item) => item.minutes > input.dailyMinutes);
  if (oversized.length)
    warnings.push(oversized.length + " items exceed the daily budget and occupy a day alone.");
  if (input.includeDrafts)
    warnings.push(
      "Draft content is included in this preview only. Switch drafts off before publishing settings.",
    );
  return { plan, warnings, context: before, input };
}
export async function publishSchedule(
  db: Db,
  actor: ScheduleActor,
  raw: z.infer<typeof publishSchema>,
) {
  if (!actor.admin) throw new Error("Admin access is required.");
  const input = publishSchema.parse(raw);
  if (input.includeDrafts) throw new Error("Preview published content before saving settings.");
  const preview = await previewSchedule(db, actor, input);
  if (!preview.context.canConfigure)
    throw new Error("Schedule configuration permission is required.");
  if (
    preview.context.signature !== input.signature ||
    preview.context.version !== input.expectedVersion
  )
    throw new Error("The curriculum or schedule changed. Preview again before publishing.");
  const invalid = preview.warnings.filter(
    (w) => !w.includes("unpublished") && !w.includes("daily budget"),
  );
  if (invalid.length)
    throw new Error("Repair curriculum references before publishing: " + invalid.join("; "));
  const response = await db.rpc("schedule_publish", {
    p_institute: preview.context.instituteId,
    p_settings: settingsSchema.parse({
      dailyMinutes: input.dailyMinutes,
      restDays: input.restDays,
      order: input.order,
    }),
    p_expected_version: input.expectedVersion,
    p_signature: input.signature,
  });
  fail(response.error);
  return { version: z.number().int().positive().parse(response.data) };
}
