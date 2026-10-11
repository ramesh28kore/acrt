-- M04 coding-practice database checks. Run ONLY against an isolated copy of the schema.
--   docker exec -i <scratch> psql -U supabase_admin -d postgres -q -At -v ON_ERROR_STOP=1 < supabase/tests/m04_coding_guards.sql
-- Synthetic identities and content. Drops/recreates schema m04t and truncates the content, profile and activity tables.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

drop schema if exists m04t cascade;
create schema m04t;
create table m04t.results (n serial, name text, ok boolean);

-- Runs a statement as an authenticated user (uid) or as service_role (uid null).
create function m04t.q(uid uuid, stmt text, db_role text default 'authenticated') returns text language plpgsql as $$
declare r text;
begin
  if uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', db_role)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', db_role)::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
  end if;
  execute 'set local role ' || quote_ident(db_role);
  begin
    execute stmt into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end $$;

create function m04t.check(name text, ok boolean) returns void language sql as $$
  insert into m04t.results(name, ok) values (name, coalesce(ok, false)) $$;

-- Synthetic data -----------------------------------------------------------------------------
truncate public.topics, public.profiles, public.attendance cascade;
delete from auth.users where email like '%@m04.test';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'stu1@m04.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'stu2@m04.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'stu.disabled@m04.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'fac.assigned@m04.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fac.other@m04.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'fac.disabled@m04.test');
insert into public.profiles (id, role, full_name, email, is_disabled) values
  ('00000000-0000-0000-0000-0000000000a1', 'student', 'Student 1', 'stu1@m04.test', false),
  ('00000000-0000-0000-0000-0000000000a2', 'student', 'Student 2', 'stu2@m04.test', false),
  ('00000000-0000-0000-0000-0000000000a3', 'student', 'Student Disabled', 'stu.disabled@m04.test', true),
  ('00000000-0000-0000-0000-0000000000f1', 'faculty', 'Faculty Assigned', 'fac.assigned@m04.test', false),
  ('00000000-0000-0000-0000-0000000000f2', 'faculty', 'Faculty Other', 'fac.other@m04.test', false),
  ('00000000-0000-0000-0000-0000000000f3', 'faculty', 'Faculty Disabled', 'fac.disabled@m04.test', true);
insert into public.classes (id, name, faculty_id) values ('00000000-0000-0000-0000-0000000000c1', 'Class A', '00000000-0000-0000-0000-0000000000f1');
insert into public.class_members (class_id, student_id, status) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'active');

insert into public.topics (id, name, position, is_published) values
  ('00000000-0000-0000-0000-0000000000d1', 'Live topic', 1, true),
  ('00000000-0000-0000-0000-0000000000d2', 'Draft topic', 2, false);
insert into public.sets (id, topic_id, name, kind, position, is_published) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Live set', 'practice', 1, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'Draft set', 'practice', 2, false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'Set in draft topic', 'practice', 1, true);
insert into public.problems (id, set_id, topic_id, title, source_url, position, content, content_hash) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Live problem', 'x', 1, '[]', 'h1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'In draft set', 'x', 1, '[]', 'h2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'In draft topic', 'x', 1, '[]', 'h3'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'No validation', 'x', 2, '[]', 'h4'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Unpublished solution', 'x', 3, '[]', 'h5');
insert into public.test_cases (problem_id, input, expected_output, is_sample, position) values
  ('00000000-0000-0000-0000-0000000000b1', '1', '1', true, 1),
  ('00000000-0000-0000-0000-0000000000b1', 'secret-hidden-input', 'secret-hidden-output', false, 2);
insert into public.problem_solutions (problem_id, solution, language, approach, explanation, time_complexity, space_complexity, is_published) values
  ('00000000-0000-0000-0000-0000000000b1', 'print(input())', 'python', 'echo', 'It echoes.', 'O(1)', 'O(1)', true),
  ('00000000-0000-0000-0000-0000000000b4', 'print(2)', 'python', 'a', 'b', 'O(1)', 'O(1)', true),
  ('00000000-0000-0000-0000-0000000000b5', 'print(3)', 'python', 'a', 'b', 'O(1)', 'O(1)', false);
