-- M03 content-access database checks. Run ONLY against an isolated copy of the schema.
--   docker exec -i <scratch-container> psql -U supabase_admin -d postgres -q -At -v ON_ERROR_STOP=1 < supabase/tests/m03_content_guards.sql
-- Synthetic identities and content. Drops/recreates schema m03t and truncates topics and profiles.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

drop schema if exists m03t cascade;
create schema m03t;
create table m03t.results (n serial, name text, ok boolean);

create function m03t.q(uid uuid, stmt text) returns text language plpgsql as $$
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

create function m03t.check(name text, ok boolean) returns void language sql as $$
  insert into m03t.results(name, ok) values (name, coalesce(ok, false)) $$;

-- Storage prerequisites (the schema dump covers only public; a stock image has no storage schema) --
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select on storage.buckets, storage.objects to authenticated;
insert into storage.buckets (id, name, public) values ('cheat-sheets', 'cheat-sheets', false) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cheat_sheets_read') then
    create policy cheat_sheets_read on storage.objects for select to authenticated using (bucket_id = 'cheat-sheets');
  end if;
end $$;
delete from storage.objects where bucket_id = 'cheat-sheets';

-- Synthetic data ----------------------------------------------------------------------------------
truncate public.topics, public.profiles cascade;
delete from auth.users where email like '%@m03.test';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'stu1@m03.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'stu2@m03.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'stu.disabled@m03.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'fac@m03.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fac.disabled@m03.test');
insert into public.profiles (id, role, full_name, email, is_disabled) values
  ('00000000-0000-0000-0000-0000000000a1', 'student', 'Student 1', 'stu1@m03.test', false),
  ('00000000-0000-0000-0000-0000000000a2', 'student', 'Student 2', 'stu2@m03.test', false),
  ('00000000-0000-0000-0000-0000000000a3', 'student', 'Student Disabled', 'stu.disabled@m03.test', true),
  ('00000000-0000-0000-0000-0000000000f1', 'faculty', 'Faculty', 'fac@m03.test', false),
  ('00000000-0000-0000-0000-0000000000f2', 'faculty', 'Faculty Disabled', 'fac.disabled@m03.test', true);

insert into public.topics (id, name, position, is_published) values
  ('00000000-0000-0000-0000-0000000000d1', 'Published topic', 1, true),
  ('00000000-0000-0000-0000-0000000000d2', 'Draft topic', 2, false);
insert into public.sheets (id, topic_id, title, position, source_url, content, content_hash, is_published, pdf_storage_path) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Sheet 1', 1, 'x', '[]', 'h1', true,  'd1/s1.pdf'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'Sheet 2', 2, 'x', '[]', 'h2', true,  null),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'Draft sheet', 3, 'x', '[]', 'h3', false, 'd1/draft.pdf'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d2', 'In draft topic', 1, 'x', '[]', 'h4', true,  'd2/s4.pdf');
insert into storage.objects (bucket_id, name) values
  ('cheat-sheets', 'd1/s1.pdf'), ('cheat-sheets', 'd1/draft.pdf'), ('cheat-sheets', 'd2/s4.pdf'), ('cheat-sheets', 'orphan.pdf');

set session_replication_role = origin;

-- Reading ------------------------------------------------------------------------------------------
select m03t.check('student reads a published sheet in a published topic',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sheets where id='00000000-0000-0000-0000-0000000000e1'$$) = '1');
select m03t.check('student cannot read an unpublished sheet',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sheets where id='00000000-0000-0000-0000-0000000000e3'$$) = '0');
select m03t.check('student cannot read an unpublished topic',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.topics where id='00000000-0000-0000-0000-0000000000d2'$$) = '0');
select m03t.check('student cannot read a published sheet inside an unpublished topic',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sheets where id='00000000-0000-0000-0000-0000000000e4'$$) = '0');
select m03t.check('faculty reads drafts for review',
  m03t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.sheets$$) = '4'
  and m03t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.topics$$) = '2');
select m03t.check('disabled faculty cannot read drafts',
  m03t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.sheets where is_published = false$$) = '0');
select m03t.check('disabled student cannot read content',
  m03t.q('00000000-0000-0000-0000-0000000000a3', $$select count(*) from public.sheets$$) = '0');

