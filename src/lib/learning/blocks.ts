import { z } from "zod";

// Only same-origin paths and https images are rendered; stored content is never trusted as a URL.
export function isSafeImageUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const text = z.string().max(20_000);

export const sheetBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text }),
  z.object({ type: z.literal("paragraph"), text }),
  z.object({ type: z.literal("list_item"), text }),
  z.object({
    type: z.literal("code"),
    text: z.string().max(100_000),
    lang: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("image"),
    url: z.string().max(2_000).refine(isSafeImageUrl, "Unsafe image address"),
    alt: z.string().max(500).optional(),
  }),
]);

export type SheetBlock = z.infer<typeof sheetBlockSchema>;

// One malformed block must not hide the rest of a lesson; it is dropped and counted instead.
export function parseBlocks(raw: unknown): { blocks: SheetBlock[]; dropped: number } {
  if (!Array.isArray(raw)) return { blocks: [], dropped: 0 };
  const blocks: SheetBlock[] = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = sheetBlockSchema.safeParse(item);
    if (parsed.success) blocks.push(parsed.data);
    else dropped += 1;
  }
  return { blocks, dropped };
}

export type InlineSegment = { text: string; strong?: true; em?: true; code?: true };

const TAG_RE = /<(\/?)(strong|b|em|i|code)>/gi;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function unescapeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

// Imported text may hold a small allow-list of inline tags. Everything else, including
// angle brackets that are course content such as <class 'list'>, stays literal text.
export function parseInline(raw: string): InlineSegment[] {
  if (!raw.includes("<") && !raw.includes("&")) return raw ? [{ text: raw }] : [];
  const segments: InlineSegment[] = [];
  const open: string[] = [];
  let cursor = 0;

  const push = (chunk: string) => {
    if (!chunk) return;
    const segment: InlineSegment = { text: unescapeEntities(chunk) };
    if (open.includes("strong") || open.includes("b")) segment.strong = true;
    if (open.includes("em") || open.includes("i")) segment.em = true;
    if (open.includes("code")) segment.code = true;
    segments.push(segment);
  };

  for (const match of raw.matchAll(TAG_RE)) {
    push(raw.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    const tag = (match[2] ?? "").toLowerCase();
    if (match[1]) {
      const at = open.lastIndexOf(tag);
      if (at !== -1) open.splice(at, 1);
    } else {
      open.push(tag);
    }
  }
  push(raw.slice(cursor));
  return segments;
}
