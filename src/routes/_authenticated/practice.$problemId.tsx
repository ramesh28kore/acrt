import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CodeEditor, ResultPanel } from "@/components/coding/CodeEditor";
import { SheetContent } from "@/components/learning/SheetContent";
import {
  codingDraft,
  codingProblem,
  codingRun,
  codingSolution,
  codingSubmit,
  codingTutorial,
  codingValidate,
} from "@/lib/coding/coding.functions";
import { STARTER_CODE } from "@/lib/coding/languages";
import { VERDICT_LABEL, type Verdict } from "@/lib/coding/verdict";
import { errorText } from "@/lib/learning/error-text";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/practice/$problemId")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Coding problem — Avanthi CRT Portal" }] }),
  component: ProblemPage,
});

const AUTOSAVE_MS = 1000;

function ProblemPage() {
  const { problemId } = Route.useParams();
  const queryClient = useQueryClient();
  const problem = useQuery({
    queryKey: ["coding", "problem", problemId],
    queryFn: () => codingProblem({ data: { problemId } }),
    retry: false,
  });

  const [code, setCode] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const loadedDraft = useRef(false);

  const data = problem.data;
  useEffect(() => {
    if (data && code === null) {
      setCode(data.draft ?? STARTER_CODE["python"] ?? "");
      loadedDraft.current = true;
    }
  }, [data, code]);

  const staff = data?.staff ?? false;
  useEffect(() => {
    if (staff || code === null || !loadedDraft.current) return;
    if (code === (data?.draft ?? STARTER_CODE["python"])) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      codingDraft({ data: { problemId, code } })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("failed"));
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [code, staff, problemId, data?.draft]);

  const run = useMutation({
    mutationFn: (source: string) => codingRun({ data: { problemId, code: source } }),
  });
  const submit = useMutation({
    mutationFn: (source: string) => codingSubmit({ data: { problemId, code: source } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coding"] }),
  });
  const validate = useMutation({ mutationFn: () => codingValidate({ data: { problemId } }) });

  const busy = run.isPending || submit.isPending;
  const unavailable = data?.backend === "none";

  return (
    <AppShell title={data?.problem.title ?? "Coding problem"}>
      <Link to="/practice" className="text-sm text-muted-foreground underline">
        All problems
      </Link>
      {problem.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {problem.isError && (
        <p role="alert" className="mt-4 rounded-lg border border-border bg-card p-5 text-sm">
          {errorText(problem.error)}
        </p>
      )}

      {data && code !== null && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <article className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6">
            {!data.problem.isPublished && (
              <p className="mb-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
                Draft: students cannot see this problem yet.
              </p>
            )}
            {data.problem.blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">This problem has no statement yet.</p>
            ) : (
              <SheetContent blocks={data.problem.blocks} />
            )}
            {data.problem.samples.map((sample, index) => (
              <div key={index} className="mt-4 text-sm">
                <div className="font-medium">Sample {index + 1}</div>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
                  {`Input:\n${sample.input}\n\nOutput:\n${sample.output}`}
                </pre>
              </div>
            ))}
          </article>

          <div className="min-w-0 space-y-4">
            {unavailable && (
              <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm">
                Code execution is not configured on this server, so Run and Submit are unavailable.
              </p>
            )}
            <CodeEditor label="Python code editor" value={code} onChange={setCode} />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || unavailable}
                onClick={() => run.mutate(code)}
                className="min-h-11 rounded-md border border-border px-5 text-sm hover:bg-accent disabled:opacity-50"
              >
                {run.isPending ? "Running…" : "Run"}
              </button>
              <button
                type="button"
                disabled={busy || unavailable}
                onClick={() => submit.mutate(code)}
                className="min-h-11 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"
              >
                {submit.isPending ? "Submitting…" : "Submit"}
              </button>
              {staff && (
                <button
                  type="button"
                  disabled={validate.isPending || unavailable}
                  onClick={() => validate.mutate()}
                  className="min-h-11 rounded-md border border-border px-4 text-sm hover:bg-accent disabled:opacity-50"
                >
                  Validate reference solution
                </button>
              )}
              {!staff && (
                <span role="status" className="text-xs text-muted-foreground">
                  {saveState === "saving" && "Saving draft…"}
                  {saveState === "saved" && "Draft saved"}
                  {saveState === "failed" && "Draft could not be saved"}
                </span>
              )}
            </div>

            {run.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorText(run.error)}
              </p>
            )}
            {submit.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorText(submit.error)}
              </p>
            )}
            {validate.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorText(validate.error)}
              </p>
            )}
            {validate.data && (
              <p role="status" className="text-sm">
                Validation: {validate.data.status} ({validate.data.passed} of {validate.data.total}{" "}
                cases)
              </p>
            )}
            {run.data && !submit.data && <ResultPanel result={run.data} kind="run" />}
            {submit.data && <ResultPanel result={submit.data} kind="submit" />}

            {!staff && <Guidance problemId={problemId} solved={data.solved} />}
            {!staff && <History submissions={data.submissions} onRestore={setCode} />}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Guidance({ problemId, solved }: { problemId: string; solved: boolean }) {
  const [open, setOpen] = useState(false);
  const tutorial = useQuery({
    queryKey: ["coding", "tutorial", problemId, solved],
    queryFn: () => codingTutorial({ data: { problemId } }),
    enabled: open,
    retry: false,
  });
  const solution = useQuery({
    queryKey: ["coding", "solution", problemId, solved],
    queryFn: () => codingSolution({ data: { problemId } }),
    enabled: open,
    retry: false,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="min-h-10 text-sm font-medium underline"
      >
        {open ? "Hide tutorial and solution" : "Tutorial and official solution"}
      </button>
      {open && (
        <div className="mt-3 space-y-4 text-sm">
          {tutorial.data?.ok && (
            <div className="space-y-2">
              {tutorial.data.tutorial.understandProblem && (
                <p>{tutorial.data.tutorial.understandProblem}</p>
              )}
              {tutorial.data.tutorial.approach && (
                <p>
                  <strong>Approach: </strong>
                  {tutorial.data.tutorial.approach}
                </p>
              )}
              {tutorial.data.tutorial.timeComplexity && (
                <p>
                  <strong>Time: </strong>
                  {tutorial.data.tutorial.timeComplexity}
                  {tutorial.data.tutorial.spaceComplexity &&
                    ` · Space: ${tutorial.data.tutorial.spaceComplexity}`}
                </p>
              )}
              {tutorial.data.codeLocked && (
                <p className="text-muted-foreground">
                  The final code unlocks after you solve this problem or make{" "}
                  {tutorial.data.attemptsRemaining} more graded attempt
                  {tutorial.data.attemptsRemaining === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
          {tutorial.data && !tutorial.data.ok && (
            <p className="text-muted-foreground">No tutorial is available for this problem yet.</p>
          )}
          {solution.data?.ok && (
            <div>
              <div className="font-medium">Official solution</div>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre">
                {solution.data.solution.solution}
              </pre>
              {solution.data.solution.explanation && (
                <p className="mt-2">{solution.data.solution.explanation}</p>
              )}
            </div>
          )}
          {solution.data && !solution.data.ok && solution.data.reason === "not_solved" && (
            <p className="text-muted-foreground">
              Solve this problem, or make {solution.data.attemptsRemaining ?? 3} more graded attempt
              {solution.data.attemptsRemaining === 1 ? "" : "s"}, to unlock the official solution.
            </p>
          )}
          {solution.data && !solution.data.ok && solution.data.reason === "test_source" && (
            <p className="text-muted-foreground">
              This problem is part of a live test, so help is switched off.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function History({
  submissions,
  onRestore,
}: {
  submissions: {
    id: string;
    status: string;
    verdict: string | null;
    passedTotal: number | null;
    total: number | null;
    createdAt: string;
    code: string;
  }[];
  onRestore: (code: string) => void;
}) {
  if (submissions.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-display text-lg">Your submissions</h3>
      <ul className="mt-2 divide-y divide-border text-sm">
        {submissions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {s.verdict ? (VERDICT_LABEL[s.verdict as Verdict] ?? s.verdict) : s.status}
              {s.passedTotal !== null && s.total !== null && ` · ${s.passedTotal}/${s.total}`}
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onRestore(s.code)}
              className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent"
            >
              Load this code
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
