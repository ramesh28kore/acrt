import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Role } from "@/lib/me";
import {
  overviewSchema,
  userPageSchema,
  activityPageSchema,
  type UserFilters,
  type ActivityFilters,
  type EditUser,
  type CreateAccount,
  type InstituteFields,
} from "./super-admin.contracts";

type DashboardDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      super_admin_overview: { Args: Record<string, never>; Returns: Json };
      super_admin_users: {
        Args: {
          p_search: string;
          p_role: Role | null;
          p_institute_id: string | null;
          p_active: boolean | null;
          p_page: number;
        };
        Returns: Json;
      };
      super_admin_activity: {
        Args: {
          p_search: string;
          p_action: string;
          p_role: Role | null;
          p_institute_id: string | null;
          p_page: number;
        };
        Returns: Json;
      };
      super_admin_update_user: {
        Args: {
          p_user_id: string;
          p_full_name: string;
          p_roll_number: string;
          p_institute_id: string | null;
          p_role: Role;
          p_is_active: boolean;
        };
        Returns: undefined;
      };
      super_admin_save_institute: {
        Args: { p_id: string | null; p_code: string; p_name: string };
        Returns: string;
      };
    };
  };
};
type Client = SupabaseClient<Database>;
const dashboardClient = (client: Client) => client as unknown as SupabaseClient<DashboardDatabase>;

export async function assertSuperAdmin(client: Client, userId: string) {
  const [profile, roles] = await Promise.all([
    client.from("profiles").select("is_active").eq("id", userId).maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (profile.error || roles.error)
    throw new Error("Could not verify your permissions. Try again.");
  if (!profile.data?.is_active || !roles.data?.some((role) => role.role === "super_admin")) {
    throw new Error("An active super admin account is required.");
  }
}
function rpcError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new Error("That institute code is already in use.");
  if (error.code === "P0001" || error.code === "42501") throw new Error(error.message);
  console.error("Super admin database operation failed", error.code);
  throw new Error("The operation could not be completed. Refresh and try again.");
}
export async function getOverview(client: Client) {
  const { data, error } = await dashboardClient(client).rpc("super_admin_overview", {});
  rpcError(error);
  return overviewSchema.parse(data);
}
export async function getUsers(client: Client, filters: UserFilters) {
  const { data, error } = await dashboardClient(client).rpc("super_admin_users", {
    p_search: filters.search,
    p_role: filters.role,
    p_institute_id: filters.instituteId,
    p_active: filters.active,
    p_page: filters.page,
  });
  rpcError(error);
  return userPageSchema.parse(data);
}
export async function getActivity(client: Client, filters: ActivityFilters) {
  const { data, error } = await dashboardClient(client).rpc("super_admin_activity", {
    p_search: filters.search,
    p_action: filters.action,
    p_role: filters.role,
    p_institute_id: filters.instituteId,
    p_page: filters.page,
  });
  rpcError(error);
  return activityPageSchema.parse(data);
}
export async function updateUser(client: Client, input: EditUser) {
  const { error } = await dashboardClient(client).rpc("super_admin_update_user", {
    p_user_id: input.user_id,
    p_full_name: input.full_name,
    p_roll_number: input.roll_number,
    p_institute_id: input.institute_id,
    p_role: input.role,
    p_is_active: input.is_active,
  });
  rpcError(error);
  return { ok: true as const };
}
export async function createAccount(client: Client, input: CreateAccount) {
  if (input.role !== "super_admin" && !input.institute_id) throw new Error("Choose an institute.");
  if (input.institute_id) {
    const institute = await client
      .from("institutes")
      .select("id")
      .eq("id", input.institute_id)
      .maybeSingle();
    if (institute.error || !institute.data) throw new Error("Institute not found.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The profile trigger creates a disabled, unprivileged account until the RPC commits.
  const created = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists" || created.error?.message.includes("already")) {
      throw new Error("An account with this email already exists.");
    }
    throw new Error("Could not create the account. Check the email and password requirements.");
  }
  try {
    await updateUser(client, { ...input, user_id: created.data.user.id });
  } catch (error) {
    const cleanup = await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
    if (cleanup.error)
      throw new Error(
        "Account setup failed. The unconfigured account remains disabled; contact support.",
      );
    throw error;
  }
  return { id: created.data.user.id };
}
export async function saveInstitute(client: Client, input: InstituteFields) {
  const { data, error } = await dashboardClient(client).rpc("super_admin_save_institute", {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
  });
  rpcError(error);
  return { id: data };
}
