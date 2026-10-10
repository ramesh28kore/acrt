import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminUserFiltersSchema,
  adminActivityFiltersSchema,
  adminCreateUserSchema,
  adminEditUserSchema,
} from "./admin.contracts";

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const service = await import("./admin.server");
    await service.assertInstituteAdmin(context.supabase, context.userId);
    return service.getOverview(context.supabase);
  });
export const adminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => adminUserFiltersSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./admin.server");
    await service.assertInstituteAdmin(context.supabase, context.userId);
    return service.getUsers(context.supabase, data);
  });
export const adminActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => adminActivityFiltersSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./admin.server");
    await service.assertInstituteAdmin(context.supabase, context.userId);
    return service.getActivity(context.supabase, data);
  });
export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => adminEditUserSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./admin.server");
    await service.assertInstituteAdmin(context.supabase, context.userId);
    return service.updateUser(context.userId, data);
  });
export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => adminCreateUserSchema.parse(data))
  .handler(async ({ context, data }) => {
    const service = await import("./admin.server");
    await service.assertInstituteAdmin(context.supabase, context.userId);
    return service.createAccount(context.userId, data);
  });
