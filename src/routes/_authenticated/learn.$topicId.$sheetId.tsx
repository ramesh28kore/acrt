import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { errorText } from "@/lib/learning/error-text";
import { SheetContent } from "@/components/learning/SheetContent";
import { learningProgress, learningSheet } from "@/lib/learning/learning.functions";
import { roleGuard } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/learn/$topicId/$sheetId")({
  beforeLoad: roleGuard(["student", "faculty", "admin", "super_admin"]),
  head: () => ({ meta: [{ title: "Cheat sheet — Avanthi CRT Portal" }] }),
  component: SheetPage,
});

function SheetPage() {
  const { topicId, sheetId } = Route.useParams();
  const queryClient = useQueryClient();
  const sheet = useQuery({
    queryKey: ["learning", "sheet", topicId, sheetId],
    queryFn: () => learningSheet({ data: { topicId, sheetId } }),
    retry: false,
  });

  const progress = useMutation({
    mutationFn: (status: "in_progress" | "completed") =>
      learningProgress({ data: { topicId, sheetId, status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learning"] }),
  });

  const data = sheet.data;
  const startedFor =
    data && !data.staff && data.sheet.status === "not_started" ? data.sheet.id : null;
  const { mutate } = progress;
  useEffect(() => {
    if (startedFor) mutate("in_progress");
  }, [startedFor, mutate]);

  return (
    <AppShell title={data?.sheet.title ?? "Cheat sheet"}>
      <Link
        to="/learn/$topicId"
        params={{ topicId }}
        className="text-sm text-muted-foreground underline"
      >
        {data ? data.topic.name : "Back to topic"}
      </Link>

      {sheet.isPending && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {sheet.isError && (
        <p role="alert" className="mt-4 rounded-lg border border-border bg-card p-5 text-sm">
          {errorText(sheet.error)}
        </p>
      )}

      {data && (
        <article className="mt-4 rounded-lg border border-border bg-card p-4 sm:p-6">
          {!data.sheet.isPublished && (
            <p className="mb-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              Draft: students cannot see this lesson until it is published.
            </p>
          )}
          {data.sheet.droppedBlocks > 0 && (
            <p role="status" className="mb-4 text-xs text-muted-foreground">
              {data.sheet.droppedBlocks} content block(s) could not be displayed.
            </p>
          )}
          {data.sheet.blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">This lesson has no content yet.</p>
          ) : (
            <SheetContent blocks={data.sheet.blocks} />
          )}

          {data.sheet.pdfUrl && (
            <a
              href={data.sheet.pdfUrl}
              rel="noopener noreferrer"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm hover:bg-accent"
            >
              <Download className="h-4 w-4" aria-hidden /> Download PDF
            </a>
          )}

          {!data.staff && (
            <div className="mt-8 border-t border-border pt-4">
              {data.sheet.status === "completed" ? (
                <p className="text-sm text-muted-foreground">You have completed this lesson.</p>
              ) : (
                <button
                  type="button"
                  disabled={progress.isPending}
                  onClick={() => progress.mutate("completed")}
                  className="min-h-11 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"
                >
                  Mark as complete
                </button>
              )}
              {progress.isError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {errorText(progress.error)}
                </p>
              )}
            </div>
          )}
        </article>
      )}

      {data && (
        <nav aria-label="Lesson navigation" className="mt-6 grid gap-3 sm:grid-cols-2">
          {data.previous ? (
            <Link
              to="/learn/$topicId/$sheetId"
              params={{ topicId, sheetId: data.previous.id }}
              className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Previous: {data.previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {data.next &&
            (data.next.locked ? (
              <span className="flex min-h-11 items-center justify-end gap-2 rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground">
                Complete this lesson to unlock the next one
              </span>
            ) : (
              <Link
                to="/learn/$topicId/$sheetId"
                params={{ topicId, sheetId: data.next.id }}
                className="flex min-h-11 items-center justify-end gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
              >
                <span className="truncate">Next: {data.next.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
              </Link>
            ))}
        </nav>
      )}
    </AppShell>
  );
}
