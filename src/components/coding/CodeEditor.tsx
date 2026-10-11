import type { GradeResult } from "@/lib/coding/grading";
import { VERDICT_LABEL } from "@/lib/coding/verdict";

export function CodeEditor({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <textarea
      aria-label={label}
      value={value}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Tab indents instead of leaving the editor; Escape then Tab still moves focus on.
        if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const target = event.currentTarget;
        const { selectionStart, selectionEnd } = target;
        onChange(`${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`);
        requestAnimationFrame(() =>
          target.setSelectionRange(selectionStart + 4, selectionStart + 4),
        );
      }}
      className="h-72 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-sm leading-relaxed whitespace-pre focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

export function ResultPanel({ result, kind }: { result: GradeResult; kind: "run" | "submit" }) {
  const accepted = result.verdict === "ACCEPTED";
  return (
    <section aria-live="polite" className="rounded-lg border border-border bg-card p-4">
      <h3 className={`font-display text-lg ${accepted ? "text-primary" : "text-destructive"}`}>
        {VERDICT_LABEL[result.verdict]}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {result.passedTotal} of {result.total} {kind === "run" ? "sample " : ""}cases passed
        {result.hiddenTotal > 0 &&
          ` (hidden cases: ${result.hiddenPassed} of ${result.hiddenTotal})`}
      </p>
      <ul className="mt-3 space-y-3">
        {result.sampleResults.map((sample, index) => (
          <li key={index} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Sample {index + 1}</span>
              <span className={sample.passed ? "text-primary" : "text-destructive"}>
                {sample.passed ? "Passed" : "Failed"}
              </span>
            </div>
            <Block label="Input" value={sample.input} />
            <Block label="Expected" value={sample.expected} />
            <Block label="Your output" value={sample.stdout} />
            {sample.stderr && <Block label="Error" value={sample.stderr} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words">
        {value || " "}
      </pre>
    </div>
  );
}
