-- M02 academic-structure database checks. Run ONLY against an isolated copy of the schema.
--   docker exec -i <scratch-container> psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/m02_academic_guards.sql
-- Uses synthetic identities. It drops and recreates schema m02t and truncates the seeded tables.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

drop schema if exists m02t cascade;
create schema m02t;
create table m02t.results (n serial, name text, ok boolean, detail text);

create function m02t.q(uid uuid, stmt text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end $$;

create function m02t.check(name text, ok boolean, detail text default null) returns void
language sql as $$ insert into m02t.results(name, ok, detail) values (name, coalesce(ok, false), detail) $$;

-- Synthetic data -------------------------------------------------------------------
truncate public.class_members, public.join_codes, public.classes, public.sections, public.branches,
         public.institutes, public.profiles, public.academic_years, public.admin_roles cascade;
delete from auth.users where email like '%@m02.test';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin.pt@m02.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin.q6@m02.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'fac1@m02.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fac2@m02.test'),
  ('00000000-0000-0000-0000-0000000000b1', 's1@m02.test'),
  ('00000000-0000-0000-0000-0000000000b2', 's2@m02.test'),
  ('00000000-0000-0000-0000-0000000000b3', 's3@m02.test'),
  ('00000000-0000-0000-0000-0000000000b4', 's4@m02.test'),
  ('00000000-0000-0000-0000-0000000000b5', 's5@m02.test');

insert into public.institutes (id, code, name) values
  ('00000000-0000-0000-0000-00000000001a', 'PT', 'Campus PT'),
  ('00000000-0000-0000-0000-00000000001b', 'Q6', 'Campus Q6');
insert into public.academic_years (id, name, start_date, end_date, is_active)
  values ('00000000-0000-0000-0000-00000000002a', '2026-27', '2026-06-15', '2027-04-30', true);
insert into public.branches (id, code, name, roll_code)
  values ('00000000-0000-0000-0000-00000000003a', 'CSE', 'Computer Science', '05');
insert into public.sections (id, branch_id, year, name, institute_id) values
  ('00000000-0000-0000-0000-00000000004a', '00000000-0000-0000-0000-00000000003a', 2, 'A', '00000000-0000-0000-0000-00000000001a'),
  ('00000000-0000-0000-0000-00000000004b', '00000000-0000-0000-0000-00000000003a', 2, 'A', '00000000-0000-0000-0000-00000000001b');

insert into public.admin_roles (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Academics admin');
insert into public.admin_role_permissions (role_id, module, action)
  select '00000000-0000-0000-0000-0000000000d1', m, 'manage' from unnest(array['academics','users','settings']) m;

insert into public.profiles (id, role, full_name, email, institute_id, branch_id, section_id, year, roll_number, admin_role_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin',   'Admin PT',  'admin.pt@m02.test', '00000000-0000-0000-0000-00000000001a', null, null, null, null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',   'Admin Q6',  'admin.q6@m02.test', '00000000-0000-0000-0000-00000000001b', null, null, null, null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000f1', 'faculty', 'Faculty 1', 'fac1@m02.test',     '00000000-0000-0000-0000-00000000001a', null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000000f2', 'faculty', 'Faculty 2', 'fac2@m02.test',     '00000000-0000-0000-0000-00000000001a', null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000000b1', 'student', 'Student 1', 's1@m02.test', '00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004a', 2, '25PT1A0501', null),
  ('00000000-0000-0000-0000-0000000000b2', 'student', 'Student 2', 's2@m02.test', '00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004a', 2, '25PT1A0502', null),
  ('00000000-0000-0000-0000-0000000000b3', 'student', 'Student 3', 's3@m02.test', '00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004b', 2, '25Q61A0501', null),
  ('00000000-0000-0000-0000-0000000000b4', 'student', 'Student 4', 's4@m02.test', '00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004a', 2, '25PT1A0504', null),
  ('00000000-0000-0000-0000-0000000000b5', 'student', 'Student 5', 's5@m02.test', '00000000-0000-0000-0000-00000000001a', null, null, null, '25PT1A0505', null);

insert into public.classes (id, name, faculty_id, institute_id, academic_year_id, year, branch_id, section_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'PT-II-CSE-A', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000002a', 2, '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004a'),
  ('00000000-0000-0000-0000-0000000000c2', 'PT-Extra',    '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000001a', null, null, null, null),
  ('00000000-0000-0000-0000-0000000000c3', 'Q6-II-CSE-A', null,                                   '00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000002a', 2, '00000000-0000-0000-0000-00000000003a', '00000000-0000-0000-0000-00000000004b');
insert into public.class_members (class_id, student_id, status) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', 'active'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b3', 'active'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b4', 'removed');
insert into public.join_codes (class_id, code, created_by)
  values ('00000000-0000-0000-0000-0000000000c2', 'M02-TEST', '00000000-0000-0000-0000-0000000000a1');
insert into public.access_settings (id, allow_unassigned) values (true, true)
  on conflict (id) do update set allow_unassigned = true;

set session_replication_role = origin;

-- Faculty isolation -------------------------------------------------------------------
select m02t.check('faculty sees only students of own classes',
  m02t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.profiles where id in (
    '00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b5',
    '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000f2')$$) = '0');
select m02t.check('faculty sees an enrolled student',
  m02t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.profiles where id='00000000-0000-0000-0000-0000000000b1'$$) = '1');
select m02t.check('faculty cannot see a student whose membership was removed',
  m02t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.profiles where id='00000000-0000-0000-0000-0000000000b4'$$) = '0');
