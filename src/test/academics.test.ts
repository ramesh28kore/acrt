import { describe, expect, it } from "vitest";

import { planBulkImport, type ImportContext } from "@/lib/academics/bulk-import";
import {
  classNameFor,
  parseRollNumber,
  sectionIndexFor,
  studentNumberOf,
  studyYearFor,
} from "@/lib/academics/roll-number";

describe("roll number parsing", () => {
  it("maps PT and Q6 roll numbers to their campuses", () => {
    expect(parseRollNumber("25PT1A0501")).toMatchObject({
      instituteCode: "PT",
      admissionYear: 2025,
      branchRollCode: "05",
      studentNumber: 1,
      isLateralEntry: false,
    });
    expect(parseRollNumber("24Q61A0577")).toMatchObject({
      instituteCode: "Q6",
      entryMode: "1A",
      studentNumber: 77,
    });
  });

  it("normalises case and spreadsheet whitespace", () => {
    expect(parseRollNumber(" 25pt1a\u00a00501 ")?.rollNumber).toBe("25PT1A0501");
  });

  it("reads letter pairs as numbers above 99", () => {
    expect(studentNumberOf("A0")).toBe(100);
    expect(studentNumberOf("A1")).toBe(101);
    expect(studentNumberOf("B0")).toBe(110);
    expect(parseRollNumber("24Q61A05C5")?.studentNumber).toBe(125);
  });

  it("rejects malformed values without throwing", () => {
    for (const bad of [
      "",
      "   ",
      "25PT1A05",
      "25PT1A050001",
      "25PT1A0500",
      "25-PT-1A0501",
      null,
      42,
    ]) {
      expect(parseRollNumber(bad)).toBeNull();
    }
  });

  it("derives study year, including lateral entrants one year ahead", () => {
    expect(studyYearFor(2025, 2026, false)).toBe(2);
    expect(studyYearFor(2025, 2026, true)).toBe(3);
    expect(studyYearFor(2019, 2026, false)).toBeNull();
    expect(studyYearFor(2030, 2026, false)).toBeNull();
  });

  it("places regular students 60 per section and lateral entrants 6 per section", () => {
    expect(sectionIndexFor(1, false, 3)).toBe(0);
    expect(sectionIndexFor(61, false, 3)).toBe(1);
    expect(sectionIndexFor(500, false, 3)).toBe(2);
    expect(sectionIndexFor(7, true, 3)).toBe(1);
    expect(sectionIndexFor(1, false, 0)).toBeNull();
  });

  it("names classes with the campus prefix", () => {
    expect(classNameFor("Q6", 3, "CSE", "A")).toBe("Q6-III-CSE-A");
    expect(classNameFor(null, 2, "ECE", "B")).toBe("II-ECE-B");
  });
});

const ctx = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  institutes: [
    { id: "i-pt", code: "PT" },
    { id: "i-q6", code: "Q6" },
  ],
  branches: [{ id: "b-cse", roll_code: "05" }],
  sections: [
    { id: "s-pt-a", institute_id: "i-pt", branch_id: "b-cse", year: 2, name: "A" },
    { id: "s-pt-b", institute_id: "i-pt", branch_id: "b-cse", year: 2, name: "B" },
    { id: "s-q6-a", institute_id: "i-q6", branch_id: "b-cse", year: 2, name: "A" },
  ],
  activeSessionStart: "2026-06-15",
  existingByRoll: new Map(),
  actorInstituteId: null,
  onMissingSection: "reject",
  ...overrides,
});

const row = (rowNumber: number, rollNumber: unknown, fullName: unknown = "Student Name") => ({
  rowNumber,
  rollNumber,
  fullName,
});

describe("bulk import planning", () => {
  it("places students by campus, branch, year and number", () => {
    const plan = planBulkImport(
      [row(2, "25PT1A0501"), row(3, "25PT1A0561"), row(4, "25Q61A0501")],
      ctx(),
    );
    expect(plan.canApply).toBe(true);
    expect(plan.placements.map((p) => p.sectionId)).toEqual(["s-pt-a", "s-pt-b", "s-q6-a"]);
    expect(plan.placements.every((p) => p.action === "create" && p.year === 2)).toBe(true);
  });

  it("never silently duplicates a student", () => {
    const plan = planBulkImport([row(2, "25PT1A0501"), row(3, "25pt1a0501")], ctx());
    expect(plan.canApply).toBe(false);
    expect(plan.errors).toEqual([
      expect.objectContaining({ rowNumber: 3, code: "duplicate_in_file" }),
    ]);
  });

  it("turns an existing roll number into a placement update, not a second account", () => {
    const existing = new Map([["25PT1A0501", { id: "u1", institute_id: "i-pt" }]]);
    const plan = planBulkImport([row(2, "25PT1A0501")], ctx({ existingByRoll: existing }));
    expect(plan.placements[0]).toMatchObject({ action: "update_placement", existingId: "u1" });
  });

  it("refuses to move an existing student to another institute", () => {
    const existing = new Map([["25PT1A0501", { id: "u1", institute_id: "i-q6" }]]);
    const plan = planBulkImport([row(2, "25PT1A0501")], ctx({ existingByRoll: existing }));
    expect(plan.errors[0]?.code).toBe("institute_conflict");
    expect(plan.canApply).toBe(false);
  });

  it("keeps an institute admin inside their own institute", () => {
    const plan = planBulkImport(
      [row(2, "25PT1A0501"), row(3, "25Q61A0501")],
      ctx({ actorInstituteId: "i-pt" }),
    );
    expect(plan.errors).toEqual([
      expect.objectContaining({ rowNumber: 3, code: "outside_actor_institute" }),
    ]);
    expect(plan.canApply).toBe(false);
  });

  it("reports every invalid row so nothing is applied partially", () => {
    const plan = planBulkImport(
      [
        row(2, "bad"),
        row(3, "25XX1A0501"),
        row(4, "25PT1A9901"),
        row(5, "19PT1A0501"),
        row(6, "25PT1A0502", ""),
      ],
      ctx(),
    );
    expect(plan.errors.map((e) => e.code)).toEqual([
      "invalid_roll",
      "unknown_institute",
      "unknown_branch",
      "year_out_of_range",
      "invalid_name",
    ]);
    expect(plan.canApply).toBe(false);
  });

  it("handles a missing section explicitly: reject by default, unassigned on request", () => {
    const noSections = ctx({ sections: [] });
    expect(planBulkImport([row(2, "25PT1A0501")], noSections).errors[0]?.code).toBe("no_section");
    const plan = planBulkImport([row(2, "25PT1A0501")], {
      ...noSections,
      onMissingSection: "unassigned",
    });
    expect(plan.placements[0]?.sectionId).toBeNull();
    expect(plan.unassigned).toBe(1);
    expect(plan.canApply).toBe(true);
  });

  it("requires an active academic year", () => {
    const plan = planBulkImport([row(2, "25PT1A0501")], ctx({ activeSessionStart: null }));
    expect(plan.errors[0]?.code).toBe("no_active_session");
  });

  it("never applies an empty file", () => {
    expect(planBulkImport([], ctx()).canApply).toBe(false);
  });
});
