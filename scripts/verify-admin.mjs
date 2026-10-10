// Isolated database verification; never connects to a live database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Pass the path to @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
let passed = 0;
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
async function asUser(role, user, run) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
  }
}
const save = (
  target,
  role = "student",
  active = true,
  create = false,
  actor = id(1),
  name = "Updated account",
) =>
  asUser("service_role", null, () =>
    db.query("select public.admin_save_user($1,$2,$3,'TEST01',$4,$5,$6)", [
      actor,
      target,
      name,
      role,
      active,
      create,
    ]),
  );
const data = async (sql, params = []) => (await db.query(sql, params)).rows[0].data;
try {
  await db.exec(`create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon,service_role;`);
  for (const file of [
    "0000_migration.sql",
    "0001_super_admin_dashboard.sql",
    "0002_admin_dashboard.sql",
  ])
    await db.exec(
      await readFile(new URL(`../drizzle/migrations/${file}`, import.meta.url), "utf8"),
    );
  const campuses = (await db.query("select id,code from public.institutes")).rows;
  const pt = campuses.find((i) => i.code === "PT").id;
  const q6 = campuses.find((i) => i.code === "Q6").id;
  for (let n = 1; n <= 30; n++) {
    await db.query("insert into auth.users values($1,$2,'{}')", [
      id(n),
      `fixture${n}@example.invalid`,
    ]);
    await db.query(
      "update public.profiles set full_name=$2,institute_id=$3,is_active=true where id=$1",
      [id(n), `Person ${n}`, n >= 28 ? q6 : pt],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [
      id(n),
      n === 1 || n === 28 ? "admin" : n === 2 ? "super_admin" : n === 3 ? "faculty" : "student",
    ]);
  }
  await check("anonymous and non-admin readers are rejected", async () => {
    await asUser("anon", null, () =>
      assert.rejects(db.query("select public.admin_dashboard_overview()"), /permission denied/),
    );
    for (const n of [2, 3, 4])
      await asUser("authenticated", id(n), () =>
        assert.rejects(db.query("select public.admin_dashboard_overview()"), /active admin/),
      );
  });
  await check("overview, search, pagination, and direct RLS stay in the institute", () =>
    asUser("authenticated", id(1), async () => {
      const overview = await data("select public.admin_dashboard_overview() data");
      assert.equal(overview.total, 27);
      assert.equal(overview.institute.id, pt);
      const first = await data("select public.admin_dashboard_users() data");
      const second = await data("select public.admin_dashboard_users('',null,null,2) data");
      assert.equal(first.items.length, 20);
      assert.equal(second.items.length, 7);
      assert.ok([...first.items, ...second.items].every((user) => user.institute_id === pt));
      assert.equal((await data("select public.admin_dashboard_users('fixture29') data")).total, 0);
      assert.equal(
        (await data("select public.admin_dashboard_users('fixture27','student',true) data")).total,
        1,
      );
      assert.equal(
        (await db.query("select * from public.profiles where institute_id=$1", [q6])).rows.length,
        0,
      );
    }),
  );
  await check("browser clients cannot call service mutations or impersonate an actor", () =>
    asUser("authenticated", id(1), () =>
      assert.rejects(
        db.query("select public.admin_save_user($1,$2,'Forged','','student',true,false)", [
          id(28),
          id(29),
        ]),
        /permission denied/,
      ),
    ),
  );
  await check("admin cannot edit another institute or assign privileged roles", async () => {
    await assert.rejects(save(id(29)), /outside your institute/);
    await assert.rejects(save(id(4), "admin"), /only student and faculty/);
    await assert.rejects(save(id(4), "super_admin"), /only student and faculty/);
  });
  await check(
    "self and all privileged targets are protected, including inactive mixed roles",
    async () => {
      await assert.rejects(save(id(1)), /Only the Super Admin/);
      await assert.rejects(save(id(2)), /Only the Super Admin/);
      await db.query("update public.profiles set is_active=false where id=$1", [id(2)]);
      await db.query("insert into public.user_roles(user_id,role) values($1,'student')", [id(2)]);
      await assert.rejects(save(id(2)), /Only the Super Admin/);
    },
  );
  await check("role, access, disabled timestamp, and audit commit together", async () => {
    await save(id(4), "faculty", false);
    const profile = (await db.query("select * from public.profiles where id=$1", [id(4)])).rows[0];
    assert.equal(profile.is_active, false);
    assert.ok(profile.disabled_at);
    assert.equal(
      (await db.query("select role from public.user_roles where user_id=$1", [id(4)])).rows[0].role,
      "faculty",
    );
    const log = (await db.query("select * from public.audit_logs where target_id=$1", [id(4)]))
      .rows[0];
    assert.equal(log.action, "user_deactivated");
    assert.equal(log.actor_id, id(1));
    assert.equal(log.institute_id, pt);
    assert.deepEqual(log.details.before.roles, ["student"]);
    assert.deepEqual(log.details.after.roles, ["faculty"]);
    await save(id(4), "faculty", true);
    assert.equal(
      (await db.query("select disabled_at from public.profiles where id=$1", [id(4)])).rows[0]
        .disabled_at,
      null,
    );
  });
  await check("audit failure rolls back profile and role changes", async () => {
    await db.exec(`create function public.fail_admin_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$;
      create trigger test_audit_failure before insert on public.audit_logs for each row execute function public.fail_admin_audit();`);
    await assert.rejects(save(id(4), "student", false), /Injected audit failure/);
    await db.exec("drop trigger test_audit_failure on public.audit_logs");
    assert.equal(
      (await db.query("select is_active from public.profiles where id=$1", [id(4)])).rows[0]
        .is_active,
      true,
    );
    assert.equal(
      (await db.query("select role from public.user_roles where user_id=$1", [id(4)])).rows[0].role,
      "faculty",
    );
  });
  await check("fresh accounts inherit the verified admin institute", async () => {
    await db.query("insert into auth.users values($1,'new@example.invalid','{}')", [id(40)]);
    await assert.rejects(save(id(40)), /outside your institute/);
    await save(id(40), "student", true, true);
    assert.equal(
      (await db.query("select institute_id from public.profiles where id=$1", [id(40)])).rows[0]
        .institute_id,
      pt,
    );
    await assert.rejects(save(id(40), "faculty", true, true), /already been configured/);
  });
  await check("disabled or unassigned admins fail fresh authorization", async () => {
    await db.query("update public.profiles set is_active=false where id=$1", [id(28)]);
    await assert.rejects(save(id(29), "student", true, false, id(28)), /active admin/);
    await asUser("authenticated", id(28), () =>
      assert.rejects(db.query("select public.admin_dashboard_overview()"), /active admin/),
    );
    await db.query("update public.profiles set is_active=true,institute_id=null where id=$1", [
      id(28),
    ]);
    await assert.rejects(save(id(29), "student", true, false, id(28)), /needs an institute/);
  });
  await check(
    "activity is scoped and does not disclose outside-institute profile data",
    async () => {
      await db.query(
        "insert into public.audit_logs(actor_id,target_id,institute_id,action,details) values($1,$2,$3,'user_updated','{\"private\":\"outside campus\",\"actor_roles\":[\"super_admin\"]}'),($1,$2,$4,'sign_in','{}')",
        [id(29), id(30), pt, q6],
      );
      await asUser("authenticated", id(1), async () => {
        const activity = await data(
          "select public.admin_dashboard_activity('','user_updated','super_admin') data",
        );
        assert.equal(activity.total, 1);
        assert.equal(activity.items[0].actor_email, null);
        assert.equal(activity.items[0].target_name, null);
        assert.deepEqual(activity.items[0].details, {});
        assert.equal(
          (await data("select public.admin_dashboard_activity('fixture29') data")).total,
          0,
        );
        const all = await data("select public.admin_dashboard_activity() data");
        assert.ok(all.items.every((row) => row.institute_code === "PT"));
      });
    },
  );
  console.log(`${passed} admin database checks passed.`);
} finally {
  await db.close();
}