select m02t.check('faculty cannot see other classes, members or join codes',
  m02t.q('00000000-0000-0000-0000-0000000000f1', $$select (select count(*) from public.classes where id in ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3'))
    + (select count(*) from public.class_members where class_id in ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3'))
    + (select count(*) from public.join_codes where class_id='00000000-0000-0000-0000-0000000000c2')$$) = '0');
select m02t.check('class without a trainer is allowed and invisible to faculty',
  (select count(*) from public.classes where faculty_id is null) = 1
  and m02t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.classes where id='00000000-0000-0000-0000-0000000000c3'$$) = '0');

-- Students cannot edit their own placement or enrol themselves -------------------------
select m02t.check('student cannot change own section',
  m02t.q('00000000-0000-0000-0000-0000000000b1', $$with u as (update public.profiles set section_id=null where id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from u$$) like 'ERR%');
select m02t.check('student cannot change own institute, branch, year or roll number',
  m02t.q('00000000-0000-0000-0000-0000000000b1', $$with u as (update public.profiles set institute_id='00000000-0000-0000-0000-00000000001b' where id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from u$$) like 'ERR%'
  and m02t.q('00000000-0000-0000-0000-0000000000b1', $$with u as (update public.profiles set roll_number='25PT1A0599' where id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from u$$) like 'ERR%');
select m02t.check('student cannot enrol themselves',
  m02t.q('00000000-0000-0000-0000-0000000000b1', $$insert into public.class_members(class_id,student_id,enrollment_source) values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b1','admin') returning 1$$) like 'ERR%');
select m02t.check('student cannot read other students',
  m02t.q('00000000-0000-0000-0000-0000000000b1', $$select count(*) from public.profiles where id='00000000-0000-0000-0000-0000000000b2'$$) = '0');

-- Institute boundary for a plain institute admin ----------------------------------------
select m02t.check('institute admin cannot read another institute''s students',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.profiles where id='00000000-0000-0000-0000-0000000000b3'$$) = '0');
select m02t.check('institute admin cannot read another institute''s classes',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.classes where id='00000000-0000-0000-0000-0000000000c3'$$) = '0');
select m02t.check('institute admin cannot move a student between institutes',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$with u as (update public.profiles set institute_id='00000000-0000-0000-0000-00000000001a' where id='00000000-0000-0000-0000-0000000000b3' returning 1) select count(*) from u$$) in ('0') or
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$with u as (update public.profiles set institute_id='00000000-0000-0000-0000-00000000001a' where id='00000000-0000-0000-0000-0000000000b3' returning 1) select count(*) from u$$) like 'ERR%');
select m02t.check('institute admin cannot enrol another institute''s student',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.class_members(class_id,student_id,enrollment_source) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b3','admin') returning 1$$) like 'ERR%');
select m02t.check('institute admin cannot enrol into another institute''s class',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.class_members(class_id,student_id,enrollment_source) values ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000b1','admin') returning 1$$) like 'ERR%');
select m02t.check('institute admin cannot delete another institute''s class',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$with d as (delete from public.classes where id='00000000-0000-0000-0000-0000000000c3' returning 1) select count(*) from d$$) in ('0'));

-- Enrolment persistence and integrity ---------------------------------------------------
select m02t.check('valid admin enrolment is stored and visible to the student in a new session',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.class_members(class_id,student_id,enrollment_source) values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b5','admin') returning 1$$) = '1'
  and m02t.q('00000000-0000-0000-0000-0000000000b5', $$select count(*) from public.class_members where class_id='00000000-0000-0000-0000-0000000000c2' and student_id='00000000-0000-0000-0000-0000000000b5'$$) = '1');
select m02t.check('duplicate enrolment is rejected',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.class_members(class_id,student_id,enrollment_source) values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b5','admin') returning 1$$) like 'ERR%');
select m02t.check('roll numbers are unique case-insensitively',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$update public.profiles set roll_number='25pt1a0501' where id='00000000-0000-0000-0000-0000000000b2' returning 1$$) like 'ERR%');
select m02t.check('duplicate class structure is rejected',
  m02t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.classes(name,institute_id,academic_year_id,year,branch_id,section_id) values ('dup','00000000-0000-0000-0000-00000000001a','00000000-0000-0000-0000-00000000002a',2,'00000000-0000-0000-0000-00000000003a','00000000-0000-0000-0000-00000000004a') returning 1$$) like 'ERR%');
delete from public.class_members where class_id='00000000-0000-0000-0000-0000000000c2' and student_id='00000000-0000-0000-0000-0000000000b5';

-- Login gates ---------------------------------------------------------------------------
select m02t.check('both gates are inactive until a restriction is applied',
  not public.class_login_restricted() and not public.department_login_restricted()
  and public.login_allowed_for('00000000-0000-0000-0000-0000000000b1')
  and public.login_allowed_for('00000000-0000-0000-0000-0000000000b5'));

update public.classes set login_enabled=false where id='00000000-0000-0000-0000-0000000000c2';
select m02t.check('a class restriction does not activate the department gate',
  public.class_login_restricted() and not public.department_login_restricted()
  and public.login_allowed_for('00000000-0000-0000-0000-0000000000b1')
  and not public.login_allowed_for('00000000-0000-0000-0000-0000000000b2'));
update public.classes set login_enabled=true where id='00000000-0000-0000-0000-0000000000c2';

update public.branches set login_enabled=false where id='00000000-0000-0000-0000-00000000003a';
select m02t.check('a department restriction does not activate the class gate',
  public.department_login_restricted() and not public.class_login_restricted()
  and not public.login_allowed_for('00000000-0000-0000-0000-0000000000b1'));
update public.branches set login_enabled=true where id='00000000-0000-0000-0000-00000000003a';

-- Unassigned students (no branch, no class) follow allow_unassigned only once a gate is active.
update public.classes set login_enabled=false where id='00000000-0000-0000-0000-0000000000c2';
update public.access_settings set allow_unassigned=false where id;
select m02t.check('unassigned students are blocked when allow_unassigned is off and a gate is active',
  not public.login_allowed_for('00000000-0000-0000-0000-0000000000b5'));
update public.access_settings set allow_unassigned=true where id;
select m02t.check('unassigned students are admitted when allow_unassigned is on',
  public.login_allowed_for('00000000-0000-0000-0000-0000000000b5'));
update public.classes set login_enabled=true where id='00000000-0000-0000-0000-0000000000c2';
update public.access_settings set allow_unassigned=false where id;
select m02t.check('allow_unassigned has no effect while no gate is active',
  public.login_allowed_for('00000000-0000-0000-0000-0000000000b5'));
update public.access_settings set allow_unassigned=true where id;

-- A removed membership must not count as enrolment for the class gate.
update public.classes set login_enabled=false where id='00000000-0000-0000-0000-0000000000c1';
select m02t.check('a removed membership does not tie a student to a restricted class',
  public.login_allowed_for('00000000-0000-0000-0000-0000000000b4'));
update public.classes set login_enabled=true where id='00000000-0000-0000-0000-0000000000c1';

\echo
\echo === M02 database check results ===
select case when ok then 'PASS' else 'FAIL' end as result, name from m02t.results order by n;
select count(*) filter (where not ok) as failed, count(*) as total from m02t.results;
