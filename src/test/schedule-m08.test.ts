import { describe, expect, it } from "vitest";
import {
  buildPlan,
  addMonths,
  monthGrid,
  parseDate,
  todayDate,
  nextLearningItem,
} from "@/lib/schedule/plan";
import { buildCurriculum, type CurriculumSource } from "@/lib/schedule/curriculum";
import { settingsSchema } from "@/lib/schedule/contracts";
import {
  documentBytes,
  workbookBytes,
  SHEET_NAMES,
  workbookRows,
} from "@/lib/schedule/office-export";
import type { ScheduleItem } from "@/lib/schedule/types";
const item = (id: string, minutes = 60): ScheduleItem => ({
  id,
  kind: "sheet",
  title: id,
  topicId: "t",
  topicName: "Python",
  subTopic: "Basics",
  href: "/learn/t/" + id,
  minutes,
  completed: false,
});
const source: CurriculumSource = {
  topics: [{ id: "t", name: "Python", position: 1, isPublished: true }],
  sheets: [{ id: "s", topicId: "t", title: "Read", position: 1, isPublished: true }],
  quizzes: [],
  sets: [
    { id: "a", topicId: "t", name: "First", position: 1, isPublished: true },
    { id: "b", topicId: "t", name: "Second", position: 2, isPublished: true },
  ],
  problems: [
    { id: "p2", topicId: "t", setId: "b", title: "Second", position: 1 },
    { id: "p1", topicId: "t", setId: "a", title: "First", position: 3 },
  ],
};
describe("M08 scheduling regressions", () => {
  it("rejects impossible dates and all-rest calendars", () => {
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() =>
      buildPlan([item("a")], "2026-08-15", { restDays: [0, 1, 2, 3, 4, 5, 6] }),
    ).toThrow();
    expect(() => buildPlan([item("a")], "2026-08-15", { restDays: [9] })).toThrow();
    expect(() =>
      settingsSchema.parse({ dailyMinutes: 120, restDays: [0, 0], order: "topic-first" }),
    ).toThrow();
  });
  it("shifts two students independently without modifying completed activity", () => {
    const items = [{ ...item("done"), completed: true }, item("next"), item("last")];
    const a = buildPlan(items, "2026-08-15", { dailyMinutes: 60 });
    const b = buildPlan(items, "2026-08-20", { dailyMinutes: 120 });
    expect(a.days.map((d) => d.date)).toEqual(["2026-08-15", "2026-08-17", "2026-08-18"]);
    expect(b.days.map((d) => d.date)).toEqual(["2026-08-20", "2026-08-21"]);
    expect(a.completedItems).toBe(1);
    expect(b.completedItems).toBe(1);
    expect(nextLearningItem(b)?.id).toBe("next");
    expect(items[0]?.completed).toBe(true);
    expect(items).toHaveLength(3);
  });
  it("never duplicates/splits an oversized item and checks invalid allocations", () => {
    expect(
      buildPlan([item("a", 180), item("b", 15)], "2026-08-15").days.map((d) => d.minutes),
    ).toEqual([180, 15]);
    expect(() => buildPlan([item("a"), item("a")], "2026-08-15")).toThrow(/duplicate/);
    expect(() => buildPlan([item("a", 0)], "2026-08-15")).toThrow();
  });
  it("keeps UTC course dates stable across offsets and year/month transitions", () => {
    expect(todayDate(new Date("2026-08-16T02:00:00+05:30"))).toBe("2026-08-15");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthGrid("2028-02-01").filter((c) => c.inMonth)).toHaveLength(29);
  });
  it("omits draft sheets and preserves set-first coding order", () => {
    const built = buildCurriculum({
      ...source,
      sheets: [{ ...source.sheets[0]!, isPublished: false }],
    });
    expect(built.items.map((i) => i.id)).toEqual(["p1", "p2"]);
    expect(buildCurriculum(source).items.map((i) => i.id)).toEqual(["s", "p1", "p2"]);
  });
  it("rejects duplicate sources and reports broken references", () => {
    expect(() =>
      buildCurriculum({ ...source, sheets: [source.sheets[0]!, source.sheets[0]!] }),
    ).toThrow(/duplicate/);
    const built = buildCurriculum({
      ...source,
      problems: [{ ...source.problems[0]!, setId: "deleted" }],
    });
    expect(built.warnings[0]).toContain("missing");
    expect(built.items.map((i) => i.id)).toEqual(["s"]);
  });
});

// Independently parse local ZIP records and Office XML, rather than trusting the writer's row builder.
function unzip(bytes: Uint8Array) {
  const files = new Map<string, string>(),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true),
      nameSize = view.getUint16(offset + 26, true),
      extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extra;
    files.set(name, new TextDecoder().decode(bytes.slice(start, start + size)));
    offset = start + size;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  for (const text of files.values())
    expect(
      new DOMParser().parseFromString(text, "application/xml").querySelector("parsererror"),
    ).toBeNull();
  return files;
}
describe("M08 Office exports", () => {
  const plan = buildPlan(
    [{ ...item("=SUM(A1)&<unsafe>"), title: "=SUM(A1)&<unsafe>" }],
    "2026-08-15",
  );
  it("creates five valid worksheets with safe text cells and matching dates", () => {
    const files = unzip(workbookBytes(plan, { drafts: false, version: 2 }));
    const book = new DOMParser().parseFromString(files.get("xl/workbook.xml")!, "application/xml");
    expect([...book.getElementsByTagName("sheet")].map((s) => s.getAttribute("name"))).toEqual(
      SHEET_NAMES,
    );
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("2026-08-15");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("=SUM(A1)&amp;&lt;unsafe&gt;");
    expect(workbookRows(plan, { drafts: false, version: 2 })[0]).toHaveLength(2);
  });
  it("creates a valid Word package with the same day plan and draft marker", () => {
    const files = unzip(documentBytes(plan, { drafts: true, version: 2 }));
    const document = files.get("word/document.xml")!;
    expect(document).toContain("DRAFT PREVIEW");
    expect(document).toContain("2026-08-15");
    expect(document).toContain("&amp;&lt;unsafe&gt;");
    expect(files.get("_rels/.rels")).toContain("word/document.xml");
  });
});