insert into public.problem_validations (problem_id, status, passed_count, total_count) values
  ('00000000-0000-0000-0000-0000000000b1', 'passed', 2, 2),
  ('00000000-0000-0000-0000-0000000000b4', 'failed', 0, 1),
  ('00000000-0000-0000-0000-0000000000b5', 'passed', 1, 1);
insert into public.problem_tutorials (problem_id, understand_problem, pseudocode, hints, is_published) values
  ('00000000-0000-0000-0000-0000000000b1', 'Read a number and print it.', 'read x; print x', '["Think about input()"]', true);

insert into public.feature_flags (key, label, enabled) values ('playground', 'Playground', true)
  on conflict (key) do update set enabled = true;

set session_replication_role = origin;

-- Problem and test-case visibility -----------------------------------------------------------------
select m04t.check('student reads a published problem',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.problems where id='00000000-0000-0000-0000-0000000000b1'$$) = '1');
select m04t.check('student cannot read a problem in an unpublished set',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.problems where id='00000000-0000-0000-0000-0000000000b2'$$) = '0');
select m04t.check('student cannot read a problem in an unpublished topic',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.problems where id='00000000-0000-0000-0000-0000000000b3'$$) = '0');
select m04t.check('student cannot read an unpublished set',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.sets where id in ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e3')$$) = '0');
select m04t.check('active faculty reviews every problem',
  m04t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.problems$$) = '5');
select m04t.check('disabled student and disabled faculty read no problems',
  m04t.q('00000000-0000-0000-0000-0000000000a3', $$select count(*) from public.problems$$) = '0'
  and m04t.q('00000000-0000-0000-0000-0000000000f3', $$select count(*) from public.problems$$) = '0');
select m04t.check('student sees sample test cases only',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.test_cases where is_sample$$) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.test_cases where not is_sample$$) = '0');
select m04t.check('hidden input and expected output never appear in any student-readable column',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.test_cases where input like '%secret-hidden%' or expected_output like '%secret-hidden%'$$) = '0');
select m04t.check('staff read hidden test cases',
  m04t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.test_cases where not is_sample$$) = '1');
select m04t.check('disabled faculty cannot read hidden test cases',
  m04t.q('00000000-0000-0000-0000-0000000000f3', $$select count(*) from public.test_cases$$) = '0');
select m04t.check('students have no direct access to solutions, tutorials or validations',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select (select count(*) from public.problem_solutions)+(select count(*) from public.problem_tutorials)+(select count(*) from public.problem_validations)$$) = '0');
select m04t.check('disabled faculty cannot read solutions',
  m04t.q('00000000-0000-0000-0000-0000000000f3', $$select count(*) from public.problem_solutions$$) = '0');

