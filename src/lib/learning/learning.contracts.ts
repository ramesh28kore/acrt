import { z } from "zod";

const id = z.string().uuid();

export const topicInputSchema = z.object({ topicId: id });
export const sheetInputSchema = z.object({ topicId: id, sheetId: id });
export const progressInputSchema = sheetInputSchema.extend({
  status: z.enum(["in_progress", "completed"]),
});
export const publishInputSchema = z.object({
  kind: z.enum(["topic", "sheet"]),
  id,
  published: z.boolean(),
});

export type ProgressStatus = "not_started" | "in_progress" | "completed";

export type TopicSummary = {
  id: string;
  name: string;
  position: number;
  isPublished: boolean;
  sheetCount: number;
  completed: number;
  inProgress: number;
  percent: number;
};

export type SheetListItem = {
  id: string;
  title: string;
  position: number;
  isPublished: boolean;
  status: ProgressStatus;
  locked: boolean;
  lockReason: string | null;
};

export type TopicDetail = {
  topic: { id: string; name: string; isPublished: boolean };
  sheets: SheetListItem[];
  nextSheetId: string | null;
  staff: boolean;
};

export type SheetNeighbor = { id: string; title: string; locked: boolean };

export type SheetDetail = {
  topic: { id: string; name: string };
  sheet: {
    id: string;
    title: string;
    isPublished: boolean;
    status: ProgressStatus;
    blocks: import("./blocks").SheetBlock[];
    droppedBlocks: number;
    pdfUrl: string | null;
  };
  previous: SheetNeighbor | null;
  next: SheetNeighbor | null;
  staff: boolean;
};

export type PublishInput = z.infer<typeof publishInputSchema>;
