// Runs the actual migrations in an isolated PostgreSQL engine. No live DB URL is accepted.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Pass the path to @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
let passed = 0;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function asUser(role, user, run) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
  }
}
const update = (target, name, role, active = true, institute = pt) =>
  db.query("select public.super_admin_update_user($1,$2,$3,$4,$5,$6)", [
    target,
    name,
    "TEST001",
    institute,
    role,
    active,
  ]);
let pt;
try {
  await db.exec(`create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon,service_role;`);
  for (const file of [
    "0000_migration.sql",
    "0001_super_admin_dashboard.sql",
    "0002_admin_dashboard.sql",
  ]) {
    await db.exec(
      await readFile(new URL(`../drizzle/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  pt = (await db.query("select id from public.institutes where code='PT'")).rows[0].id;
  for (let n = 1; n <= 27; n++) {
    await db.query("insert into auth.users values($1,$2,'{}')", [
      id(n),
      `fixture${n}@example.invalid`,
    ]);
    await db.query(
      "update public.profiles set is_active=true,full_name=$2,institute_id=$3 where id=$1",
      [id(n), `Person ${n}`, pt],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [
      id(n),
      n === 1 ? "super_admin" : n === 2 ? "admin" : n === 3 ? "faculty" : "student",
    ]);
  }
  await check("anonymous RPC calls denied", () =>
    asUser("anon", null, () =>
      assert.rejects(db.query("select public.super_admin_overview()"), /permission denied/),
    ),
  );
  for (const n of [2, 3, 4])
    await check(`role ${n} cannot open the super admin API`, () =>
      asUser("authenticated", id(n), () =>
        assert.rejects(db.query("select public.super_admin_overview()"), /active super admin/),
      ),
    );
  await check("self-service cannot modify protected profile columns", () =>
    asUser("authenticated", id(4), () =>
      assert.rejects(
        db.query("update public.profiles set is_active=false where id=$1", [id(4)]),
        /permission denied/,
      ),
    ),
  );
  await check("self-service name change still works", () =>
    asUser("authenticated", id(4), async () => {
      await db.query("update public.profiles set full_name='Renamed student' where id=$1", [id(4)]);
      assert.equal(
        (await db.query("select full_name from public.profiles where id=$1", [id(4)])).rows[0]
          .full_name,
        "Renamed student",
      );
    }),
  );
  await check("statistics and server pagination reflect all accounts", () =>
    asUser("authenticated", id(1), async () => {
      assert.equal(
        (await db.query("select public.super_admin_overview() as data")).rows[0].data.total,
        27,
      );
      const first = (await db.query("select public.super_admin_users('',null,null,null,1) as data"))
        .rows[0].data;
      const second = (
        await db.query("select public.super_admin_users('',null,null,null,2) as data")
      ).rows[0].data;
      assert.equal(first.total, 27);
      assert.equal(first.items.length, 20);
      assert.equal(second.items.length, 7);
      assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 27);
    }),
  );
  await check("search and role filters are applied before pagination", () =>
    asUser("authenticated", id(1), async () => {
      const result = (
        await db.query("select public.super_admin_users('renamed','student',null,true,1) as data")
      ).rows[0].data;
      assert.equal(result.total, 1);
      assert.equal(result.items[0].id, id(4));
    }),
  );
  await check("self demotion and self deactivation are rejected", () =>
    asUser("authenticated", id(1), async () => {
      await assert.rejects(update(id(1), "Owner", "admin"), /own access/);
      await assert.rejects(update(id(1), "Owner", "super_admin", false), /own access/);
    }),
  );
  await check("roles, access, timestamps and audit update together", () =>
    asUser("authenticated", id(1), async () => {
      await update(id(4), "Managed Faculty", "faculty", false);
      const profile = (await db.query("select * from public.profiles where id=$1", [id(4)]))
        .rows[0];
      assert.equal(profile.is_active, false);
      assert.ok(profile.disabled_at);
      assert.equal(
        (await db.query("select role from public.user_roles where user_id=$1", [id(4)])).rows[0]
          .role,
        "faculty",
      );
      assert.equal(
        (await db.query("select action from public.audit_logs where target_id=$1", [id(4)])).rows[0]
          .action,
        "user_deactivated",
      );
    }),
  );
  await check("disabled accounts immediately lose privileged role checks", () =>
    asUser("authenticated", id(4), async () => {
      assert.equal(
        (await db.query("select public.has_role($1,'faculty') as allowed", [id(4)])).rows[0]
          .allowed,
        false,
      );
      await assert.rejects(
        db.query("insert into public.audit_logs(actor_id,action) values($1,'sign_in')", [id(4)]),
        /active account/,
      );
    }),
  );
  await check("reactivation clears disabled_at", () =>
    asUser("authenticated", id(1), async () => {
      await update(id(4), "Managed Faculty", "faculty", true);
      assert.equal(
        (await db.query("select disabled_at from public.profiles where id=$1", [id(4)])).rows[0]
          .disabled_at,
        null,
      );
    }),
  );
  await db.exec(`create function public.test_reject_audit() returns trigger language plpgsql as $$ begin
    if new.details->'after'->>'name'='Rollback target' then raise exception 'audit unavailable'; end if; return new; end $$;
    create trigger test_reject_audit before insert on public.audit_logs for each row execute function public.test_reject_audit();`);
  await check("audit failure rolls back the role and profile mutation", () =>
    asUser("authenticated", id(1), async () => {
      await assert.rejects(update(id(4), "Rollback target", "admin", false), /audit unavailable/);
      const profile = (
        await db.query("select full_name,is_active from public.profiles where id=$1", [id(4)])
      ).rows[0];
      assert.equal(profile.full_name, "Managed Faculty");
      assert.equal(profile.is_active, true);
      assert.equal(
        (await db.query("select role from public.user_roles where user_id=$1", [id(4)])).rows[0]
          .role,
        "faculty",
      );
    }),
  );
  await check("institute edits are unique and audited", () =>
    asUser("authenticated", id(1), async () => {
      const added = (
        await db.query("select public.super_admin_save_institute(null,'ZZ','Test campus') as id")
      ).rows[0].id;
      await assert.rejects(
        db.query("select public.super_admin_save_institute(null,'ZZ','Duplicate')"),
        /duplicate key/,
      );
      await db.query("select public.super_admin_save_institute($1,'ZY','Renamed campus')", [added]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as total from public.audit_logs where institute_id=$1",
            [added],
          )
        ).rows[0].total,
        2,
      );
    }),
  );
  await check("login records use trusted timestamp and institute", () =>
    asUser("authenticated", id(3), async () => {
      await db.query(
        "insert into public.audit_logs(actor_id,action,institute_id,created_at,details) values($1,'sign_in',null,'2099-01-01','{\"roles\":[\"super_admin\"]}')",
        [id(3)],
      );
      const record = (
        await asUser("authenticated", id(1), () =>
          db.query("select * from public.audit_logs where action='sign_in'"),
        )
      ).rows[0];
      assert.equal(record.institute_id, pt);
      assert.deepEqual(record.details.roles, ["faculty"]);
      assert.notEqual(new Date(record.created_at).getUTCFullYear(), 2099);
    }),
  );
  await check("owner email cannot automatically become super admin", async () => {
    await db.query("insert into auth.users values($1,'ramesh2kore@gmail.com','{}')", [id(90)]);
    assert.equal(
      (
        await db.query("select count(*)::int as total from public.user_roles where user_id=$1", [
          id(90),
        ])
      ).rows[0].total,
      0,
    );
    assert.equal(
      (await db.query("select is_active from public.profiles where id=$1", [id(90)])).rows[0]
        .is_active,
      false,
    );
  });
  console.log(`${passed} database checks passed.`);
} finally {
  await db.close();
}
