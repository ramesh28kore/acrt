-- M05 MCQ quiz-engine database checks. Run ONLY against an isolated copy of the schema with the
-- M03, M04 and M05 migrations applied.
--   docker exec -i <scratch> psql -U supabase_admin -d postgres -q -At -v ON_ERROR_STOP=1 < supabase/tests/m05_quiz_guards.sql
-- Synthetic identities and content. Drops/recreates schema m05t and truncates content, profile and attempt tables.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

drop schema if exists m05t cascade;
create schema m05t;
create table m05t.results (n serial, name text, ok boolean);

-- Runs a statement as an authenticated user; a null uid runs it as the anonymous caller.
create function m05t.q(uid uuid, stmt text) returns text language plpgsql as $$
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

-- Runs a statement as the superuser, returning its text or the error.
create function m05t.su(stmt text) returns text language plpgsql as $$
declare r text;
begin
  begin
    execute stmt into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  return r;
end $$;

create function m05t.check(name text, ok boolean) returns void language sql as $$
  insert into m05t.results(name, ok) values (name, coalesce(ok, false)) $$;

-- Acts as a user first, then verifies the resulting rows, so the verification sees the effect of the call.
create function m05t.act(name text, uid uuid, stmt text, pattern text, verify text default null) returns void language plpgsql as $$
declare r text; v text;
begin
  r := m05t.q(uid, stmt);
  v := case when verify is null then 'true' else m05t.su(verify) end;
  perform m05t.check(name, (pattern is null or r like pattern) and v = 'true');
end $$;

-- Id of a student's open attempt / most recent attempt on a set
create function m05t.open_attempt(student uuid, mset uuid) returns uuid language sql as $$
  select id from public.mcq_attempts where student_id = student and mcq_set_id = mset and submitted_at is null order by created_at desc limit 1 $$;
create function m05t.last_attempt(student uuid, mset uuid) returns uuid language sql as $$
  select id from public.mcq_attempts where student_id = student and mcq_set_id = mset order by created_at desc limit 1 $$;

-- Synthetic data -------------------------------------------------------------------------------------------------
truncate public.topics, public.profiles, public.attendance cascade;
delete from auth.users where email like '%@m05.test';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'stu1@m05.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'stu2@m05.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'stu.disabled@m05.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'fac@m05.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fac.disabled@m05.test');
insert into public.profiles (id, role, full_name, email, is_disabled) values
  ('00000000-0000-0000-0000-0000000000a1', 'student', 'Student 1', 'stu1@m05.test', false),
  ('00000000-0000-0000-0000-0000000000a2', 'student', 'Student 2', 'stu2@m05.test', false),
  ('00000000-0000-0000-0000-0000000000a3', 'student', 'Student Disabled', 'stu.disabled@m05.test', true),
  ('00000000-0000-0000-0000-0000000000f1', 'faculty', 'Faculty', 'fac@m05.test', false),
  ('00000000-0000-0000-0000-0000000000f2', 'faculty', 'Faculty Disabled', 'fac.disabled@m05.test', true);
insert into public.classes (id, name, faculty_id) values ('00000000-0000-0000-0000-0000000000c1', 'Class A', '00000000-0000-0000-0000-0000000000f1');
insert into public.class_members (class_id, student_id, status) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'active');

insert into public.topics (id, name, position, is_published) values
  ('00000000-0000-0000-0000-0000000000d1', 'Live topic', 1, true),
  ('00000000-0000-0000-0000-0000000000d2', 'Draft topic', 2, false);
