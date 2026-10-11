// Imported course text still carries the source platform's names; the rows stay as imported
// and the swap happens at render time so the import remains comparable with its source.
const TERMS: { pattern: RegExp; to: string }[] = [
  { pattern: /\bNxt\s*Wave\b/gi, to: "Ramesh" },
  { pattern: /\bCCBP\b/gi, to: "KORE" },
];

// Spans that must survive untouched: rewriting a domain or code identifier breaks links and examples.
const PROTECTED = new RegExp(
  [
    "```[\\s\\S]*?```",
    "`[^`\\n]*`",
    "\\]\\([^)]*\\)",
    "<[^>]+>",
    "https?://[^\\s<>\"')]+",
    "\\bwww\\.[^\\s<>\"')]+",
    "\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:in|com|org|net|io|dev|co)\\b[^\\s<>\"')]*",
  ].join("|"),
  "gi",
);

function matchCase(matched: string, to: string): string {
  if (matched === matched.toUpperCase()) return to.toUpperCase();
  if (matched === matched.toLowerCase()) return to.toLowerCase();
  const head = matched.charAt(0);
  if (head === head.toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return to.charAt(0).toUpperCase() + to.slice(1).toLowerCase();
  }
  return to;
}

function substitute(text: string): string {
  let out = text;
  for (const { pattern, to } of TERMS) {
    out = out.replace(pattern, (matched) => matchCase(matched, to));
  }
  return out;
}

export function rebrand(text: string): string {
  if (!text) return text;
  let out = "";
  let cursor = 0;
  const protectedSpans = new RegExp(PROTECTED.source, PROTECTED.flags);
  for (let hit = protectedSpans.exec(text); hit !== null; hit = protectedSpans.exec(text)) {
    out += substitute(text.slice(cursor, hit.index)) + hit[0];
    cursor = hit.index + hit[0].length;
  }
  return out + substitute(text.slice(cursor));
}

// Code blocks are skipped outright and an image's url is never touched; only prose is branded.
export function rebrandBlocks<T extends { type: string }>(blocks: T[]): T[] {
  return blocks.map((block) => {
    if (block.type === "code") return block;
    const next: Record<string, unknown> = { ...block };
    if (typeof next["text"] === "string") next["text"] = rebrand(next["text"]);
    if (typeof next["alt"] === "string") next["alt"] = rebrand(next["alt"]);
    return next as T;
  });
}
