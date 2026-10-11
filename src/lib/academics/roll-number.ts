// Roll number: YY + campus(2) + entry(2) + branch(2) + number(2), e.g. 25PT1A0501.
// Numbers above 99 continue as letter+digit pairs: A0 = 100, A1 = 101, B0 = 110.
export const ROLL_NUMBER_PATTERN = /^(\d{2})([A-Z0-9]{2})([A-Z0-9]{2})(\d{2})(\d{2}|[A-Z]\d)$/;

export const LATERAL_ENTRY_MODE = "5A";
export const REGULAR_SECTION_BAND = 60;
export const LATERAL_SECTION_BAND = 6;

export type ParsedRollNumber = {
  rollNumber: string;
  admissionYear: number;
  instituteCode: string;
  entryMode: string;
  branchRollCode: string;
  studentNumber: number;
  isLateralEntry: boolean;
};

// Spreadsheet cells often carry stray spaces or non-breaking spaces.
export function normaliseRollNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[\s\u00a0]+/g, "").toUpperCase();
  return cleaned === "" ? null : cleaned;
}

export function studentNumberOf(field: string): number | null {
  if (/^\d{2}$/.test(field)) return Number(field);
  const match = /^([A-Z])(\d)$/.exec(field);
  if (!match) return null;
  const [, letter = "", digit = ""] = match;
  return 100 + (letter.charCodeAt(0) - 65) * 10 + Number(digit);
}

// Returns null instead of throwing so a bulk import can report every bad row.
export function parseRollNumber(input: unknown): ParsedRollNumber | null {
  const rollNumber = normaliseRollNumber(input);
  if (!rollNumber) return null;
  const match = ROLL_NUMBER_PATTERN.exec(rollNumber);
  if (!match) return null;
  const [, yy = "", instituteCode = "", entryMode = "", branchRollCode = "", numberField = ""] =
    match;
  const studentNumber = studentNumberOf(numberField);
  if (studentNumber === null || studentNumber < 1) return null;
  return {
    rollNumber,
    admissionYear: 2000 + Number(yy),
    instituteCode,
    entryMode,
    branchRollCode,
    studentNumber,
    isLateralEntry: entryMode === LATERAL_ENTRY_MODE,
  };
}

// sessionStartYear is the calendar year the session begins, e.g. 2026 for 2026-27.
export function studyYearFor(
  admissionYear: number,
  sessionStartYear: number,
  isLateralEntry: boolean,
): number | null {
  const year = sessionStartYear - admissionYear + (isLateralEntry ? 2 : 1);
  return year >= 1 && year <= 4 ? year : null;
}

export function sessionStartYearOf(startDate: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(startDate);
  return match ? Number(match[1]) : null;
}

// Zero-based section index; a number past the last section joins the last one.
export function sectionIndexFor(
  studentNumber: number,
  isLateralEntry: boolean,
  sectionCount: number,
): number | null {
  if (sectionCount < 1 || studentNumber < 1) return null;
  const band = isLateralEntry ? LATERAL_SECTION_BAND : REGULAR_SECTION_BAND;
  return Math.min(Math.ceil(studentNumber / band) - 1, sectionCount - 1);
}

export function classNameFor(
  instituteCode: string | null,
  year: number,
  branchCode: string,
  sectionName: string,
): string {
  const numerals = ["I", "II", "III", "IV"];
  const tail = `${numerals[year - 1] ?? String(year)}-${branchCode}-${sectionName}`;
  return instituteCode ? `${instituteCode}-${tail}` : tail;
}
