import {
  parseRollNumber,
  normaliseRollNumber,
  sectionIndexFor,
  sessionStartYearOf,
  studyYearFor,
} from "./roll-number";

export type ImportRow = { rowNumber: number; rollNumber: unknown; fullName?: unknown };

export type ImportContext = {
  institutes: { id: string; code: string }[];
  branches: { id: string; roll_code: string | null }[];
  sections: {
    id: string;
    institute_id: string | null;
    branch_id: string;
    year: number;
    name: string;
  }[];
  activeSessionStart: string | null;
  // Existing students keyed by upper-case roll number.
  existingByRoll: ReadonlyMap<string, { id: string; institute_id: string | null }>;
  // null means a platform-wide actor; otherwise rows must stay inside this institute.
  actorInstituteId: string | null;
  onMissingSection: "reject" | "unassigned";
};

export type ImportErrorCode =
  | "invalid_roll"
  | "duplicate_in_file"
  | "unknown_institute"
  | "unknown_branch"
  | "no_active_session"
  | "year_out_of_range"
  | "no_section"
  | "outside_actor_institute"
  | "institute_conflict"
  | "invalid_name";

export type ImportPlacement = {
  rowNumber: number;
  rollNumber: string;
  fullName: string;
  instituteId: string;
  branchId: string;
  year: number;
  sectionId: string | null;
  action: "create" | "update_placement";
  existingId: string | null;
};

export type ImportPlan = {
  placements: ImportPlacement[];
  errors: { rowNumber: number; rollNumber: string; code: ImportErrorCode; message: string }[];
  unassigned: number;
  // Nothing may be written unless every row validated.
  canApply: boolean;
};

const MESSAGES: Record<ImportErrorCode, string> = {
  invalid_roll: "Roll number is not in the expected format.",
  duplicate_in_file: "Roll number appears more than once in this file.",
  unknown_institute: "The campus code in this roll number is not a known institute.",
  unknown_branch: "The branch code in this roll number is not a known branch.",
  no_active_session: "No active academic year is set, so the study year cannot be derived.",
  year_out_of_range: "This intake is not in any current year of study.",
  no_section: "No section exists for this campus, year and branch.",
  outside_actor_institute: "This student belongs to a different institute than you manage.",
  institute_conflict: "This roll number is already registered to a different institute.",
  invalid_name: "Full name is missing or longer than 120 characters.",
};

export function planBulkImport(rows: readonly ImportRow[], ctx: ImportContext): ImportPlan {
  const placements: ImportPlacement[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Set<string>();
  const sessionStart = ctx.activeSessionStart ? sessionStartYearOf(ctx.activeSessionStart) : null;
  const instituteByCode = new Map(ctx.institutes.map((i) => [i.code.toUpperCase(), i]));
  const branchByRoll = new Map(
    ctx.branches.filter((b) => b.roll_code).map((b) => [b.roll_code as string, b]),
  );
  let unassigned = 0;

  for (const row of rows) {
    const raw = normaliseRollNumber(row.rollNumber) ?? "";
    const fail = (code: ImportErrorCode) =>
      errors.push({ rowNumber: row.rowNumber, rollNumber: raw, code, message: MESSAGES[code] });

    const parsed = parseRollNumber(row.rollNumber);
    if (!parsed) {
      fail("invalid_roll");
      continue;
    }
    if (seen.has(parsed.rollNumber)) {
      fail("duplicate_in_file");
      continue;
    }
    seen.add(parsed.rollNumber);

    const fullName = typeof row.fullName === "string" ? row.fullName.trim() : "";
    if (fullName.length === 0 || fullName.length > 120) {
      fail("invalid_name");
      continue;
    }
    const institute = instituteByCode.get(parsed.instituteCode);
    if (!institute) {
      fail("unknown_institute");
      continue;
    }
    if (ctx.actorInstituteId !== null && institute.id !== ctx.actorInstituteId) {
      fail("outside_actor_institute");
      continue;
    }
    const branch = branchByRoll.get(parsed.branchRollCode);
    if (!branch) {
      fail("unknown_branch");
      continue;
    }
    if (sessionStart === null) {
      fail("no_active_session");
      continue;
    }
    const year = studyYearFor(parsed.admissionYear, sessionStart, parsed.isLateralEntry);
    if (year === null) {
      fail("year_out_of_range");
      continue;
    }

    const existing = ctx.existingByRoll.get(parsed.rollNumber) ?? null;
    if (existing && existing.institute_id && existing.institute_id !== institute.id) {
      fail("institute_conflict");
      continue;
    }

    const candidates = ctx.sections
      .filter(
        (s) => s.institute_id === institute.id && s.branch_id === branch.id && s.year === year,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const index = sectionIndexFor(parsed.studentNumber, parsed.isLateralEntry, candidates.length);
    const section = index === null ? null : (candidates[index] ?? null);
    if (!section && ctx.onMissingSection === "reject") {
      fail("no_section");
      continue;
    }
    if (!section) unassigned += 1;

    placements.push({
      rowNumber: row.rowNumber,
      rollNumber: parsed.rollNumber,
      fullName,
      instituteId: institute.id,
      branchId: branch.id,
      year,
      sectionId: section?.id ?? null,
      action: existing ? "update_placement" : "create",
      existingId: existing?.id ?? null,
    });
  }

  return { placements, errors, unassigned, canApply: errors.length === 0 && placements.length > 0 };
}
