import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Role } from "@/lib/me";
import { loadIdentity, type LiveProfile } from "./identity";
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

type Client = SupabaseClient<Database>;
// The running backend's tables (single-role profiles, audit_log) are not in the generated types.
type Loose = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const loose = (client: Client | Loose) => client as Loose;

export type Actor = { id: string; email: string | null };

const PAGE_SIZE = 20;
const SCAN_SIZE = 1000;

type ProfileRow = LiveProfile & { created_at: string };
type InstituteRow = { id: string; code: string; name: string };

export async function assertSuperAdmin(client: Client, userId: string): Promise<Actor> {
  const identity = await loadIdentity(client, userId);
  if (!identity?.active || !identity.roles.includes("super_admin")) {
    throw new Error("An active super admin account is required.");
  }
  return { id: userId, email: identity.profile.email };
}

function dbError(error: { code?: string; message: string } | null, duplicate?: string) {
  if (!error) return;
  if (error.code === "23505") throw new Error(duplicate ?? "That value is already in use.");
  // Raised by the database's own guards with a message written for people.
  if (["P0001", "42501", "23514"].includes(error.code ?? "")) throw new Error(error.message);
  console.error("Super admin database operation failed", error.code);
  throw new Error("The operation could not be completed. Refresh and try again.");
}

// A profile is shown under one role; a super admin is an admin row with the flag.
function primaryRole(profile: Pick<LiveProfile, "role" | "is_super_admin">): Role | null {
  if (profile.role === "admin" && profile.is_super_admin === true) return "super_admin";
  return profile.role === "student" || profile.role === "faculty" || profile.role === "admin"
    ? profile.role
    : null;
}

// Keeps user text from altering the structure of a PostgREST or() filter.
function filterText(value: string) {
  return value.replace(/[%,()*\\":]/g, " ").trim();
}

async function loadInstitutes(client: Loose): Promise<InstituteRow[]> {
  const { data, error } = await client.from("institutes").select("id,code,name").order("code");
  dbError(error);
  return (data ?? []) as InstituteRow[];
}

async function writeAudit(
  actor: Actor,
  entry: {
    action: string;
    module: string;
    recordType: string;
    recordId: string;
    summary: string;
    details: Record<string, unknown>;
  },
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await loose(supabaseAdmin).from("audit_log").insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: "super_admin",
      action: entry.action,
      module: entry.module,
      record_type: entry.recordType,
      record_id: entry.recordId,
      summary: entry.summary,
      details: entry.details,
      status: "success",
    });
    if (error) console.error("Audit write failed", error.code);
  } catch {
    // The change has already committed; a missing audit row must not report it as failed.
    console.error("Audit write failed");
  }
}

export async function getOverview(client: Client) {
  const db = loose(client);
  const institutes = await loadInstitutes(db);
  const roles: Record<string, number> = {};
  const perInstitute = new Map(
    institutes.map((i) => [
      i.id,
      { ...i, users: 0, active: 0, students: 0, faculty: 0, admins: 0 },
    ]),
  );
  let total = 0;
  let active = 0;
  let unassigned = 0;

  for (let from = 0; ; from += SCAN_SIZE) {
    const { data, error } = await db
      .from("profiles")
      .select("id,role,is_super_admin,is_disabled,institute_id")
      .order("id")
      .range(from, from + SCAN_SIZE - 1);
    dbError(error);
    const rows = (data ?? []) as Array<
      Pick<LiveProfile, "role" | "is_super_admin" | "is_disabled" | "institute_id">
    >;
    for (const row of rows) {
      total += 1;
      const isActive = row.is_disabled === false;
      if (isActive) active += 1;
      const role = primaryRole(row);
      if (role) roles[role] = (roles[role] ?? 0) + 1;
      if (!row.institute_id) unassigned += 1;
      const bucket = row.institute_id ? perInstitute.get(row.institute_id) : undefined;
      if (bucket) {
        bucket.users += 1;
        if (isActive) bucket.active += 1;
        if (role === "student") bucket.students += 1;
        if (role === "faculty") bucket.faculty += 1;
        if (role === "admin" || role === "super_admin") bucket.admins += 1;
      }
    }
    if (rows.length < SCAN_SIZE) break;
  }

  return overviewSchema.parse({
    total,
    active,
    disabled: total - active,
    unassigned,
    roles,
    institutes: [...perInstitute.values()],
  });
}

