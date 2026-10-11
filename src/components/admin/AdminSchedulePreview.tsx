import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  scheduleAdmin,
  scheduleExport,
  schedulePreview,
  schedulePublish,
} from "@/lib/schedule/schedule.functions";
import { previewSchema, type PreviewInput } from "@/lib/schedule/contracts";
import { todayDate } from "@/lib/schedule/plan";
import type { scheduleAdministration } from "@/lib/schedule/schedule.server";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AdminSchedulePreview() {
  const query = useQuery({
    queryKey: ["schedule", "admin"],
    queryFn: () => scheduleAdmin(),
    retry: 1,
  });
  if (query.isPending) return <p role="status">Loading schedule settings…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  return <ScheduleEditor initial={query.data} />;
}
function ScheduleEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof scheduleAdministration>>;
}) {
  const cache = useQueryClient();
  const [input, setInput] = useState<PreviewInput>({
    ...initial.context.settings,
    startDate: initial.context.academicStart ?? todayDate(),
    includeDrafts: false,
    ...(initial.context.instituteId ? { instituteId: initial.context.instituteId } : {}),
  });
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof schedulePreview>> | null>(null);
  const [reviewedInput, setReviewedInput] = useState("");
  const change = (next: Partial<PreviewInput>) => {
    setInput((current) => ({ ...current, ...next }));
    setMessage("");
  };
  const prepare = useMutation({
    mutationFn: () => schedulePreview({ data: previewSchema.parse(input) }),
    onSuccess: (data) => {
      setPreview(data);
      setReviewedInput(JSON.stringify(input));
      setMessage("Preview ready. Review the dates and workload before publishing.");
    },
    onError: (error) => setMessage(error.message),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!preview || !preview.context.signature || reviewedInput !== JSON.stringify(input))
        throw new Error("Preview these settings before publishing.");
      return schedulePublish({
        data: {
          ...input,
          expectedVersion: preview.context.version,
          signature: preview.context.signature,
        },
      });
    },
    onSuccess: async (result) => {
      setPreview(null);
      setReviewedInput("");
      setMessage(
        "Schedule version " + result.version + " published. Completed activity is unchanged.",
      );
      await cache.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const download = useMutation({
    mutationFn: async (format: "xlsx" | "docx") => {
      if (!preview || reviewedInput !== JSON.stringify(input))
        throw new Error("Preview these settings before exporting.");
      if (!preview.context.signature)
        throw new Error("Preview the schedule again before exporting.");
      const file = await scheduleExport({
        data: {
          ...input,
          format,
          signature: preview.context.signature,
          expectedVersion: preview.context.version,
        },
      });
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error) => setMessage(error.message),
  });
  const current = preview && reviewedInput === JSON.stringify(input);
  const busy = prepare.isPending || publish.isPending || download.isPending;
  return (
    <section className="space-y-5" aria-label="Course schedule administration">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">Course schedule</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Preview a calendar, then publish settings for the selected institute. Students keep their
          own course-start dates and completed work. The preview start date does not change anyone’s
          enrollment.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label>
            Institute
            <select
              aria-label="Institute"
              className="mt-2 block w-full rounded border p-2"
              value={input.instituteId ?? ""}
              onChange={(e) => change({ instituteId: e.target.value })}
            >
              {initial.institutes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} — {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Preview start
            <input
              aria-label="Preview start"
              className="mt-2 block w-full rounded border p-2"
              type="date"
              value={input.startDate ?? ""}
              onChange={(e) => change({ startDate: e.target.value })}
            />
          </label>
          <label>
            Daily minutes
            <input
              aria-label="Daily minutes"
              className="mt-2 block w-full rounded border p-2"
              type="number"
              min={15}
              max={1440}
              value={input.dailyMinutes}
              onChange={(e) => change({ dailyMinutes: Number(e.target.value) })}
            />
          </label>
          <label>
            Curriculum order
            <select
              aria-label="Curriculum order"
              className="mt-2 block w-full rounded border p-2"
              value={input.order}
              onChange={(e) => change({ order: e.target.value as PreviewInput["order"] })}
            >
              <option value="topic-interleaved">Interleave within topics</option>
              <option value="topic-first">Complete each topic</option>
              <option value="stage-first">Sheets, quizzes, practice</option>
            </select>
          </label>
          <fieldset className="md:col-span-2">
            <legend>Rest days</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {weekdays.map((day, index) => (
                <label className="flex items-center gap-1 text-sm" key={day}>
                  <input
                    type="checkbox"
                    checked={input.restDays.includes(index)}
                    onChange={() =>
                      change({
                        restDays: input.restDays.includes(index)
                          ? input.restDays.filter((d) => d !== index)
                          : [...input.restDays, index].sort(),
                      })
                    }
                  />
                  {day.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={input.includeDrafts}
            onChange={(e) => change({ includeDrafts: e.target.checked })}
          />
          Include unpublished content in preview/export only
        </label>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => prepare.mutate()}
          >
            Preview schedule
          </button>
          <button
            className="rounded border px-4 py-2 disabled:opacity-50"
            disabled={busy || !current || !preview?.context.canConfigure || input.includeDrafts}
            onClick={() => publish.mutate()}
          >
            Publish reviewed settings
          </button>
          {(["xlsx", "docx"] as const).map((format) => (
            <button
              className="rounded border px-4 py-2 disabled:opacity-50"
              key={format}
              disabled={busy || !current || !preview?.context.canExport}
              onClick={() => download.mutate(format)}
            >
              Download {format === "xlsx" ? "Excel" : "Word"}
            </button>
          ))}
        </div>
        {message && (
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
        )}
      </div>
      {preview && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="font-semibold">
            {current ? "Reviewed preview" : "Previous preview — refresh after your changes"}
          </h3>
          <p className="mt-2 text-sm">
            {preview.plan.days.length} study days · {preview.plan.totalItems} items · current saved
            version {preview.context.version}
          </p>
          {!preview.context.canConfigure && (
            <p className="mt-2 text-sm">Your account cannot configure this institute’s schedule.</p>
          )}
          {preview.warnings.length > 0 && (
            <details className="mt-3 rounded border border-amber-300 p-3">
              <summary>Review {preview.warnings.length} curriculum notices</summary>
              <ul className="mt-2 list-disc pl-5">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4 max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Day / date</th>
                  <th className="p-2">Planned work</th>
                  <th className="p-2">Minutes</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.days.map((day) => (
                  <tr className="border-t" key={day.date}>
                    <td className="p-2 whitespace-nowrap">
                      {day.dayNumber} · {day.date}
                    </td>
                    <td className="p-2">{day.items.map((i) => i.title).join(" · ")}</td>
                    <td className="p-2">{day.minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