-- Sets: e1 practice (pos 1), e5 second practice (pos 2), e2 timed 30 min (pos 3), e3 draft set, e4 set in draft topic
insert into public.mcq_sets (id, topic_id, name, source_url, expected_count, position, is_published, duration_minutes) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Practice quiz', 'x', 3, 1, true, null),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'Second practice quiz', 'x', 1, 2, true, null),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'Timed quiz', 'x', 1, 3, true, 30),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'Draft quiz', 'x', 1, 4, false, null),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d2', 'Quiz in draft topic', 'x', 1, 1, true, null);
insert into public.mcqs (id, mcq_set_id, position, question_type, prompt, code, options, content_hash) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 'MULTIPLE_CHOICE', 'What is 1+1?', null, '[{"id":"o1","label":"A","content":"1"},{"id":"o2","label":"B","content":"2","isCorrect":true},{"id":"o3","label":"C","content":"3"}]', 'h1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 2, 'MORE_THAN_ONE_MULTIPLE_CHOICE', 'Pick the primes', null, '[{"id":"p1","label":"A","content":"2"},{"id":"p2","label":"B","content":"3"},{"id":"p3","label":"C","content":"4"}]', 'h2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 3, 'CODE_ANALYSIS_TEXTUAL', 'What does print(2*3) show?', 'print(2*3)', '[]', 'h3'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e2', 1, 'MULTIPLE_CHOICE', 'Timed question', null, '[{"id":"t1","label":"A","content":"yes"},{"id":"t2","label":"B","content":"no"}]', 'h4'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e3', 1, 'MULTIPLE_CHOICE', 'Draft question', null, '[{"id":"d1","label":"A","content":"x"}]', 'h5'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000e4', 1, 'MULTIPLE_CHOICE', 'Draft topic question', null, '[{"id":"z1","label":"A","content":"x"}]', 'h6'),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000e5', 1, 'MULTIPLE_CHOICE', 'Second set question', null, '[{"id":"s1","label":"A","content":"x"},{"id":"s2","label":"B","content":"y"}]', 'h7');
insert into public.mcq_answer_keys (mcq_id, answer_key) values
  ('00000000-0000-0000-0000-0000000000b1', '{"kind":"options","optionIds":["o2"],"explanation":"One plus one is two."}'),
  ('00000000-0000-0000-0000-0000000000b2', '{"kind":"options","optionIds":["p1","p2"]}'),
  ('00000000-0000-0000-0000-0000000000b3', '{"kind":"text","expected":"6"}'),
  ('00000000-0000-0000-0000-0000000000b4', '{"kind":"options","optionIds":["t1"]}'),
  ('00000000-0000-0000-0000-0000000000b5', '{"kind":"options","optionIds":["d1"]}'),
  ('00000000-0000-0000-0000-0000000000b6', '{"kind":"options","optionIds":["z1"]}'),
  ('00000000-0000-0000-0000-0000000000b7', '{"kind":"options","optionIds":["s1"]}');

set session_replication_role = origin;

-- Visibility and key confidentiality ------------------------------------------------------------------------------
select m05t.check('student cannot read quiz questions directly (no pre-start access)',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.mcqs$$) = '0');
select m05t.check('student cannot read answer keys',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.mcq_answer_keys$$) = '0');
select m05t.check('student sees only published sets in published topics',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select count(*) from public.mcq_sets$$) = '3');
select m05t.check('staff review every set and question',
  m05t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.mcq_sets$$) = '5'
  and m05t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.mcqs$$) = '7');
select m05t.check('disabled staff and disabled students read nothing',
  m05t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.mcq_sets$$) = '0'
  and m05t.q('00000000-0000-0000-0000-0000000000a3', $$select count(*) from public.mcq_sets$$) = '0'
  and m05t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.mcq_answer_keys$$) = '0');

-- Attempts cannot be forged ---------------------------------------------------------------------------------------
select m05t.check('student cannot insert an attempt directly',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$insert into public.mcq_attempts(student_id,mcq_set_id,answers,score,submitted_at) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','{}',1,now()) returning 1$$) like 'ERR%');
select m05t.check('quiz functions are not callable anonymously',
  m05t.q(null, $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$) like 'ERR%');

-- Untimed practice: start, answers withheld, autosave, refresh ----------------------------------------------------
select m05t.act('starting returns the questions without any key, correctness flag or explanation',
  '00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$,
  '%What is 1+1?%' , null);
select m05t.check('the start payload carries no key, flag, expected text or explanation',
  (select m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$)) not like '%isCorrect%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) not like '%optionIds%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) not like '%One plus one%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) not like '%"expected%');