-- Submissions cannot be forged -----------------------------------------------------------------------
select m04t.check('student cannot insert a submission directly',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.submissions(student_id,problem_id,code,language,status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','passed') returning 1$$) like 'ERR%');
select m04t.check('student cannot rewrite a submission status',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$update public.submissions set status='passed' where student_id='00000000-0000-0000-0000-0000000000a1' returning 1$$) like 'ERR%'
  or m04t.q('00000000-0000-0000-0000-0000000000a1', $$with u as (update public.submissions set status='passed' where student_id='00000000-0000-0000-0000-0000000000a1' returning 1) select count(*) from u$$) = '0');
select m04t.check('record function is not callable by signed-in users',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','passed','{}'::jsonb)::text$$) like 'ERR%');
select m04t.check('graded result is stored through the service function',
  m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','print(1)','python','failed','{"verdict":"WRONG_ANSWER"}'::jsonb) is not null$$, 'service_role') = 'true');
select m04t.check('the stored row carries the student, problem, status and verdict',
  (select count(*) from public.submissions where student_id='00000000-0000-0000-0000-0000000000a1' and problem_id='00000000-0000-0000-0000-0000000000b1' and status='failed' and results->>'verdict'='WRONG_ANSWER') = 1);
select m04t.check('a graded submission credits the student with attendance',
  (select count(*) from public.attendance where student_id='00000000-0000-0000-0000-0000000000a1') = 1);
select m04t.check('invalid status, language and oversize code are rejected',
  m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','hacked','{}'::jsonb)::text$$, 'service_role') like 'ERR%'
  and m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','cobol','passed','{}'::jsonb)::text$$, 'service_role') like 'ERR%'
  and m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',repeat('x',70000),'python','passed','{}'::jsonb)::text$$, 'service_role') like 'ERR%');
select m04t.check('a student cannot be graded on an unpublished problem or when disabled',
  m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','x','python','passed','{}'::jsonb)::text$$, 'service_role') like 'ERR%'
  and m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1','x','python','passed','{}'::jsonb)::text$$, 'service_role') like 'ERR%');

-- User isolation of submissions
select m04t.check('a student sees only their own submissions',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.submissions$$) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000a2', $$select count(*) from public.submissions$$) = '0');
select m04t.check('assigned faculty sees the student''s submission, other faculty do not',
  m04t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.submissions$$) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.submissions$$) = '0');

-- Rate limiting at the database ---------------------------------------------------------------------
do $$ declare i int; begin
  for i in 1..9 loop
    perform m04t.q(null, $q$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb)::text$q$, 'service_role');
  end loop;
end $$;
select m04t.check('ten submissions per minute are accepted',
  (select count(*) from public.submissions where student_id='00000000-0000-0000-0000-0000000000a2') = 9
  and m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb) is not null$$, 'service_role') = 'true');
select m04t.check('the eleventh submission within a minute is rejected',
  m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb)::text$$, 'service_role') like 'ERR%');

-- Solution reveal rules -------------------------------------------------------------------------------
-- Student 2 now holds 10 failed attempts on problem b1; student 1 has one. Reset to a clean slate.
delete from public.submissions;
select m04t.check('solution is withheld before any attempt',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) like '%"ok": false%'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) not like '%print(input())%');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb)::text$$, 'service_role');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb)::text$$, 'service_role');
select m04t.check('two failed attempts do not unlock the solution',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) not like '%print(input())%');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','x','python','failed','{}'::jsonb)::text$$, 'service_role');
select m04t.check('three graded attempts unlock the solution',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) like '%print(input())%');
select m04t.check('another student''s attempts do not unlock it',
  m04t.q('00000000-0000-0000-0000-0000000000a2', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) not like '%print(input())%');
delete from public.submissions;
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','ok','python','passed','{}'::jsonb)::text$$, 'service_role');
select m04t.check('one accepted submission unlocks the solution',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) like '%print(input())%');
select m04t.check('a disabled student gets nothing',
  m04t.q('00000000-0000-0000-0000-0000000000a3', $$select public.student_solution('00000000-0000-0000-0000-0000000000b1')::text$$) not like '%print(input())%');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b4','ok','python','passed','{}'::jsonb)::text$$, 'service_role');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b5','ok','python','passed','{}'::jsonb)::text$$, 'service_role');
select m04t.check('a solution that failed validation is never revealed',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b4')::text$$) not like '%print(2)%');
select m04t.check('an unpublished solution is never revealed',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_solution('00000000-0000-0000-0000-0000000000b5')::text$$) not like '%print(3)%');

