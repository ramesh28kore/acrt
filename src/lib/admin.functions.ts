import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPER_ADMIN_EMAIL = "ramesh2kore@gmail.com";
type Role = "student" | "faculty" | "admin" | "super_admin";

type AuthedSupabase = {
  from: (t: string) => any;
};

async function getCaller(supabase: AuthedSupabase, userId: string) {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("profiles").select("institute_id,is_active").eq("id", userId).maybeSingle(),
  ]);
  const roleList = ((roles ?? []) as { role: Role }[]).map((r) => r.role);
  if (!profile?.is_active) throw new Error("Your account is deactivated.");
  return {
    roles: roleList,
    isSuper: roleList.includes("super_admin"),
    isAdmin: roleList.includes("admin"),
    instituteId: (profile?.institute_id as string | null) ?? null,
  };
}

function requireManager(c: Awaited<ReturnType<typeof getCaller>>) {
  if (!c.isSuper && !c.isAdmin) throw new Error("You don't have permission to manage users.");
  if (!c.isSuper && !c.instituteId) throw new Error("Your admin account has no college assigned.");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    requireManager(caller);
    // RLS scopes these rows to the caller's college (or all, for super admin)
    const [{ data: profiles, error }, { data: roles }, { data: institutes }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id,email,full_name,roll_number,institute_id,is_active,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      context.supabase.from("user_roles").select("user_id,role"),
      context.supabase.from("institutes").select("id,code"),
    ]);
    if (error) throw new Error("Could not load users.");
    const codes = new Map((institutes ?? []).map((i) => [i.id, i.code]));
    return (profiles ?? []).map((p) => ({
      ...p,
      institute_code: p.institute_id ? (codes.get(p.institute_id) ?? null) : null,
      roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Role),
    }));
  });

const createSchema = z.object({
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().min(1).max(120),
  roll_number: z.string().trim().max(40).optional().default(""),
  role: z.enum(["student", "faculty", "admin", "super_admin"]),
  institute_id: z.string().uuid().nullable(),
  redirect_to: z.string().url(),
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    requireManager(caller);
    let instituteId = data.institute_id;
    if (!caller.isSuper) {
      if (data.role !== "student" && data.role !== "faculty")
        throw new Error("Admins can only create students and faculty.");
      instituteId = caller.instituteId;
    }
    if (data.role !== "super_admin" && !instituteId) throw new Error("Choose a college.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name },
      redirectTo: data.redirect_to,
    });
    if (error || !invited.user) {
      console.error("invite failed", error);
      throw new Error(
        error?.message?.includes("already") ? "That email already has an account." : "Could not create the account.",
      );
    }
    const uid = invited.user.id;
    await supabaseAdmin
      .from("profiles")
      .upsert({
        id: uid,
        email: data.email,
        full_name: data.full_name,
        roll_number: data.roll_number || null,
        institute_id: instituteId,
      });
    await supabaseAdmin.from("user_roles").upsert({ user_id: uid, role: data.role }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "user_created",
      target_id: uid,
      institute_id: instituteId,
      details: { email: data.email, role: data.role },
    });
    return { id: uid };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    requireManager(caller);
    if (data.user_id === context.userId) throw new Error("You can't deactivate yourself.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: target }, { data: targetRoles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("institute_id").eq("id", data.user_id).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id),
    ]);
    if (!target) throw new Error("User not found.");
    const tRoles = (targetRoles ?? []).map((r) => r.role);
    if (!caller.isSuper) {
      if (target.institute_id !== caller.instituteId) throw new Error("That user is outside your college.");
      if (tRoles.includes("admin") || tRoles.includes("super_admin"))
        throw new Error("Only the Super Admin can change admin accounts.");
    }
    await supabaseAdmin.from("profiles").update({ is_active: data.active }).eq("id", data.user_id);
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    });
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.active ? "user_activated" : "user_deactivated",
      target_id: data.user_id,
      institute_id: target.institute_id,
    });
    return { ok: true };
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    requireManager(caller);
    const { data, error } = await context.supabase
      .from("audit_logs")
      .select("id,actor_id,action,target_id,details,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Could not load the activity log.");
    return data ?? [];
  });

// Public: only ever invites the fixed owner email, and only while no Super Admin exists.
export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ redirect_to: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if ((count ?? 0) > 0) return { status: "exists" as const };
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(SUPER_ADMIN_EMAIL, {
      redirectTo: data.redirect_to,
      data: { full_name: "Super Admin" },
    });
    if (error) {
      console.error("bootstrap invite failed", error);
      return { status: "error" as const };
    }
    return { status: "sent" as const };
  });