export async function getUsers(client: Client, filters: UserFilters) {
  const db = loose(client);
  let query = db.from("profiles").select("*", { count: "exact" });
  const search = filterText(filters.search);
  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,roll_number.ilike.%${search}%`,
    );
  }
  if (filters.role === "super_admin") query = query.eq("role", "admin").eq("is_super_admin", true);
  else if (filters.role === "admin") query = query.eq("role", "admin").eq("is_super_admin", false);
  else if (filters.role) query = query.eq("role", filters.role);
  if (filters.instituteId) query = query.eq("institute_id", filters.instituteId);
  if (filters.active !== null) query = query.eq("is_disabled", !filters.active);

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  dbError(error);

  const institutes = new Map((await loadInstitutes(db)).map((i) => [i.id, i]));
  const items = ((data ?? []) as ProfileRow[]).map((row) => {
    const institute = row.institute_id ? institutes.get(row.institute_id) : undefined;
    const role = primaryRole(row);
    return {
      id: row.id,
      email: row.email ?? "",
      full_name: row.full_name ?? "",
      roll_number: row.roll_number,
      institute_id: row.institute_id,
      institute_code: institute?.code ?? null,
      institute_name: institute?.name ?? null,
      is_active: row.is_disabled === false,
      disabled_at: row.disabled_at,
      created_at: row.created_at,
      roles: role ? [role] : [],
    };
  });
  return userPageSchema.parse({ total: count ?? items.length, items });
}

export async function getActivity(client: Client, filters: ActivityFilters) {
  const db = loose(client);
  let query = db.from("audit_log").select("*", { count: "exact" });
  const search = filterText(filters.search);
  if (search) {
    query = query.or(
      `actor_email.ilike.%${search}%,summary.ilike.%${search}%,action.ilike.%${search}%`,
    );
  }
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.role) query = query.eq("actor_role", filters.role);
  // audit_log has no institute column; rows written by this dashboard carry it in details.
  if (filters.instituteId) query = query.eq("details->>institute_id", filters.instituteId);

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  dbError(error);

  type AuditRow = {
    id: number | string;
    created_at: string;
    actor_id: string | null;
    actor_email: string | null;
    actor_role: string | null;
    action: string;
    record_type: string | null;
    record_id: string | null;
    details: unknown;
  };
  const rows = (data ?? []) as AuditRow[];

  const personIds = new Set<string>();
  for (const row of rows) {
    if (row.actor_id) personIds.add(row.actor_id);
    if (row.record_type === "profile" && row.record_id) personIds.add(row.record_id);
  }
  const people = new Map<string, LiveProfile>();
  if (personIds.size) {
    const found = await db
      .from("profiles")
      .select("id,role,full_name,email,is_super_admin,is_disabled")
      .in("id", [...personIds]);
    dbError(found.error);
    for (const person of (found.data ?? []) as LiveProfile[]) people.set(person.id, person);
  }
  const institutes = new Map((await loadInstitutes(db)).map((i) => [i.id, i]));

  const items = rows.map((row) => {
    const actor = row.actor_id ? people.get(row.actor_id) : undefined;
    const target =
      row.record_type === "profile" && row.record_id ? people.get(row.record_id) : undefined;
    const details =
      row.details && typeof row.details === "object" && !Array.isArray(row.details)
        ? (row.details as Record<string, unknown>)
        : {};
    const instituteId =
      typeof details["institute_id"] === "string" ? details["institute_id"] : null;
    const role = actor ? primaryRole(actor) : null;
    const loggedRole = ["student", "faculty", "admin", "super_admin"].includes(row.actor_role ?? "")
      ? (row.actor_role as Role)
      : null;
    return {
      id: String(row.id),
      action: row.action,
      actor_name: actor?.full_name || actor?.email || row.actor_email || "System",
      actor_email: actor?.email ?? row.actor_email,
      actor_roles: role ? [role] : loggedRole ? [loggedRole] : [],
      target_name: target ? target.full_name || target.email : null,
      institute_code: instituteId ? (institutes.get(instituteId)?.code ?? null) : null,
      created_at: row.created_at,
      details,
    };
  });
  return activityPageSchema.parse({ total: count ?? items.length, items });
}

function storedRole(role: Role) {
  return { role: role === "super_admin" ? "admin" : role, is_super_admin: role === "super_admin" };
}

export async function updateUser(client: Client, actor: Actor, input: EditUser) {
  const db = loose(client);
  if (input.role !== "super_admin" && !input.institute_id) throw new Error("Choose an institute.");
  if (input.institute_id) {
    const institute = await db
      .from("institutes")
      .select("id")
      .eq("id", input.institute_id)
      .maybeSingle();
    if (institute.error || !institute.data) throw new Error("Institute not found.");
  }

  const found = await db.from("profiles").select("*").eq("id", input.user_id).maybeSingle();
  dbError(found.error);
  const previous = found.data as LiveProfile | null;
  if (!previous) throw new Error("User not found.");
  const previousRole = primaryRole(previous);
  const wasActive = previous.is_disabled === false;

  if (
    input.user_id === actor.id &&
    (!input.is_active ||
      input.role !== "super_admin" ||
      input.institute_id !== previous.institute_id)
  ) {
    throw new Error("You cannot change your own access, role, or institute.");
  }
  if (
    wasActive &&
    previousRole === "super_admin" &&
    (!input.is_active || input.role !== "super_admin")
  ) {
    const remaining = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_super_admin", true)
      .eq("is_disabled", false)
      .neq("id", input.user_id);
    dbError(remaining.error);
    if ((remaining.count ?? 0) < 1) throw new Error("Keep at least one active super admin.");
  }

  const updated = await db
    .from("profiles")
    .update({
      full_name: input.full_name,
      roll_number: input.roll_number || null,
      institute_id: input.institute_id,
      is_disabled: !input.is_active,
      ...storedRole(input.role),
    })
    .eq("id", input.user_id)
    .select("id");
  dbError(updated.error, "That roll number is already in use.");
  if (!updated.data?.length) throw new Error("User not found.");

  const action =
    wasActive !== input.is_active
      ? input.is_active
        ? "user_activated"
        : "user_deactivated"
      : previousRole !== input.role
        ? "role_changed"
        : "user_updated";
  await writeAudit(actor, {
    action,
    module: "users",
    recordType: "profile",
    recordId: input.user_id,
    summary: `${previous.email ?? input.user_id}: ${action.replace("_", " ")}`,
    details: {
      institute_id: input.institute_id,
      before: {
        name: previous.full_name,
        role: previousRole,
        active: wasActive,
        institute_id: previous.institute_id,
      },
      after: {
        name: input.full_name,
        role: input.role,
        active: input.is_active,
        institute_id: input.institute_id,
      },
    },
  });
  return { ok: true as const };
}

export async function createAccount(client: Client, actor: Actor, input: CreateAccount) {
  if (input.role !== "super_admin" && !input.institute_id) throw new Error("Choose an institute.");
  if (input.institute_id) {
    const institute = await loose(client)
      .from("institutes")
      .select("id")
      .eq("id", input.institute_id)
      .maybeSingle();
    if (institute.error || !institute.data) throw new Error("Institute not found.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  const userId = created.data.user.id;

  // The live backend creates no profile row on sign-up, and profiles has no insert policy.
  const inserted = await loose(supabaseAdmin)
    .from("profiles")
    .insert({
      id: userId,
      email: input.email,
      full_name: input.full_name,
      roll_number: input.roll_number || null,
      institute_id: input.institute_id,
      is_disabled: !input.is_active,
      ...storedRole(input.role),
    });
  if (inserted.error) {
    const cleanup = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (cleanup.error) {
      throw new Error(
        "Account setup failed and the sign-in account could not be removed; contact support.",
      );
    }
    dbError(inserted.error, "That roll number is already in use.");
  }
  await writeAudit(actor, {
    action: "user_created",
    module: "users",
    recordType: "profile",
    recordId: userId,
    summary: `Created ${input.email}`,
    details: { institute_id: input.institute_id, name: input.full_name, role: input.role },
  });
  return { id: userId };
}

export async function saveInstitute(client: Client, actor: Actor, input: InstituteFields) {
  const db = loose(client);
  const duplicate = "That institute code is already in use.";
  let id: string;
  let before: unknown = null;
  if (input.id) {
    const found = await db.from("institutes").select("*").eq("id", input.id).maybeSingle();
    dbError(found.error);
    if (!found.data) throw new Error("Institute not found.");
    before = found.data;
    const updated = await db
      .from("institutes")
      .update({ code: input.code, name: input.name })
      .eq("id", input.id)
      .select("id");
    dbError(updated.error, duplicate);
    if (!updated.data?.length) throw new Error("Institute not found.");
    id = input.id;
  } else {
    const inserted = await db
      .from("institutes")
      .insert({ code: input.code, name: input.name })
      .select("id")
      .single();
    dbError(inserted.error, duplicate);
    id = (inserted.data as { id: string }).id;
  }
  await writeAudit(actor, {
    action: input.id ? "institute_updated" : "institute_created",
    module: "institutes",
    recordType: "institute",
    recordId: id,
    summary: `${input.id ? "Updated" : "Created"} institute ${input.code}`,
    details: { institute_id: id, before, code: input.code, name: input.name },
  });
  return { id };
}
