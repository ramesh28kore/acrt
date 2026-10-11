import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  addMonths,
  currentDay,
  dayForDate,
  monthGrid,
  nextLearningItem,
  startOfMonth,
} from "@/lib/schedule/plan";
import { KIND_LABEL, type SchedulePlan } from "@/lib/schedule/types";

export function ScheduleView({ plan, today }: { plan: SchedulePlan; today: string }) {
  const initial = currentDay(plan, today)?.date ?? plan.startDate;
  const [selected, setSelected] = useState(initial);
  const [month, setMonth] = useState(startOfMonth(initial));
  const day = dayForDate(plan, selected);
  const next = nextLearningItem(plan);
  const index = Math.max(
    0,
    plan.days.findIndex((d) => d.date >= selected),
  );
  const strip = plan.days.slice(Math.max(0, index - 3), Math.max(0, index - 3) + 7);
  const choose = (date: string) => {
    setSelected(date);
    setMonth(startOfMonth(date));
  };
  const heading = new Date(month + "T00:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  let minutes = 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5">
        <div>
          <p className="font-semibold">Your course began {plan.startDate}</p>
          <p className="text-sm text-muted-foreground">
            {plan.completedItems} of {plan.totalItems} items complete · {plan.days.length} study
            days
          </p>
        </div>
        {next ? (
          <Link
            to={next.href}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Continue learning: {next.title}
          </Link>
        ) : (
          <p>
            {plan.totalItems
              ? "All scheduled work is complete."
              : "No published curriculum is available yet."}
          </p>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <section className="rounded-lg border bg-card p-5" aria-label="Monthly calendar">
          <div className="flex items-center justify-between">
            <button
              aria-label="Previous month"
              className="rounded border px-3 py-2"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              ←
            </button>
            <h2 className="font-semibold" aria-live="polite">
              {heading}
            </h2>
            <button
              aria-label="Next month"
              className="rounded border px-3 py-2"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              →
            </button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span key={d}>{d}</span>
            ))}
            {monthGrid(month).map((cell) => {
              const entry = dayForDate(plan, cell.date);
              return (
                <button
                  key={cell.date}
                  aria-label={`${cell.date}${entry ? `, study day ${entry.dayNumber}${entry.complete ? ", complete" : ""}` : ", no scheduled work"}`}
                  aria-pressed={selected === cell.date}
                  onClick={() => choose(cell.date)}
                  className={`min-h-10 rounded border p-1 ${selected === cell.date ? "bg-primary text-primary-foreground" : entry?.complete ? "bg-emerald-50 text-emerald-800" : entry ? "bg-accent" : ""} ${cell.inMonth ? "" : "opacity-40"}`}
                >
                  <span>{Number(cell.date.slice(-2))}</span>
                  {entry && (
                    <span className="block text-[9px]">
                      {entry.complete ? "✓" : `D${entry.dayNumber}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button className="mt-4 text-sm underline" onClick={() => choose(today)}>
            Today · {today}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            Course dates use the portal’s UTC calendar. Rest days have no scheduled work.
          </p>
        </section>
        <section className="rounded-lg border bg-card p-5" aria-label="Day timeline">
          <label className="text-sm">
            Go to study day
            <select
              className="ml-3 rounded border p-2"
              value={day?.date ?? ""}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="" disabled>
                Select a study day
              </option>
              {plan.days.map((d) => (
                <option key={d.date} value={d.date}>
                  Day {d.dayNumber} · {d.date}
                </option>
              ))}
            </select>
          </label>
          <nav className="mt-4 flex flex-wrap gap-2" aria-label="Study day strip">
            {strip.map((d) => (
              <button
                className={`rounded border px-3 py-2 text-sm ${selected === d.date ? "bg-accent font-semibold" : ""}`}
                key={d.date}
                aria-pressed={selected === d.date}
                onClick={() => choose(d.date)}
              >
                Day {d.dayNumber}
                {d.complete ? " ✓" : ""}
              </button>
            ))}
          </nav>
          <h2 className="mt-5 text-xl font-semibold">
            {selected}
            {day ? ` · Day ${day.dayNumber}` : ""}
          </h2>
          {!day && (
            <p className="mt-4 text-sm text-muted-foreground">
              No work is scheduled on this date. Choose a study day or continue your next unfinished
              item.
            </p>
          )}
          <ol className="mt-5 space-y-3">
            {day?.items.map((item) => {
              const from = minutes;
              minutes += item.minutes;
              return (
                <li key={`${item.kind}:${item.id}`} className="border-l-2 border-primary pl-4">
                  <p className="text-xs text-muted-foreground">
                    {from}–{minutes} planned minutes · {KIND_LABEL[item.kind]}
                  </p>
                  <Link to={item.href} className="mt-1 block rounded border p-3 hover:bg-accent">
                    <span className="font-medium">{item.title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {item.topicName} · {item.completed ? "Complete" : "Not yet complete"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
