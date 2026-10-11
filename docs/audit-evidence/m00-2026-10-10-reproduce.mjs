// Audit evidence only: fresh in-memory PostgreSQL, synthetic identities, no live DB URL.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Pass an installed @electric-sql/pglite/dist/index.js path.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const checks = [];
const uid = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function asUser(n, callback, role = "authenticated") {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}
function finding(id, observed, expected, evidence) {
  checks.push({
    id,
    status: observed === expected ? "PASS" : "FAIL",
    observed,
    expected,
    evidence,
  });
}
try {
  await db.exec(`create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon,service_role;`);
  for (const migration of [
    "0000_migration.sql",
    "0001_super_admin_dashboard.sql",
    "0002_admin_dashboard.sql",
  ]) {
    await db.exec(
      await readFile(new URL(`../../drizzle/migrations/${migration}`, import.meta.url), "utf8"),
    );
  }
  const institutes = (await db.query("select id,code from public.institutes")).rows;
  const pt = institutes.find((i) => i.code === "PT").id;
  const q6 = institutes.find((i) => i.code === "Q6").id;
  const roles = ["super_admin", "admin", "faculty", "student", "student", "admin"];
  for (let n = 1; n <= roles.length; n++) {
    await db.query("insert into auth.users values($1,$2,'{}')", [
      uid(n),
      `audit${n}@example.invalid`,
    ]);
    await db.query(
      "update public.profiles set full_name=$2,institute_id=$3,is_active=true where id=$1",
      [uid(n), `Audit person ${n}`, n >= 5 ? q6 : pt],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [
      uid(n),
      roles[n - 1],
    ]);
  }
  await asUser(3, async () => {
    const rows = (await db.query("select id from public.profiles where id<>auth.uid()")).rows;
    finding(
      "faculty-assignment-boundary",
      rows.length,
      0,
      "Faculty with no assignments reads 3 other PT profiles, including both administrators.",
    );
  });
  await asUser(4, async () => {
    const result = (
      await db.query(
        "select public.user_institute($1) institute,public.has_role($1,'admin') admin",
        [uid(6)],
      )
    ).rows[0];
    finding(
      "authenticated-helper-scope",
      result.institute === q6 && result.admin,
      false,
      "Student learns a Q6 admin's institute and role from public helpers using a known UUID.",
    );
  });
  await db.query("update public.profiles set is_active=false where id=$1", [uid(4)]);
  await asUser(4, async () => {
    const profile = (await db.query("select id from public.profiles where id=auth.uid()")).rows
      .length;
    const campuses = (await db.query("select id from public.institutes")).rows.length;
    const updated = (
      await db.query(
        "update public.profiles set full_name='Disabled self edit' where id=auth.uid() returning id",
      )
    ).rows.length;
    finding(
      "disabled-account-residual-access",
      profile + campuses + updated,
      0,
      "Disabled student still reads own profile and both institutes, and updates own name (1+2+1).",
    );
    await assert.rejects(
      db.query("update public.profiles set is_active=true where id=auth.uid()"),
      /permission denied/,
    );
    checks.push({ id: "disabled-self-reactivation-denied", status: "PASS" });
  });
  await db.query(
    "insert into public.audit_logs(actor_id,target_id,institute_id,action,details) values($1,$2,$3,'user_updated',$4::jsonb)",
    [
      uid(6),
      uid(5),
      pt,
      JSON.stringify({ actor_roles: ["admin"], name: "Outside institute detail" }),
    ],
  );
  await asUser(2, async () => {
    const direct = (
      await db.query("select details,actor_id from public.audit_logs where action='user_updated'")
    ).rows[0];
    const rpc = (await db.query("select public.admin_dashboard_activity('','user_updated') result"))
      .rows[0].result.items[0];
    assert.deepEqual(rpc.details, {});
    assert.equal(rpc.actor_email, null);
    finding(
      "audit-redaction-boundary",
      direct.details.name === "Outside institute detail" && direct.actor_id === uid(6),
      false,
      "Admin RPC redacts fields, but authenticated SELECT on audit_logs still exposes the raw scoped row.",
    );
  });
  await asUser(3, async () => {
    await db.query(
      "insert into public.audit_logs(actor_id,action) values(auth.uid(),'sign_in'),(auth.uid(),'sign_in')",
    );
  });
  finding(
    "sign-in-event-authority",
    (
      await db.query(
        "select count(*)::int n from public.audit_logs where actor_id=$1 and action='sign_in'",
        [uid(3)],
      )
    ).rows[0].n,
    0,
    "A valid session can add 2 sign_in events without a new provider authentication; metadata is stamped but event occurrence is self-reported.",
  );
  const before = (await db.query("select count(*)::int n from public.audit_logs")).rows[0].n;
  await asUser(3, () =>
    db.query("update public.profiles set full_name='Renamed actor' where id=auth.uid()"),
  );
  finding(
    "self-profile-edit-audited",
    (await db.query("select count(*)::int n from public.audit_logs")).rows[0].n - before,
    1,
    "Direct own-name update creates no audit event; displayed actor names join current profiles.",
  );
  await asUser(4, () =>
    assert.rejects(db.query("select public.super_admin_overview()"), /active super admin/),
  );
  checks.push({ id: "privileged-rpc-denies-student", status: "PASS" });
  await asUser(
    4,
    () =>
      assert.rejects(db.query("select public.user_institute($1)", [uid(6)]), /permission denied/),
    "anon",
  );
  checks.push({ id: "anonymous-helper-denied", status: "PASS" });
  const inventory = {
    postgres: (await db.query("select version() v")).rows[0].v,
    tables: (
      await db.query(
        "select tablename,rowsecurity from pg_tables where schemaname='public' order by tablename",
      )
    ).rows,
    policies: (
      await db.query(
        "select tablename,policyname,cmd from pg_policies where schemaname='public' order by tablename,policyname",
      )
    ).rows,
    functions: (
      await db.query(
        "select proname,prosecdef,proconfig from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' order by proname",
      )
    ).rows,
  };
  console.log(
    JSON.stringify(
      {
        baseline: "c0d508f",
        scope: "isolated synthetic database with migrations 0000–0002",
        checks,
        inventory,
      },
      null,
      2,
    ),
  );
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
} finally {
  await db.close();
}
