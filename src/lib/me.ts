import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*, institutes(code,name)").eq("id", u.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", u.user.id),
  ]);
  const roleList = (roles ?? []).map((r) => r.role as Role);
  const order: Role[] = ["super_admin", "admin", "faculty", "student"];
  const primary = order.find((r) => roleList.includes(r)) ?? null;
  return { user: u.user, profile, roles: roleList, primary };
}

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
