import { isSafeImageUrl } from "../learning/blocks";

// Prompts are stored as one text column holding markdown: fenced code blocks and ![alt](url) images.
export type PromptSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "image"; url: string; alt: string };

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const FENCE_RE = /^\s*```(.*)$/;

function pushText(text: string, out: PromptSegment[]) {
  const trimmed = text.trim();
  if (trimmed) out.push({ kind: "text", text: trimmed });
}

// An unsafe image address is kept as visible text, so the question is still readable.
function splitImages(chunk: string, out: PromptSegment[]) {
  let cursor = 0;
  for (const match of chunk.matchAll(IMAGE_RE)) {
    pushText(chunk.slice(cursor, match.index), out);
    const [raw = "", alt = "", url = ""] = match;
    if (isSafeImageUrl(url)) out.push({ kind: "image", url, alt });
    else pushText(raw, out);
    cursor = (match.index ?? 0) + raw.length;
  }
  pushText(chunk.slice(cursor), out);
}

// An unterminated fence stays plain text rather than swallowing the rest of the question.
export function parsePrompt(prompt: string): PromptSegment[] {
  const out: PromptSegment[] = [];
  const lines = prompt.split("\n");
  let plain: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const opening = FENCE_RE.exec(lines[i] ?? "");
    if (!opening) {
      plain.push(lines[i] ?? "");
      continue;
    }
    const close = lines.findIndex((line, j) => j > i && FENCE_RE.test(line));
    if (close === -1) {
      plain.push(lines[i] ?? "");
      continue;
    }
    splitImages(plain.join("\n"), out);
    plain = [];
    const body = lines
      .slice(i + 1, close)
      .join("\n")
      .replace(/^\n+|\s+$/g, "");
    if (body) out.push({ kind: "code", text: body, lang: (opening[1] ?? "").trim() || null });
    i = close;
  }
  splitImages(plain.join("\n"), out);
  return out;
}
