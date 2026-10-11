import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseInline, type SheetBlock } from "@/lib/learning/blocks";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        let node: React.ReactNode = segment.text;
        if (segment.code) {
          node = (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{node}</code>
          );
        }
        if (segment.em) node = <em>{node}</em>;
        if (segment.strong) node = <strong>{node}</strong>;
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function CodeBlock({ code, lang }: { code: string; lang?: string | undefined }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    setState((await copyText(code)) ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-border bg-muted/40">
      <figcaption className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-8 items-center gap-1.5 rounded px-2 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {state === "copied" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </figcaption>
      <pre className="overflow-x-auto p-3 text-sm leading-relaxed">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Code copied to clipboard" : ""}
      </span>
    </figure>
  );
}

export function SheetContent({ blocks }: { blocks: SheetBlock[] }) {
  const nodes: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: string) => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={key} className="my-3 list-disc space-y-1 pl-6">
        {items.map((item, index) => (
          <li key={index}>
            <Inline text={item} />
          </li>
        ))}
      </ul>,
    );
  };

  blocks.forEach((block, index) => {
    if (block.type === "list_item") {
      list.push(block.text);
      return;
    }
    flushList(`list-${index}`);
    if (block.type === "heading") {
      nodes.push(
        <h2 key={index} className="mt-8 font-display text-xl text-foreground">
          <Inline text={block.text} />
        </h2>,
      );
    } else if (block.type === "paragraph") {
      nodes.push(
        <p key={index} className="my-3 leading-7 break-words">
          <Inline text={block.text} />
        </p>,
      );
    } else if (block.type === "code") {
      nodes.push(<CodeBlock key={index} code={block.text} lang={block.lang} />);
    } else {
      nodes.push(
        <img
          key={index}
          src={block.url}
          alt={block.alt ?? ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-4 h-auto max-w-full rounded-lg border border-border"
        />,
      );
    }
  });
  flushList("list-end");

  return <div className="text-card-foreground">{nodes}</div>;
}
