import { describe, expect, it } from "vitest";
import { buildCurriculum } from "@/lib/schedule/curriculum";
import { addDays, buildPlan, monthGrid } from "@/lib/schedule/plan";
import type { ScheduleItem } from "@/lib/schedule/types";

const item = (id: string, topicId = "t1", minutes = 60): ScheduleItem => ({
  id,
  kind: "problem",
  title: id,
  topicId,
  topicName: topicId,
  subTopic: "practice",
  href: `/practice/${id}`,
  minutes,
  completed: false,
});

describe("schedule planner", () => {
  it("keeps student schedules date-relative and skips rest days", () => {
    const one = buildPlan([item("a"), item("b")], "2026-08-16", { restDays: [0] });
    const two = buildPlan([item("a"), item("b")], "2026-08-18", { restDays: [0] });
    expect(one.days.map((day) => day.items.map((entry) => entry.id))).toEqual(
      two.days.map((day) => day.items.map((entry) => entry.id)),
    );
    expect(one.days[0]!.date).toBe("2026-08-17");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("respects minute budgets without splitting an item", () => {
    const plan = buildPlan([item("a", "t1", 90), item("b", "t1", 90)], "2026-08-17", {
      dailyMinutes: 120,
      restDays: [],
    });
    expect(plan.days.map((day) => day.items.map((entry) => entry.id))).toEqual([["a"], ["b"]]);
  });

  it("handles calendar month transitions", () => {
    const grid = monthGrid("2026-08-20");
    expect(grid.find((cell) => cell.inMonth)?.date).toBe("2026-08-01");
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
  });
});

describe("curriculum references", () => {
  const source = {
    topics: [{ id: "t1", name: "Python", position: 1, isPublished: true }],
    sheets: [{ id: "s1", topicId: "t1", title: "Basics", position: 1, isPublished: true }],
    quizzes: [
      { id: "q1", topicId: "t1", name: "Recall", position: 1, questionCount: 5, isPublished: true },
    ],
    sets: [{ id: "set1", topicId: "t1", name: "Practice", position: 1, isPublished: true }],
    problems: [
      { id: "p1", topicId: "t1", setId: "set1", title: "Hello", position: 1 },
      { id: "p2", topicId: "t1", setId: "missing", title: "Orphan", position: 2 },
    ],
  };

  it("drops invalid references and reports them", () => {
    const result = buildCurriculum(source);
    expect(result.items.map((item) => item.id)).toEqual(["s1", "q1", "p1"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("does not expose unpublished curriculum to students", () => {
    const result = buildCurriculum({
      ...source,
      topics: [{ ...source.topics[0]!, isPublished: false }],
    });
    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