-- Tutorial: teaching sections early, final code gated -----------------------------------------------
delete from public.submissions;
select m04t.check('the tutorial shows teaching sections before a pass but withholds the final code',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_tutorial('00000000-0000-0000-0000-0000000000b1')::text$$) like '%Read a number and print it.%'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_tutorial('00000000-0000-0000-0000-0000000000b1')::text$$) not like '%print(input())%'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_tutorial('00000000-0000-0000-0000-0000000000b1')::text$$) like '%"codeLocked": true%');
select m04t.q(null, $$select public.record_graded_submission('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','ok','python','passed','{}'::jsonb)::text$$, 'service_role');
select m04t.check('the final code appears in the tutorial once earned',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_tutorial('00000000-0000-0000-0000-0000000000b1')::text$$) like '%print(input())%');
select m04t.check('the tutorial of a problem without a verified solution is withheld',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$select public.student_tutorial('00000000-0000-0000-0000-0000000000b4')::text$$) like '%"ok": false%');

-- Practice drafts ----------------------------------------------------------------------------------
select m04t.check('a student saves and reloads a draft',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.practice_drafts(student_id,problem_id,language,code) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','python','x = 1') returning 1$$) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$select code from public.practice_drafts where problem_id='00000000-0000-0000-0000-0000000000b1'$$) = 'x = 1');
select m04t.check('drafts are private to their owner, including from faculty',
  m04t.q('00000000-0000-0000-0000-0000000000a2', $$select count(*) from public.practice_drafts$$) = '0'
  and m04t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.practice_drafts$$) = '0');
select m04t.check('a draft cannot be written for another student or an unpublished problem',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.practice_drafts(student_id,problem_id,language,code) values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','python','x') returning 1$$) like 'ERR%'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.practice_drafts(student_id,problem_id,language,code) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2','python','x') returning 1$$) like 'ERR%');
select m04t.check('an oversized draft is rejected',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$update public.practice_drafts set code=repeat('x',70000) where problem_id='00000000-0000-0000-0000-0000000000b1' returning 1$$) like 'ERR%');
select m04t.check('a disabled student cannot save drafts',
  m04t.q('00000000-0000-0000-0000-0000000000a3', $$insert into public.practice_drafts(student_id,problem_id,language,code) values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1','python','x') returning 1$$) like 'ERR%');

-- Playground -----------------------------------------------------------------------------------------
select m04t.check('a student saves a playground program that only they can read',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.playground_programs(owner_id,title,language,code) values ('00000000-0000-0000-0000-0000000000a1','Mine','python','print(1)') returning 1$$) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000a2', $$select count(*) from public.playground_programs$$) = '0'
  and m04t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.playground_programs$$) = '0');
select m04t.check('a playground program cannot be saved with an unknown language or oversize code',
  m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.playground_programs(owner_id,title,language,code) values ('00000000-0000-0000-0000-0000000000a1','x','cobol','x') returning 1$$) like 'ERR%'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.playground_programs(owner_id,title,language,code) values ('00000000-0000-0000-0000-0000000000a1','x','python',repeat('x',70000)) returning 1$$) like 'ERR%');
do $$ declare i int; begin
  for i in 1..60 loop
    perform m04t.q('00000000-0000-0000-0000-0000000000a2', format($q$insert into public.playground_programs(owner_id,title,language,code) values ('00000000-0000-0000-0000-0000000000a2','p%s','python','x') returning 1$q$, i));
  end loop;
end $$;
select m04t.check('a student can keep at most 50 saved programs',
  (select count(*) from public.playground_programs where owner_id='00000000-0000-0000-0000-0000000000a2') = 50);
select m04t.check('the playground feature flag switches saving off for students',
  (select m04t.q(null, $$update public.feature_flags set enabled=false where key='playground' returning 1$$, 'service_role')) = '1'
  and m04t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.playground_programs(owner_id,title,language,code) values ('00000000-0000-0000-0000-0000000000a1','blocked','python','x') returning 1$$) like 'ERR%');
update public.feature_flags set enabled = true where key = 'playground';

\echo
\echo === M04 database check results ===
select case when ok then 'PASS' else 'FAIL' end || '|' || name from m04t.results order by n;
select count(*) filter (where not ok) || '|' || count(*) as failed_total from m04t.results;
