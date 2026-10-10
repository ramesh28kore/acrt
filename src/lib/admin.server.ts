import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Role } from "./me";
import { userPageSchema, activityPageSchema } from "./super-admin.contracts";
import {
  adminOverviewSchema,
  type AdminUserFilters,
  type AdminActivityFilters,
  type AdminEditUser,
  type AdminCreateUser,
} from "./admin.contracts";

type AdminDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      admin_dashboard_overview: { Args: Record<string, never>; Returns: Json };
      admin_dashboard_users: {
        Args: { p_search: string; p_role: Role | null; p_active: boolean | null; p_page: number };
        Returns: Json;
      };
      admin_dashboard_activity: {
        Args: { p_search: string; p_action: string; p_role: Role | null; p_page: number };
        Returns: Json;
      };
      admin_save_user: {
        Args: {
          p_actor_id: string;
          p_user_id: string;
          p_full_name: string;
          p_roll_number: string;
          p_role: "student" | "faculty";
          p_is_active: boolean;
          p_create: boolean;
        };
        Returns: undefined;
      };
    };
  };
};
type Client = SupabaseClient<Database>;
const adminClient = (client: Client) => client as unknown as SupabaseClient<AdminDatabase>;
export async function assertInstituteAdmin(client: Client, userId: string) {
  const [profile, roles] = await Promise.all([
    client.from("profiles").select("is_active,institute_id").eq("id", userId).maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (profile.error || roles.error)
    throw new Error("Could not verify your permissions. Try again.");
  if (!profile.data?.is_active || !roles.data?.some((entry) => entry.role === "admin"))
    throw new Error("An active admin account is required.");
  if (!profile.data.institute_id)
    throw new Error("Your admin account needs an institute. Contact the Super Admin.");
}
function rpcError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "P0001" || error.code === "42501") throw new Error(error.message);
  console.error("Admin database operation failed", error.code);
  throw new Error("The operation could not be completed. Refresh and try again.");
}
export async function getOverview(client: Client) {
  const { data, error } = await adminClient(client).rpc("admin_dashboard_overview", {});
  rpcError(error);
  return adminOverviewSchema.parse(data);
}
export async function getUsers(client: Client, filters: AdminUserFilters) {
  const { data, error } = await adminClient(client).rpc("admin_dashboard_users", {
    p_search: filters.search,
    p_role: filters.role,
    p_active: filters.active,
    p_page: filters.page,
  });
  rpcError(error);
  return userPageSchema.parse(data);
}
export async function getActivity(client: Client, filters: AdminActivityFilters) {
  const { data, error } = await adminClient(client).rpc("admin_dashboard_activity", {
    p_search: filters.search,
    p_role: filters.role,
    p_action: filters.action,
    p_page: filters.page,
  });
  rpcError(error);
  return activityPageSchema.parse(data);
}
export async function updateUser(actorId: string, input: AdminEditUser, create = false) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await adminClient(supabaseAdmin).rpc("admin_save_user", {
    p_actor_id: actorId,
    p_user_id: input.user_id,
    p_full_name: input.full_name,
    p_roll_number: input.roll_number,
    p_role: input.role,
    p_is_active: input.is_active,
    p_create: create,
  });
  rpcError(error);
  return { ok: true as const };
}
export async function createAccount(actorId: string, input: AdminCreateUser) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const created = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists" || created.error?.message.includes("already"))
      throw new Error("An account with this email already exists.");
    throw new Error("Could not create the account. Check the email and password requirements.");
  }
  try {
    await updateUser(actorId, { ...input, user_id: created.data.user.id }, true);
  } catch (error) {
    const cleanup = await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
    if (cleanup.error)
      throw new Error(
        "Account setup failed. The unconfigured account remains disabled; contact the Super Admin.",
      );
    throw error;
  }
  return { id: created.data.user.id };
}
