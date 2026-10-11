// M08 only: fresh in-memory PostgreSQL, synthetic rows; no live URL is accepted.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Supply an installed PGlite module path.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let passed = 0;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
async function asUser(n, run, role = "authenticated") {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const settings = { dailyMinutes: 60, restDays: [0], order: "topic-interleaved" };
const context = async (campus) =>
  (await db.query("select public.schedule_context($1) result", [campus])).rows[0].result;
const publish = async (campus, version, signature, config = settings) =>
  (
    await db.query("select public.schedule_publish($1,$2,$3,$4) result", [
      campus,
      JSON.stringify(config),
      version,
      signature,
    ])
  ).rows[0].result;
try {
  await db.exec(`create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table public.institutes(id uuid primary key,name text);
    create table public.profiles(id uuid primary key,role text,is_super_admin boolean,is_disabled boolean,institute_id uuid,admin_role_id uuid);
    create table public.admin_role_permissions(role_id uuid,module text,action text);
    create table public.academic_years(id uuid primary key,start_date date,is_active boolean);
    create table public.topics(id uuid primary key,name text,position integer,is_published boolean);
    create table public.sheets(id uuid primary key,topic_id uuid,title text,position integer,is_published boolean);
    create table public.sets(id uuid primary key,topic_id uuid,name text,position integer,is_published boolean);
    create table public.mcq_sets(id uuid primary key,topic_id uuid,name text,position integer,is_published boolean);
    create table public.problems(id uuid primary key,topic_id uuid,set_id uuid,title text,position integer);
    create table public.mcqs(id uuid primary key,mcq_set_id uuid);
    create table public.lesson_progress(student_id uuid,sheet_id uuid,status text);
    grant select on public.profiles to authenticated;
    alter table public.profiles enable row level security;
    create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());`);
  // Real inspected backend helper definitions, not permissive authorization stubs.
  const snapshot = JSON.parse(
    await readFile(
      new URL("../docs/audit-evidence/m00-2026-10-10-local-backend.json", import.meta.url),
      "utf8",
    ),
  );
  for (const name of ["is_super_admin", "admin_has_permission"])
    await db.exec(snapshot.securityMetadata.definitions.find((d) => d.proname === name).definition);
  await db.query("insert into public.institutes values($1,'PT'),($2,'Q6')", [id(90), id(91)]);
  for (const [n, role, superAdmin, disabled, campus, permission] of [
    [1, "admin", true, false, 90, null],
    [2, "admin", false, false, 90, 80],
    [3, "student", false, false, 90, null],
    [4, "faculty", false, false, 90, null],
    [5, "admin", false, true, 90, 80],
    [6, "admin", false, false, 90, null],
    [7, "student", false, false, 91, null],
  ])
    await db.query("insert into public.profiles values($1,$2,$3,$4,$5,$6)", [
      id(n),
      role,
      superAdmin,
      disabled,
      id(campus),
      permission ? id(permission) : null,
    ]);
  await db.query(
    "insert into public.admin_role_permissions values($1,'schedule','configure'),($1,'schedule','export')",
    [id(80)],
  );
  await db.query("insert into public.academic_years values($1,'2026-08-15',true)", [id(92)]);
  await db.query("insert into public.topics values($1,'Python',1,true)", [id(10)]);
  await db.query("insert into public.sheets values($1,$2,'Read',1,true)", [id(11), id(10)]);
  await db.query("insert into public.lesson_progress values($1,$2,'completed')", [id(3), id(11)]);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261011100000_m08_schedule.sql", import.meta.url),
      "utf8",
    ),
  );
  await check("existing course calendar and default settings preserved", () =>
    asUser(3, async () => {
      const c = await context(null);
      assert.equal(c.academicStart, "2026-08-15");
      assert.equal(c.settings.dailyMinutes, 120);
      assert.equal(c.settings.order, "topic-interleaved");
      assert.equal(c.canConfigure, false);
    }),
  );
  await check("authorized admin publishes atomically", () =>
    asUser(2, async () => {
      const c = await context(id(90));
      assert.equal(await publish(id(90), 0, c.signature), 1);
      assert.equal((await context(null)).version, 1);
    }),
  );
  await check("stale settings preview rejected", () =>
    asUser(2, async () => {
      const c = await context(null);
      await assert.rejects(publish(id(90), 0, c.signature), /schedule changed/);
    }),
  );
  let prior;
  await asUser(2, async () => {
    prior = (await context(null)).signature;
  });
  await db.query("update public.sheets set title='Updated title' where id=$1", [id(11)]);
  await check("curriculum changes invalidate preview", () =>
    asUser(2, () => assert.rejects(publish(id(90), 1, prior), /curriculum changed/)),
  );
  for (const n of [3, 4, 5, 6])
    await check(`student/faculty/disabled/unprivileged denial ${n}`, () =>
      asUser(n, () => assert.rejects(publish(id(90), 1, prior), /permission|active account/)),
    );
  await check("institute admin cannot publish another campus", () =>
    asUser(2, () => assert.rejects(publish(id(91), 0, prior), /outside your access/)),
  );
  await check("students cannot read another institute", () =>
    asUser(7, async () => {
      assert.equal(
        (await db.query("select * from public.curriculum_schedule_settings")).rows.length,
        0,
      );
      await assert.rejects(context(id(90)), /outside your access/);
    }),
  );
  await check("direct writes denied even to admins", () =>
    asUser(2, () =>
      assert.rejects(
        db.exec("delete from public.curriculum_schedule_settings"),
        /permission denied/,
      ),
    ),
  );
  await check("anonymous RPC denied", () =>
    asUser(3, () => assert.rejects(context(null), /permission denied/), "anon"),
  );
  await check("all rest days, duplicates and null ordering rejected", () =>
    asUser(2, async () => {
      const c = await context(null);
      for (const config of [
        { ...settings, restDays: [0, 1, 2, 3, 4, 5, 6] },
        { ...settings, restDays: [0, 0] },
        { ...settings, order: null },
      ])
        await assert.rejects(
          publish(id(90), 1, c.signature, config),
          /rest days|study day|Invalid schedule/,
        );
    }),
  );
  await check("recalculation publishes a new version without changing progress", () =>
    asUser(2, async () => {
      const c = await context(null);
      assert.equal(await publish(id(90), 1, c.signature, { ...settings, dailyMinutes: 90 }), 2);
      assert.equal((await context(null)).settings.dailyMinutes, 90);
    }),
  );
  await check("history is retained and prior student activity untouched", async () => {
    assert.equal(
      (await db.query("select count(*)::int n from public.curriculum_schedule_history")).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("select status from public.lesson_progress")).rows[0].status,
      "completed",
    );
  });
  console.log(`${passed} M08 database checks passed.`);
} finally {
  await db.close();
}
