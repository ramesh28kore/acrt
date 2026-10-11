import type { SupabaseClient } from "@supabase/supabase-js";
import { loadIdentity } from "../identity";
import { parseBlocks } from "./blocks";
import { rebrand, rebrandBlocks } from "./branding";
import { computeGate, lockReason, type GateItem } from "./gating";
import type {
  PublishInput,
  ProgressStatus,
  SheetDetail,
  SheetListItem,
  TopicDetail,
  TopicSummary,
} from "./learning.contracts";

// The running backend's content tables are not in the generated types yet, so rows are typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

type TopicRow = { id: string; name: string; position: number; is_published: boolean };
type SheetRow = {
  id: string;
  topic_id: string;
  title: string;
  position: number;
  is_published: boolean;
};
type ProgressRow = { sheet_id: string; status: ProgressStatus };

export const PDF_LINK_SECONDS = 600;
const UNAVAILABLE = "This lesson isn't available.";

export class LearningError extends Error {
  constructor(
    message: string,
    readonly kind: "forbidden" | "not_found" | "locked" | "failed",
  ) {
    super(message);
    this.name = "LearningError";
  }
}

export type Viewer = { userId: string; staff: boolean };

export async function resolveViewer(client: Db, userId: string): Promise<Viewer> {
  const identity = await loadIdentity(client, userId);
  if (!identity?.active || identity.roles.length === 0) {
    throw new LearningError("An active account is required.", "forbidden");
  }
  return {
    userId,
    staff: identity.roles.includes("faculty") || identity.roles.includes("admin"),
  };
}

function failed(error: { code?: string; message: string } | null, what: string) {
  if (!error) return;
  if (error.code === "42501" || error.code === "P0001") {
    throw new LearningError(error.message, "forbidden");
  }
  if (error.code === "P0002") throw new LearningError(UNAVAILABLE, "not_found");
  console.error(`Learning: ${what} failed`, error.code);
  throw new LearningError("That could not be completed. Refresh and try again.", "failed");
}

// Students only ever see published content. The database enforces this too; this keeps the
// response safe even if a policy is loosened by mistake.
const visibleTopic = (viewer: Viewer, topic: TopicRow) => viewer.staff || topic.is_published;
const visibleSheet = (viewer: Viewer, sheet: SheetRow) => viewer.staff || sheet.is_published;

async function loadProgress(client: Db, viewer: Viewer, sheetIds: string[]) {
  const map = new Map<string, ProgressStatus>();
  if (viewer.staff || sheetIds.length === 0) return map;
  const { data, error } = await client
    .from("lesson_progress")
    .select("sheet_id,status")
    .eq("student_id", viewer.userId)
    .in("sheet_id", sheetIds);
  failed(error, "progress read");
  for (const row of (data ?? []) as ProgressRow[]) map.set(row.sheet_id, row.status);
  return map;
}

async function loadTopic(client: Db, viewer: Viewer, topicId: string): Promise<TopicRow> {
  const { data, error } = await client
    .from("topics")
    .select("id,name,position,is_published")
    .eq("id", topicId)
    .maybeSingle();
  failed(error, "topic read");
  const topic = data as TopicRow | null;
  if (!topic || !visibleTopic(viewer, topic)) throw new LearningError(UNAVAILABLE, "not_found");
  return topic;
}

async function loadTopicSheets(client: Db, viewer: Viewer, topicId: string) {
  const { data, error } = await client
    .from("sheets")
    .select("id,topic_id,title,position,is_published")
    .eq("topic_id", topicId)
    .order("position")
    .order("id");
  failed(error, "sheet list read");
  return ((data ?? []) as SheetRow[]).filter((sheet) => visibleSheet(viewer, sheet));
}

function gateFor(viewer: Viewer, sheets: SheetRow[], progress: Map<string, ProgressStatus>) {
  const items: GateItem[] = sheets.map((sheet) => ({
    id: sheet.id,
    stage: "sheet",
    title: rebrand(sheet.title),
    completed: progress.get(sheet.id) === "completed",
  }));
  return computeGate(items, { bypass: viewer.staff });
}

export async function listTopics(client: Db, viewer: Viewer): Promise<TopicSummary[]> {
  const [topicsResult, sheetsResult] = await Promise.all([
    client.from("topics").select("id,name,position,is_published").order("position"),
    client.from("sheets").select("id,topic_id,title,position,is_published"),
  ]);
  failed(topicsResult.error, "topic list read");
  failed(sheetsResult.error, "sheet count read");

  const topics = ((topicsResult.data ?? []) as TopicRow[]).filter((t) => visibleTopic(viewer, t));
  const visibleIds = new Set(topics.map((t) => t.id));
  const sheets = ((sheetsResult.data ?? []) as SheetRow[]).filter(
    (s) => visibleIds.has(s.topic_id) && visibleSheet(viewer, s),
  );
  const progress = await loadProgress(
    client,
    viewer,
    sheets.map((s) => s.id),
  );

  return topics.map((topic) => {
    const own = sheets.filter((s) => s.topic_id === topic.id);
    const completed = own.filter((s) => progress.get(s.id) === "completed").length;
    const inProgress = own.filter((s) => progress.get(s.id) === "in_progress").length;
    return {
      id: topic.id,
      name: rebrand(topic.name),
      position: topic.position,
      isPublished: topic.is_published,
      sheetCount: own.length,
      completed,
      inProgress,
      percent: own.length > 0 ? Math.round((completed / own.length) * 100) : 0,
    };
  });
}

