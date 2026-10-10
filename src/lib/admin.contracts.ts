import { z } from "zod";
import {
  createAccountSchema,
  editUserSchema,
  userFiltersSchema,
  activityFiltersSchema,
  type ManagedUser,
} from "./super-admin.contracts";

export const managedRoleSchema = z.enum(["student", "faculty"]);
export type ManagedRole = z.infer<typeof managedRoleSchema>;
export const adminUserFiltersSchema = userFiltersSchema.omit({ instituteId: true }).strict();
export const adminActivityFiltersSchema = activityFiltersSchema
  .omit({ instituteId: true })
  .strict();
export const adminEditUserSchema = editUserSchema
  .omit({ institute_id: true })
  .extend({ role: managedRoleSchema })
  .strict();
export const adminCreateUserSchema = createAccountSchema
  .omit({ institute_id: true })
  .extend({ role: managedRoleSchema })
  .strict();
export const adminOverviewSchema = z.object({
  institute: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  total: z.number(),
  active: z.number(),
  disabled: z.number(),
  unassigned: z.number(),
  roles: z.record(z.string(), z.number()),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminUserFilters = z.infer<typeof adminUserFiltersSchema>;
export type AdminActivityFilters = z.infer<typeof adminActivityFiltersSchema>;
export type AdminEditUser = z.infer<typeof adminEditUserSchema>;
export type AdminCreateUser = z.infer<typeof adminCreateUserSchema>;
export function canManageUser(user: ManagedUser) {
  return !user.roles.some((role) => role === "admin" || role === "super_admin");
}
