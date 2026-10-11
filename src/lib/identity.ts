import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./me";

// Columns of the running backend's public.profiles that identity decisions depend on.
export type LiveProfile = {
  id: string;
  role: string | null;
  full_name: string | null;
  email: string | null;
  roll_number: string | null;
  institute_id: string | null;
  is_super_admin: boolean | null;
  is_disabled: boolean | null;
  disabled_at: string | null;
};

export type Identity = {
  profile: LiveProfile & {
    is_active: boolean;
    institutes: { code: string; name: string } | null;
  };
  roles: Role[];
  primary: Role | null;
  active: boolean;
};

const BASE_ROLES: readonly string[] = ["student", "faculty", "admin"];

// Mirrors the backend's is_super_admin(): an active admin row that carries the flag.
export function rolesFromProfile(profile: LiveProfile): Role[] {
  if (profile.is_disabled !== false) return [];
  if (!profile.role || !BASE_ROLES.includes(profile.role)) return [];
  const roles = [profile.role as Role];
  if (profile.role === "admin" && profile.is_super_admin === true) roles.unshift("super_admin");
  return roles;
}

export async function loadIdentity(
  client: SupabaseClient<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
): Promise<Identity | null> {
  const found = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (found.error) throw new Error("Could not load your account. Please refresh and try again.");
  const row = found.data as LiveProfile | null;
  if (!row) return null;

  let institute: { code: string; name: string } | null = null;
  if (row.institute_id) {
    // Display only; a failed lookup must not change the access decision.
    const lookup = await client
      .from("institutes")
      .select("code,name")
      .eq("id", row.institute_id)
      .maybeSingle();
    institute = (lookup.data as { code: string; name: string } | null) ?? null;
  }

  const roles = rolesFromProfile(row);
  return {
    profile: { ...row, is_active: row.is_disabled === false, institutes: institute },
    roles,
    primary: roles[0] ?? null,
    active: row.is_disabled === false,
  };
}
