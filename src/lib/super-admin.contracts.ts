import { z } from "zod";

type AuditJson = string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };
const auditJsonSchema: z.ZodType<AuditJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(auditJsonSchema),
    z.record(z.string(), auditJsonSchema),
  ]),
);

export const roleSchema = z.enum(["student", "faculty", "admin", "super_admin"]);
export const userFiltersSchema = z.object({
  search: z.string().trim().max(120).default(""),
  role: roleSchema.nullable().default(null),
  instituteId: z.string().uuid().nullable().default(null),
  active: z.boolean().nullable().default(null),
  page: z.number().int().min(1).max(100000).default(1),
});
export const activityFiltersSchema = userFiltersSchema.omit({ active: true }).extend({
  action: z.string().max(60).default(""),
});
export const userFieldsSchema = z.object({
  full_name: z.string().trim().min(1, "Enter a name.").max(120),
  roll_number: z.string().trim().max(40).default(""),
  institute_id: z.string().uuid().nullable(),
  role: roleSchema,
  is_active: z.boolean(),
});
export const editUserSchema = userFieldsSchema.extend({ user_id: z.string().uuid() });
export const createAccountSchema = userFieldsSchema.extend({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(128)
    .regex(/[a-z]/, "Include a lowercase letter.")
    .regex(/[A-Z]/, "Include an uppercase letter.")
    .regex(/[0-9]/, "Include a number.")
    .regex(/[^A-Za-z0-9]/, "Include a symbol."),
});
export const instituteFieldsSchema = z.object({
  id: z.string().uuid().nullable(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, "Use 2–12 letters or numbers."),
  name: z.string().trim().min(1).max(160),
});

const instituteSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  users: z.number(),
  active: z.number(),
  students: z.number(),
  faculty: z.number(),
  admins: z.number(),
});
export const overviewSchema = z.object({
  total: z.number(),
  active: z.number(),
  disabled: z.number(),
  unassigned: z.number(),
  roles: z.record(z.string(), z.number()),
  institutes: z.array(instituteSchema),
});
export const managedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string(),
  roll_number: z.string().nullable(),
  institute_id: z.string().nullable(),
  institute_code: z.string().nullable(),
  institute_name: z.string().nullable(),
  is_active: z.boolean(),
  disabled_at: z.string().nullable(),
  created_at: z.string(),
  roles: z.array(roleSchema),
});
export const userPageSchema = z.object({ total: z.number(), items: z.array(managedUserSchema) });
export const activitySchema = z.object({
  id: z.string(),
  action: z.string(),
  actor_name: z.string(),
  actor_email: z.string().nullable(),
  actor_roles: z.array(roleSchema),
  target_name: z.string().nullable(),
  institute_code: z.string().nullable(),
  created_at: z.string(),
  details: z.record(z.string(), auditJsonSchema),
});
export const activityPageSchema = z.object({ total: z.number(), items: z.array(activitySchema) });
export type Overview = z.infer<typeof overviewSchema>;
export type Institute = z.infer<typeof instituteSchema>;
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type UserFilters = z.infer<typeof userFiltersSchema>;
export type ActivityFilters = z.infer<typeof activityFiltersSchema>;
export type EditUser = z.infer<typeof editUserSchema>;
export type CreateAccount = z.infer<typeof createAccountSchema>;
export type InstituteFields = z.infer<typeof instituteFieldsSchema>;

export const ACTION_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  user_created: "User created",
  user_updated: "User updated",
  role_changed: "Role changed",
  user_activated: "Access enabled",
  user_deactivated: "Access disabled",
  institute_created: "Institute created",
  institute_updated: "Institute updated",
};

// Prevent spreadsheet formulas when exporting user-controlled names or emails.
export function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function activityCsv(rows: Activity[]) {
  const content = [
    ["Date (UTC)", "Time (UTC)", "Actor", "Email", "Role", "Action", "Target", "Institute"],
    ...rows.map((row) => {
      const date = new Date(row.created_at).toISOString();
      return [
        date.slice(0, 10),
        date.slice(11, 19),
        row.actor_name,
        row.actor_email ?? "",
        row.actor_roles.join(", "),
        ACTION_LABELS[row.action] ?? row.action,
        row.target_name ?? "",
        row.institute_code ?? "",
      ];
    }),
  ];
  return content.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