-- Lesson PDFs --------------------------------------------------------------------------------------
select m03t.check('student can reach the pdf of a published lesson',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from storage.objects where bucket_id='cheat-sheets' and name='d1/s1.pdf'$$) = '1');
select m03t.check('student cannot reach the pdf of an unpublished lesson',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from storage.objects where bucket_id='cheat-sheets' and name='d1/draft.pdf'$$) = '0');
select m03t.check('student cannot reach the pdf of a lesson in an unpublished topic',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from storage.objects where bucket_id='cheat-sheets' and name='d2/s4.pdf'$$) = '0');
select m03t.check('student cannot reach a file that belongs to no lesson',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from storage.objects where bucket_id='cheat-sheets' and name='orphan.pdf'$$) = '0');
select m03t.check('disabled student cannot reach any pdf',
  m03t.q('00000000-0000-0000-0000-0000000000a3', $$select count(*) from storage.objects where bucket_id='cheat-sheets'$$) = '0');
select m03t.check('active faculty can reach every pdf for review',
  m03t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from storage.objects where bucket_id='cheat-sheets'$$) = '4');

-- Publishing ---------------------------------------------------------------------------------------
select m03t.check('student cannot publish a sheet',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$select public.set_sheet_published('00000000-0000-0000-0000-0000000000e3', true)::text$$) like 'ERR%');
select m03t.check('disabled faculty cannot publish',
  m03t.q('00000000-0000-0000-0000-0000000000f2', $$select public.set_sheet_published('00000000-0000-0000-0000-0000000000e3', true)::text$$) like 'ERR%');
select m03t.check('publishing an unknown id is an error, not a silent no-op',
  m03t.q('00000000-0000-0000-0000-0000000000f1', $$select public.set_sheet_published('00000000-0000-0000-0000-00000000ffff', true)::text$$) like 'ERR%');
select m03t.check('faculty publishes a sheet and students then see it',
  m03t.q('00000000-0000-0000-0000-0000000000f1', $$select public.set_sheet_published('00000000-0000-0000-0000-0000000000e3', true)::text$$) not like 'ERR%'
  and m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sheets where id='00000000-0000-0000-0000-0000000000e3'$$) = '1');
select m03t.check('faculty can unpublish again',
  m03t.q('00000000-0000-0000-0000-0000000000f1', $$select public.set_sheet_published('00000000-0000-0000-0000-0000000000e3', false)::text$$) not like 'ERR%'
  and m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sheets where id='00000000-0000-0000-0000-0000000000e3'$$) = '0');

-- Progress and the sequential gate --------------------------------------------------------------
select m03t.check('student cannot record progress on a locked (second) sheet',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','completed') returning 1$$) like 'ERR%');
select m03t.check('student cannot record progress on an unpublished sheet',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e3','completed') returning 1$$) like 'ERR%');
select m03t.check('student cannot record progress on a sheet in an unpublished topic',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e4','completed') returning 1$$) like 'ERR%');
select m03t.check('student cannot write progress for another student',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e1','completed') returning 1$$) like 'ERR%');
select m03t.check('student records progress on the first sheet',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','in_progress') returning 1$$) = '1'
  and m03t.q('00000000-0000-0000-0000-0000000000a1', $$update public.lesson_progress set status='completed' where student_id='00000000-0000-0000-0000-0000000000a1' and sheet_id='00000000-0000-0000-0000-0000000000e1' returning 1$$) = '1');
select m03t.check('the second sheet unlocks once the first is complete, and progress persists',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','completed') returning 1$$) = '1'
  and m03t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.lesson_progress where student_id='00000000-0000-0000-0000-0000000000a1' and status='completed'$$) = '2');
select m03t.check('a completed lesson cannot be moved back',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$update public.lesson_progress set status='in_progress' where student_id='00000000-0000-0000-0000-0000000000a1' and sheet_id='00000000-0000-0000-0000-0000000000e1' returning 1$$) like 'ERR%');
insert into public.sheets (id, topic_id, title, position, source_url, content, content_hash, is_published)
  values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'Inserted early', 0, 'x', '[]', 'h5', true);
select m03t.check('a completed lesson stays writable as completed after a new earlier sheet is added',
  m03t.q('00000000-0000-0000-0000-0000000000a1', $$update public.lesson_progress set status='completed' where student_id='00000000-0000-0000-0000-0000000000a1' and sheet_id='00000000-0000-0000-0000-0000000000e2' returning 1$$) = '1');
select m03t.check('other students cannot read this student''s progress',
  m03t.q('00000000-0000-0000-0000-0000000000a2', $$select count(*) from public.lesson_progress$$) = '0');
select m03t.check('a disabled student cannot record progress',
  m03t.q('00000000-0000-0000-0000-0000000000a3', $$insert into public.lesson_progress(student_id,sheet_id,status) values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000e1','completed') returning 1$$) like 'ERR%');

\echo
\echo === M03 database check results ===
select case when ok then 'PASS' else 'FAIL' end || '|' || name from m03t.results order by n;
select count(*) filter (where not ok) || '|' || count(*) as failed_total from m03t.results;
