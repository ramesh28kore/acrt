import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CodeEditor } from "@/components/coding/CodeEditor";
import {
  playgroundDelete,
  playgroundPrograms,
  playgroundRun,
  playgroundSave,
} from "@/lib/coding/coding.functions";
import { LANGUAGES, STARTER_CODE } from "@/lib/coding/languages";
import { errorText } from "@/lib/learning/error-text";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/playground")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Code playground — Avanthi CRT Portal" }] }),
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const queryClient = useQueryClient();
  const programs = useQuery({
    queryKey: ["coding", "programs"],
    queryFn: () => playgroundPrograms(),
  });
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState(STARTER_CODE["python"] ?? "");
  const [stdin, setStdin] = useState("");
  const [title, setTitle] = useState("Untitled");
  const [currentId, setCurrentId] = useState<string | undefined>();

  const run = useMutation({ mutationFn: () => playgroundRun({ data: { language, code, stdin } }) });
  const save = useMutation({
    mutationFn: () => playgroundSave({ data: { id: currentId, title, language, code, stdin } }),
    onSuccess: (saved) => {
      setCurrentId(saved.id);
      return queryClient.invalidateQueries({ queryKey: ["coding", "programs"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => playgroundDelete({ data: { id } }),
    onSuccess: (_result, id) => {
      if (id === currentId) setCurrentId(undefined);
      return queryClient.invalidateQueries({ queryKey: ["coding", "programs"] });
    },
  });

  return (
    <AppShell title="Code playground">
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="mr-2">Language</span>
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value);
                  if (!currentId) setCode(STARTER_CODE[event.target.value] ?? "");
                }}
                className="min-h-10 rounded-md border border-input bg-background px-2"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mr-2">Title</span>
              <input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                className="min-h-10 rounded-md border border-input bg-background px-2"
              />
            </label>
          </div>
          <CodeEditor label="Code editor" value={code} onChange={setCode} />
          <label className="block text-sm">
            <span className="mb-1 block">Input (stdin)</span>
            <textarea
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              className="h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate()}
              className="min-h-11 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {run.isPending ? "Running…" : "Run"}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="min-h-11 rounded-md border border-border px-5 text-sm hover:bg-accent disabled:opacity-50"
            >
              {currentId ? "Save changes" : "Save program"}
            </button>
          </div>
          {run.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(run.error)}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(save.error)}
            </p>
          )}
          {run.data && (
            <section
              aria-live="polite"
              className="rounded-lg border border-border bg-card p-4 text-sm"
            >
              <div className="text-xs text-muted-foreground">
                Exit {run.data.exitCode === null ? "killed" : run.data.exitCode} · {run.data.timeMs}{" "}
                ms
                {run.data.signal ? ` · ${run.data.signal}` : ""}
              </div>
              {run.data.stdout && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words">
                  {run.data.stdout}
                </pre>
              )}
              {run.data.stderr && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words text-destructive">
                  {run.data.stderr}
                </pre>
              )}
            </section>
          )}
        </div>

        <aside className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg">Saved programs</h2>
          {programs.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {errorText(programs.error)}
            </p>
          )}
          {programs.data?.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">Nothing saved yet.</p>
          )}
          <ul className="mt-2 space-y-2">
            {programs.data?.map((program) => (
              <li key={program.id} className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 truncate text-left underline"
                  onClick={() => {
                    setCurrentId(program.id);
                    setTitle(program.title);
                    setLanguage(program.language);
                    setCode(program.code);
                    setStdin(program.stdin);
                  }}
                >
                  {program.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${program.title}`}
                  onClick={() => remove.mutate(program.id)}
                  className="min-h-9 rounded-md border border-border px-2 text-xs hover:bg-accent"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </AppShell>
  );
}
