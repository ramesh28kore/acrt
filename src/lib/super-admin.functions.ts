import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  userFiltersSchema,
  activityFiltersSchema,
  editUserSchema,
  createAccountSchema,
  instituteFieldsSchema,
} from "./super-admin.contracts";

export const dashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.getOverview(context.supabase);
  });
export const dashboardUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => userFiltersSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.getUsers(context.supabase, data);
  });
export const dashboardActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => activityFiltersSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.getActivity(context.supabase, data);
  });
export const dashboardUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => editUserSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.updateUser(context.supabase, data);
  });
export const dashboardCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => createAccountSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.createAccount(context.supabase, data);
  });
export const dashboardSaveInstitute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => instituteFieldsSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./super-admin.server");
    await service.assertSuperAdmin(context.supabase, context.userId);
    return service.saveInstitute(context.supabase, data);
  });
