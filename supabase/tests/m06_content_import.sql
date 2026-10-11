-- M06 content-import bookkeeping checks. Run ONLY against an isolated copy of the schema with the M06 migration applied.
--   docker exec -i <scratch> psql -U supabase_admin -d postgres -q -At -v ON_ERROR_STOP=1 < supabase/tests/m06_content_import.sql
-- Synthetic identities. Drops/recreates schema m06t and clears the import bookkeeping tables and profiles.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

drop schema if exists m06t cascade;
create schema m06t;
create table m06t.results (n serial, name text, ok boolean);

create function m06t.q(uid uuid, stmt text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role ' || case when uid is null then 'anon' else 'authenticated' end;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end $$;

create function m06t.su(stmt text) returns text language plpgsql as $$
declare r text;
begin
  begin
    execute stmt into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  return r;
end $$;

create function m06t.check(name text, ok boolean) returns void language sql as $$
  insert into m06t.results(name, ok) values (name, coalesce(ok, false)) $$;

truncate public.content_import_issues, public.content_import_state, public.content_import_runs cascade;
truncate public.profiles cascade;
delete from auth.users where email like '%@m06.test';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'stu@m06.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'fac@m06.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'adm@m06.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'super@m06.test');
insert into public.profiles (id, role, full_name, email, is_super_admin, is_disabled) values
  ('00000000-0000-0000-0000-0000000000a1', 'student', 'Student', 'stu@m06.test', false, false),
  ('00000000-0000-0000-0000-0000000000f1', 'faculty', 'Faculty', 'fac@m06.test', false, false),
  ('00000000-0000-0000-0000-0000000000c1', 'admin', 'Admin', 'adm@m06.test', false, false),
  ('00000000-0000-0000-0000-0000000000d1', 'admin', 'Super', 'super@m06.test', true, false);

insert into public.content_import_runs (id, command, status, target_host)
  values ('11111111-1111-1111-1111-111111111111', 'apply', 'succeeded', 'localhost');
insert into public.content_import_state (entity_type, entity_id, source_hash, written_hash, previous_row, run_id)
  values ('problem', '22222222-2222-2222-2222-222222222222', 'a', 'b', '{"title":"x"}', '11111111-1111-1111-1111-111111111111');
insert into public.content_import_issues (run_id, severity, code, message)
  values ('11111111-1111-1111-1111-111111111111', 'warning', 'w', 'synthetic');

-- Reads ----------------------------------------------------------------------------------------------------------
select m06t.check('super admin reads runs', m06t.q('00000000-0000-0000-0000-0000000000d1', 'select count(*)::text from public.content_import_runs') = '1');
select m06t.check('super admin reads state', m06t.q('00000000-0000-0000-0000-0000000000d1', 'select count(*)::text from public.content_import_state') = '1');
select m06t.check('super admin reads issues', m06t.q('00000000-0000-0000-0000-0000000000d1', 'select count(*)::text from public.content_import_issues') = '1');
select m06t.check('plain admin sees no runs', m06t.q('00000000-0000-0000-0000-0000000000c1', 'select count(*)::text from public.content_import_runs') = '0');
select m06t.check('faculty sees no state', m06t.q('00000000-0000-0000-0000-0000000000f1', 'select count(*)::text from public.content_import_state') = '0');
select m06t.check('student sees no issues', m06t.q('00000000-0000-0000-0000-0000000000a1', 'select count(*)::text from public.content_import_issues') = '0');
select m06t.check('anon cannot read runs', m06t.q(null, 'select count(*)::text from public.content_import_runs') like 'ERR:%');

-- Writes: nobody but the owner -------------------------------------------------------------------------------------
select m06t.check('super admin cannot insert run',
  m06t.q('00000000-0000-0000-0000-0000000000d1', $$insert into public.content_import_runs (command, target_host) values ('apply', 'x') returning 'ok'$$) like 'ERR:%');
select m06t.check('super admin cannot update state',
  m06t.q('00000000-0000-0000-0000-0000000000d1', $$update public.content_import_state set written_hash = 'z' returning 'ok'$$) like 'ERR:%');
select m06t.check('super admin cannot delete issues',
  m06t.q('00000000-0000-0000-0000-0000000000d1', $$delete from public.content_import_issues returning 'ok'$$) like 'ERR:%');
select m06t.check('student cannot write state',
  m06t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.content_import_state (entity_type, entity_id, source_hash, written_hash) values ('problem', gen_random_uuid(), 'a', 'b') returning 'ok'$$) like 'ERR:%');

-- Constraints ----------------------------------------------------------------------------------------------------
select m06t.check('unknown entity type rejected',
  m06t.su($$insert into public.content_import_state (entity_type, entity_id, source_hash, written_hash) values ('bogus', gen_random_uuid(), 'a', 'b') returning 'ok'$$) like 'ERR:%');
select m06t.check('answer key state cannot keep a copy',
  m06t.su($$insert into public.content_import_state (entity_type, entity_id, source_hash, written_hash, previous_row) values ('answer_key', gen_random_uuid(), 'a', 'b', '{"k":1}') returning 'ok'$$) like 'ERR:%');
select m06t.check('answer key state without a copy is allowed',
  m06t.su($$insert into public.content_import_state (entity_type, entity_id, source_hash, written_hash) values ('answer_key', gen_random_uuid(), 'a', 'b') returning 'ok'$$) = 'ok');
select m06t.check('unknown run command rejected',
  m06t.su($$insert into public.content_import_runs (command, target_host) values ('delete', 'x') returning 'ok'$$) like 'ERR:%');
select m06t.check('unknown severity rejected',
  m06t.su($$insert into public.content_import_issues (severity, code, message) values ('fatal', 'c', 'm') returning 'ok'$$) like 'ERR:%');

-- Deleting a run keeps its state rows and removes only its issues ---------------------------------------------------
-- Foreign-key actions do not fire under the replica role used for the fixtures above.
set session_replication_role = origin;
select m06t.su($$delete from public.content_import_runs where id = '11111111-1111-1111-1111-111111111111' returning 'ok'$$);
select m06t.check('deleting a run keeps state', (select count(*) from public.content_import_state where entity_type = 'problem') = 1);
select m06t.check('deleting a run clears its link', (select run_id is null from public.content_import_state where entity_type = 'problem'));
select m06t.check('deleting a run removes its issues', (select count(*) from public.content_import_issues) = 0);

-- Existing content policies are untouched ---------------------------------------------------------------------------
select m06t.check('no policy on content tables mentions import tables',
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('problems', 'mcqs', 'sheets', 'test_cases')
     and (qual ilike '%content_import%' or with_check ilike '%content_import%')) = 0);

select case when count(*) filter (where not ok) = 0 then 'PASS: ' || count(*) || ' checks' else 'FAIL: ' || string_agg(name, '; ') filter (where not ok) end
from m06t.results;
select name from m06t.results where not ok;
drop schema m06t cascade;