export async function getTopicDetail(
  client: Db,
  viewer: Viewer,
  topicId: string,
): Promise<TopicDetail> {
  const topic = await loadTopic(client, viewer, topicId);
  const sheets = await loadTopicSheets(client, viewer, topicId);
  const progress = await loadProgress(
    client,
    viewer,
    sheets.map((s) => s.id),
  );
  const gate = gateFor(viewer, sheets, progress);

  const items: SheetListItem[] = sheets.map((sheet) => ({
    id: sheet.id,
    title: rebrand(sheet.title),
    position: sheet.position,
    isPublished: sheet.is_published,
    status: progress.get(sheet.id) ?? "not_started",
    locked: gate.states.get(sheet.id)?.locked ?? false,
    lockReason: lockReason(gate, sheet.id),
  }));

  return {
    topic: { id: topic.id, name: rebrand(topic.name), isPublished: topic.is_published },
    sheets: items,
    nextSheetId: gate.next?.id ?? null,
    staff: viewer.staff,
  };
}

export async function getSheetDetail(
  client: Db,
  viewer: Viewer,
  topicId: string,
  sheetId: string,
): Promise<SheetDetail> {
  const topic = await loadTopic(client, viewer, topicId);
  const sheets = await loadTopicSheets(client, viewer, topicId);
  const index = sheets.findIndex((s) => s.id === sheetId);
  const row = sheets[index];
  // Missing and unpublished look identical so lesson ids cannot be probed.
  if (index < 0 || !row) throw new LearningError(UNAVAILABLE, "not_found");

  const progress = await loadProgress(
    client,
    viewer,
    sheets.map((s) => s.id),
  );
  const gate = gateFor(viewer, sheets, progress);
  if (gate.states.get(sheetId)?.locked) {
    throw new LearningError(lockReason(gate, sheetId) ?? "This lesson is locked.", "locked");
  }

  const { data, error } = await client
    .from("sheets")
    .select("content,pdf_storage_path")
    .eq("id", sheetId)
    .eq("topic_id", topicId)
    .maybeSingle();
  failed(error, "sheet content read");
  const body = data as { content: unknown; pdf_storage_path: string | null } | null;
  if (!body) throw new LearningError(UNAVAILABLE, "not_found");

  let pdfUrl: string | null = null;
  if (body.pdf_storage_path) {
    // Private bucket: a short-lived signed link is the only download path.
    const signed = await client.storage
      .from("cheat-sheets")
      .createSignedUrl(body.pdf_storage_path, PDF_LINK_SECONDS);
    pdfUrl = signed.data?.signedUrl ?? null;
  }

  const parsed = parseBlocks(body.content);
  const neighbor = (sheet: SheetRow | undefined) =>
    sheet
      ? {
          id: sheet.id,
          title: rebrand(sheet.title),
          locked: gate.states.get(sheet.id)?.locked ?? false,
        }
      : null;

  return {
    topic: { id: topic.id, name: rebrand(topic.name) },
    sheet: {
      id: row.id,
      title: rebrand(row.title),
      isPublished: row.is_published,
      status: progress.get(row.id) ?? "not_started",
      blocks: rebrandBlocks(parsed.blocks),
      droppedBlocks: parsed.dropped,
      pdfUrl,
    },
    previous: neighbor(sheets[index - 1]),
    next: neighbor(sheets[index + 1]),
    staff: viewer.staff,
  };
}

export async function recordProgress(
  client: Db,
  viewer: Viewer,
  topicId: string,
  sheetId: string,
  status: "in_progress" | "completed",
): Promise<{ status: ProgressStatus }> {
  if (viewer.staff) {
    throw new LearningError("Staff previews do not record progress.", "forbidden");
  }
  await loadTopic(client, viewer, topicId);
  const sheets = await loadTopicSheets(client, viewer, topicId);
  if (!sheets.some((s) => s.id === sheetId)) throw new LearningError(UNAVAILABLE, "not_found");

  const progress = await loadProgress(
    client,
    viewer,
    sheets.map((s) => s.id),
  );
  const gate = gateFor(viewer, sheets, progress);
  if (gate.states.get(sheetId)?.locked) {
    throw new LearningError(lockReason(gate, sheetId) ?? "This lesson is locked.", "locked");
  }

  const current = progress.get(sheetId);
  // Completed never moves back, and repeating a status is a no-op.
  if (current === "completed" || current === status) return { status: current };

  const { error } = await client
    .from("lesson_progress")
    .upsert(
      { student_id: viewer.userId, sheet_id: sheetId, status },
      { onConflict: "student_id,sheet_id" },
    );
  failed(error, "progress write");
  return { status };
}

export async function setPublished(client: Db, viewer: Viewer, input: PublishInput) {
  if (!viewer.staff) {
    throw new LearningError("Only faculty or admin can publish content.", "forbidden");
  }
  const rpc = input.kind === "topic" ? "set_topic_published" : "set_sheet_published";
  const { error } = await client.rpc(rpc, { target_id: input.id, published: input.published });
  failed(error, "publish");
  return { id: input.id, published: input.published };
}
