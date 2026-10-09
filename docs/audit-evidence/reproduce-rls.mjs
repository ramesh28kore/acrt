// Audit-only reproduction. PostgreSQL runs entirely in memory; no connection URL is accepted.
// Pass the path to an externally installed @electric-sql/pglite/dist/index.js.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) {
  throw new Error("Usage: node docs/audit-evidence/reproduce-rls.mjs <pglite/dist/index.js>");
}
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const results = [];
const ids = {
  studentPT: "00000000-0000-4000-8000-000000000001",
  studentQ6: "00000000-0000-4000-8000-000000000002",
  facultyPT: "00000000-0000-4000-8000-000000000003",
  adminPT: "00000000-0000-4000-8000-000000000004",
  inactivePT: "00000000-0000-4000-8000-000000000005",
};

async function asUser(role, id, run) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
  }
}

function record(name, safe, evidence) {
  results.push({ check: name, status: safe ? "PASS" : "FAIL", evidence });
}

try {
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
  `);
  const migration = await readFile(
    new URL("../../drizzle/migrations/0000_migration.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  const { rows: institutes } = await db.query("SELECT id, code FROM public.institutes");
  const pt = institutes.find((i) => i.code === "PT").id;
  const q6 = institutes.find((i) => i.code === "Q6").id;
  for (const [name, id] of Object.entries(ids)) {
    await db.query(
      "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${name}@example.invalid`],
    );
    await db.query("UPDATE public.profiles SET institute_id = $1, is_active = $2 WHERE id = $3", [
      name === "studentQ6" ? q6 : pt,
      name !== "inactivePT",
      id,
    ]);
    await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)", [
      id,
      name.startsWith("faculty") ? "faculty" : name.startsWith("admin") ? "admin" : "student",
    ]);
  }

  await asUser("authenticated", ids.studentPT, async () => {
    const { rows } = await db.query("SELECT id FROM public.profiles");
    assert.deepEqual(
      rows.map((r) => r.id),
      [ids.studentPT],
    );
    record(
      "Student cannot select other profiles",
      true,
      "Only the student's own row was returned.",
    );
    let denied = false;
    try {
      await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'super_admin')", [
        ids.studentPT,
      ]);
    } catch (error) {
      if (error.code !== "42501") throw error;
      denied = true;
    }
    assert.equal(denied, true);
    record("Student cannot directly grant a role", denied, "INSERT rejected with SQLSTATE 42501.");
    const { rows: changed } = await db.query(
      "UPDATE public.profiles SET institute_id = $1, email = 'changed@example.invalid', roll_number = 'OTHER', is_active = false WHERE id = $2 RETURNING institute_id, email, roll_number, is_active",
      [q6, ids.studentPT],
    );
    record(
      "Protected profile columns cannot be changed by their owner",
      changed[0].institute_id === pt &&
        changed[0].email === "studentPT@example.invalid" &&
        changed[0].roll_number === null &&
        changed[0].is_active,
      changed[0],
    );
  });

  await asUser("authenticated", ids.facultyPT, async () => {
    const { rows } = await db.query("SELECT id FROM public.profiles ORDER BY id");
    const seesAdmin = rows.some((r) => r.id === ids.adminPT);
    record("Faculty access is limited to assigned students", !seesAdmin, {
      visibleProfileIds: rows.map((r) => r.id),
      sameCollegeAdminVisible: seesAdmin,
    });
  });

  await asUser("authenticated", ids.adminPT, async () => {
    const { rows: before } = await db.query("SELECT id FROM public.profiles WHERE id = $1", [
      ids.studentQ6,
    ]);
    assert.equal(before.length, 0);
    await db.query("UPDATE public.profiles SET institute_id = $1 WHERE id = $2", [q6, ids.adminPT]);
    const { rows: after } = await db.query("SELECT id FROM public.profiles WHERE id = $1", [
      ids.studentQ6,
    ]);
    record("Admin cannot change institute to read another college", after.length === 0, {
      crossCollegeRowsBefore: before.length,
      crossCollegeRowsAfter: after.length,
    });
  });

  await asUser("authenticated", ids.inactivePT, async () => {
    const { rows } = await db.query("SELECT id, is_active FROM public.profiles WHERE id = $1", [
      ids.inactivePT,
    ]);
    record("Inactive accounts cannot read application data", rows.length === 0, rows);
    const { rows: changed } = await db.query(
      "UPDATE public.profiles SET is_active = true WHERE id = $1 RETURNING is_active",
      [ids.inactivePT],
    );
    record("Inactive account cannot reactivate itself", changed[0]?.is_active !== true, changed);
  });

  await asUser("anon", null, async () => {
    const { rows } = await db.query(
      "SELECT public.user_institute($1) AS institute_id, public.has_role($1, 'admin') AS is_admin",
      [ids.adminPT],
    );
    record(
      "Anonymous caller cannot query another user's institute and role through RPC helpers",
      rows[0].institute_id === null && !rows[0].is_admin,
      rows,
    );
    let denied = false;
    try {
      await db.query("SELECT id FROM public.profiles");
    } catch (error) {
      if (error.code !== "42501") throw error;
      denied = true;
    }
    assert.equal(denied, true);
    record(
      "Anonymous caller cannot select profiles directly",
      denied,
      "SELECT rejected with SQLSTATE 42501.",
    );
  });

  await asUser("authenticated", ids.facultyPT, async () => {
    await db.query(
      "INSERT INTO public.audit_logs (actor_id, action, institute_id, target_id, created_at, details) VALUES ($1, 'sign_in', $2, $3, '2099-01-01', '{\"claimed\":\"arbitrary\"}')",
      [ids.facultyPT, q6, ids.adminPT],
    );
  });
  const { rows: forgedAudit } = await db.query(
    "SELECT institute_id, target_id, created_at, details FROM public.audit_logs WHERE actor_id = $1",
    [ids.facultyPT],
  );
  record("Sign-in audit metadata is server authoritative", forgedAudit.length === 0, forgedAudit);

  const { rows: version } = await db.query("SELECT version()");
  console.log(
    JSON.stringify(
      {
        engine: version[0].version,
        scope:
          "Unmodified repository migration; synthetic auth schema/users; in-memory PostgreSQL only. No live Supabase, Auth, or PostgREST was tested.",
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
} finally {
  await db.close();
}
