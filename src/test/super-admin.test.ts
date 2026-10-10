import { describe, expect, it } from "vitest";
import {
  activityCsv,
  createAccountSchema,
  csvCell,
  instituteFieldsSchema,
  userFiltersSchema,
} from "@/lib/super-admin.contracts";

describe("super admin inputs and exports", () => {
  it("rejects weak initial passwords and unsupported roles", () => {
    const input = {
      full_name: "Test User",
      email: "TEST@EXAMPLE.COM",
      password: "short",
      roll_number: "",
      role: "student",
      institute_id: null,
      is_active: true,
    };
    expect(createAccountSchema.safeParse(input).success).toBe(false);
    expect(
      createAccountSchema.safeParse({ ...input, password: "Strong!Password123", role: "owner" })
        .success,
    ).toBe(false);
    expect(createAccountSchema.parse({ ...input, password: "Strong!Password123" }).email).toBe(
      "test@example.com",
    );
  });
  it("bounds pagination and normalizes institute codes", () => {
    expect(userFiltersSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(userFiltersSchema.safeParse({ search: "x".repeat(121) }).success).toBe(false);
    expect(instituteFieldsSchema.parse({ id: null, code: " pt ", name: "Campus" }).code).toBe("PT");
  });
  it("neutralizes spreadsheet formulas and escapes CSV cells", () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell(" +123")).toBe('"\' +123"');
    expect(csvCell('A, "B"')).toBe('"A, ""B"""');
  });
  it("exports separate UTC date and time columns without hidden audit details", () => {
    const output = activityCsv([
      {
        id: "1",
        action: "role_changed",
        actor_name: "=cmd",
        actor_email: "owner@example.com",
        actor_roles: ["super_admin"],
        target_name: "Student",
        institute_code: "PT",
        created_at: "2026-10-09T14:00:00Z",
        details: { internal: "not exported" },
      },
    ]);
    expect(output).toContain('"2026-10-09","14:00:00"');
    expect(output).toContain('"\'=cmd"');
    expect(output).not.toContain("not exported");
  });
});