select m05t.act('starting twice resumes the same attempt instead of stacking a second one',
  '00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$, '%"phase": "active"%',
  $v$select ((select count(*) from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1' and submitted_at is null) = 1)::text$v$);
select m05t.check('an untimed attempt has no deadline',
  (select deadline_at is null from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1'));
select m05t.check('a student cannot start an unpublished set, a set in an unpublished topic, or when disabled',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e3')::text$$) like 'ERR%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e4')::text$$) like 'ERR%'
  and m05t.q('00000000-0000-0000-0000-0000000000a3', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$) like 'ERR%');
select m05t.check('staff cannot start a recorded attempt',
  m05t.q('00000000-0000-0000-0000-0000000000f1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$) like 'ERR%');
select m05t.check('the next quiz in the topic is locked until this one is submitted',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e5')::text$$) like 'ERR%');

-- Save the primes question with only one of the two correct options, so the grade below is exactly 2 of 3.
select m05t.act('autosave stores only valid answers and ignores unknown questions and options',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_save(%L, %L::jsonb)::text$f$,
    m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'),
    '{"options":{"00000000-0000-0000-0000-0000000000b1":["o2","bogus"],"00000000-0000-0000-0000-0000000000b2":["p1"],"00000000-0000-0000-0000-0000000000b4":["t1"],"00000000-0000-0000-0000-0000000000ffff":["x"]},"text":{"00000000-0000-0000-0000-0000000000b3":" 6 "},"marked":["00000000-0000-0000-0000-0000000000b2","nope"]}'),
  '%"ok": true%',
  $v$select ((select answers->'options' ? '00000000-0000-0000-0000-0000000000b4' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and submitted_at is null) = false
         and (select answers->'options'->'00000000-0000-0000-0000-0000000000b1' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and submitted_at is null) = '["o2"]'::jsonb
         and (select answers->'marked' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and submitted_at is null) = '["00000000-0000-0000-0000-0000000000b2"]'::jsonb)::text$v$);
select m05t.check('a single-select question keeps at most one choice',
  m05t.su($$select jsonb_array_length(public.mcq_clean_answers('00000000-0000-0000-0000-0000000000e1', '{"options":{"00000000-0000-0000-0000-0000000000b1":["o1","o2"]}}'::jsonb)->'options'->'00000000-0000-0000-0000-0000000000b1')$$) = '1');
select m05t.check('saved answers survive a refresh (state returns them) and still carry no key',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) like '%"phase": "active"%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) like '%"o2"%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e1')::text$$) not like '%optionIds%');
select m05t.check('another student cannot save to, submit or read someone else''s attempt',
  m05t.q('00000000-0000-0000-0000-0000000000a2', format($f$select public.mcq_quiz_save(%L, '{"options":{}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'))) like 'ERR%'
  and m05t.q('00000000-0000-0000-0000-0000000000a2', format($f$select public.mcq_quiz_submit(%L)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'))) like 'ERR%'
  and m05t.q('00000000-0000-0000-0000-0000000000a2', $$select count(*) from public.mcq_attempts$$) = '0');
select m05t.check('assigned faculty can see the student''s attempt, unrelated faculty cannot',
  m05t.q('00000000-0000-0000-0000-0000000000f1', $$select count(*) from public.mcq_attempts$$) = '1'
  and m05t.q('00000000-0000-0000-0000-0000000000f2', $$select count(*) from public.mcq_attempts$$) = '0');
select m05t.check('results are unavailable before submission',
  m05t.q('00000000-0000-0000-0000-0000000000a1', format($f$select public.mcq_quiz_result(%L)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'))) like 'ERR%'
  and (select results is null from public.mcq_attempts where id = m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')));

-- Grading accuracy: single correct, multi-select with one of two options wrong, trimmed text correct = 2 of 3 --------
select m05t.act('submitting grades with the protected keys: partial multi-select earns nothing, text is trimmed',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_submit(%L)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')),
  '%"scored": 2%',
  $v$select ((select score from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1') between 0.6666 and 0.6667)::text$v$);
select m05t.check('the submitted attempt stores a graded snapshot with correct answers and the explanation',
  (select results::text like '%One plus one is two.%' and results::text like '%"correctOptionIds": ["p1", "p2"]%' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1'));
select m05t.act('submitting again is idempotent and cannot be used to regrade with new answers',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_submit(%L, '{"options":{"00000000-0000-0000-0000-0000000000b1":["o1"]}}'::jsonb)::text$f$, m05t.last_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')),
  '%"scored": 2%',
  $v$select ((select count(*) from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1') = 1)::text$v$);
select m05t.act('a completed attempt cannot be changed through autosave',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_save(%L, '{"options":{"00000000-0000-0000-0000-0000000000b1":["o1"]}}'::jsonb)::text$f$, m05t.last_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')),
  '%"ok": false%',
  $v$select ((select answers->'options'->'00000000-0000-0000-0000-0000000000b1' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1') = '["o2"]'::jsonb)::text$v$);
select m05t.check('students cannot edit a completed score',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$update public.mcq_attempts set score=1 where student_id='00000000-0000-0000-0000-0000000000a1'$$) like 'ERR%');
select m05t.check('the student can review the result afterwards and another student cannot',
  m05t.q('00000000-0000-0000-0000-0000000000a1', format($f$select public.mcq_quiz_result(%L)::text$f$, m05t.last_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'))) like '%One plus one is two.%'
  and m05t.q('00000000-0000-0000-0000-0000000000a2', format($f$select public.mcq_quiz_result(%L)::text$f$, m05t.last_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1'))) like 'ERR%');
select m05t.check('submitting credits the student with attendance',
  (select count(*) from public.attendance where student_id='00000000-0000-0000-0000-0000000000a1') = 1);

-- Retakes and the ladder ------------------------------------------------------------------------------------------
select m05t.act('an untimed quiz can be retaken: a fresh attempt starts with no answers and history is kept',
  '00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e1')::text$$, '%What is 1+1?%',
  $v$select ((select count(*) from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1') = 2
    and (select count(*) from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1' and submitted_at is not null) = 1
    and (select answers = '{"options":{},"text":{},"marked":[]}'::jsonb from public.mcq_attempts where id = m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')))::text$v$);
select m05t.act('a blank submission scores zero without error',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_submit(%L)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')),
  '%"scored": 0%',
  $v$select ((select count(*) from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e1' and score = 0) = 1)::text$v$);
select m05t.check('the timed quiz stays locked until the quiz before it is submitted',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e2')::text$$) like 'ERR%');
select m05t.act('the next quiz unlocks once the previous one has been submitted',
  '00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e5')::text$$, '%Second set question%');
select m05t.q('00000000-0000-0000-0000-0000000000a1', format($f$select public.mcq_quiz_submit(%L)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e5')));

-- Timed quizzes ---------------------------------------------------------------------------------------------------
select m05t.act('a timed attempt gets a server deadline of start plus the configured duration',
  '00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e2')::text$$, '%"durationMinutes": 30%',
  $v$select ((select deadline_at - started_at = interval '30 minutes' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e2'))::text$v$);
select m05t.check('the response carries the server clock so a wrong browser clock cannot extend the attempt',
  m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e2')::text$$) like '%serverNow%'
  and m05t.q('00000000-0000-0000-0000-0000000000a1', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e2')::text$$) like '%deadlineAt%');
select m05t.act('answers saved before the deadline are accepted',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_save(%L, '{"options":{"00000000-0000-0000-0000-0000000000b4":["t1"]}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')),
  '%"ok": true%');

-- Move the deadline 2 seconds into the past (inside the 5 second grace), then 10 seconds (outside it).
update public.mcq_attempts set started_at = now() - interval '31 minutes', deadline_at = now() - interval '2 seconds'
  where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e2';
select m05t.act('a save inside the 5 second grace after the deadline is still accepted',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_save(%L, '{"options":{"00000000-0000-0000-0000-0000000000b4":["t1"]}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')),
  '%"ok": true%');
update public.mcq_attempts set deadline_at = now() - interval '10 seconds'
  where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e2';
select m05t.act('a save after the deadline and grace is refused as expired and changes nothing',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_save(%L, '{"options":{"00000000-0000-0000-0000-0000000000b4":["t2"]}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')),
  '%"expired": true%',
  $v$select ((select answers->'options'->'00000000-0000-0000-0000-0000000000b4' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e2') = '["t1"]'::jsonb)::text$v$);
select m05t.act('a late submit ignores the answers it carries and grades what was saved in time',
  '00000000-0000-0000-0000-0000000000a1',
  format($f$select public.mcq_quiz_submit(%L, '{"options":{"00000000-0000-0000-0000-0000000000b4":["t2"]}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')),
  '%"scored": 1%',
  $v$select ((select results->>'late' = 'true' from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a1' and mcq_set_id='00000000-0000-0000-0000-0000000000e2'))::text$v$);

-- An abandoned, expired attempt is finalised when the student comes back.
-- Student 2 has already completed the two practice quizzes before the timed one (set up by a superuser).
insert into public.mcq_attempts (student_id, mcq_set_id, answers, submitted_at, score, created_at) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', '{}', now() - interval '2 hours', 0, now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e5', '{}', now() - interval '2 hours', 0, now() - interval '2 hours');
select m05t.act('a second student starts the timed quiz and saves an answer',
  '00000000-0000-0000-0000-0000000000a2', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e2')::text$$, '%Timed question%');
select m05t.act('...saves an answer to it',
  '00000000-0000-0000-0000-0000000000a2',
  format($f$select public.mcq_quiz_save(%L, '{"options":{"00000000-0000-0000-0000-0000000000b4":["t1"]}}'::jsonb)::text$f$, m05t.open_attempt('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2')),
  '%"ok": true%');
update public.mcq_attempts set started_at = now() - interval '50 minutes', deadline_at = now() - interval '20 minutes'
  where student_id='00000000-0000-0000-0000-0000000000a2' and mcq_set_id='00000000-0000-0000-0000-0000000000e2';
select m05t.act('visiting after expiry finalises the attempt and shows the result, not a live attempt',
  '00000000-0000-0000-0000-0000000000a2', $$select public.mcq_quiz_state('00000000-0000-0000-0000-0000000000e2')::text$$, '%"phase": "result"%',
  $v$select ((select submitted_at is not null and score = 1 from public.mcq_attempts where student_id='00000000-0000-0000-0000-0000000000a2' and mcq_set_id='00000000-0000-0000-0000-0000000000e2'))::text$v$);

-- Rate limit ------------------------------------------------------------------------------------------------------
insert into public.mcq_attempts (student_id, mcq_set_id, answers, submitted_at, score)
  select '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e5', '{}', now(), 0 from generate_series(1, 25);
select m05t.check('starting attempts is rate limited',
  m05t.q('00000000-0000-0000-0000-0000000000a2', $$select public.mcq_quiz_start('00000000-0000-0000-0000-0000000000e5')::text$$) like 'ERR%');

\echo
\echo === M05 database check results ===
select case when ok then 'PASS' else 'FAIL' end || '|' || name from m05t.results order by n;
select count(*) filter (where not ok) || '|' || count(*) as failed_total from m05t.results;
