import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadIdentity } from "./identity";

export type Role = "student" | "faculty" | "admin" | "super_admin";

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  faculty: "Faculty",
  admin: "Admin",
  super_admin: "Super Admin",
};

export const ROLE_HOME: Record<Role, "/student" | "/faculty" | "/admin" | "/super-admin"> = {
  student: "/student",
  faculty: "/faculty",
  admin: "/admin",
  super_admin: "/super-admin",
};

export async function fetchMe() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const identity = await loadIdentity(supabase, u.user.id);
  return {
    user: u.user,
    profile: identity?.profile ?? null,
    roles: identity?.roles ?? [],
    primary: identity?.primary ?? null,
  };
}

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
