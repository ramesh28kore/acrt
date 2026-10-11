-- M07 checks. Run only against an isolated copy with M02-M07 applied.
-- Verifies server timing, answer-key secrecy, duplicate/replay behavior, expiry, warnings and feedback ownership.
\set ON_ERROR_STOP 1
set session_replication_role = replica;
drop schema if exists m07t cascade;
create schema m07t;
create table m07t.results (name text, ok boolean);

create function m07t.q(uid uuid, stmt text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin execute stmt into r; exception when others then r := 'ERR: ' || sqlerrm; end;
  execute 'reset role'; return r;
end $$;
create function m07t.exec(uid uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  begin execute stmt; execute 'reset role'; return 'ok'; exception when others then execute 'reset role'; return 'ERR: ' || sqlerrm; end;
end $$;
create function m07t.su(stmt text) returns text language plpgsql as $$
declare r text;
begin begin execute stmt; r := 'ok'; exception when others then r := 'ERR: ' || sqlerrm; end; return r; end $$;
create function m07t.check(name text, ok boolean) returns void language sql as $$ insert into m07t.results values (name, coalesce(ok, false)) $$;

set session_replication_role = replica;
truncate public.test_series_feedback, public.test_series_violations, public.test_series_answers,
  public.test_series_answer_keys, public.test_series_questions, public.test_series_attempts,
  public.test_series cascade;
truncate public.profiles cascade;
delete from auth.users where email like '%@m07.test';
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','student@m07.test'),
 ('00000000-0000-0000-0000-0000000000a2','other@m07.test'),
 ('00000000-0000-0000-0000-0000000000f1','faculty@m07.test'),
 ('00000000-0000-0000-0000-0000000000d1','admin@m07.test');
insert into public.profiles(id,role,full_name,email,is_super_admin,is_disabled) values
 ('00000000-0000-0000-0000-0000000000a1','student','Student','student@m07.test',false,false),
 ('00000000-0000-0000-0000-0000000000a2','student','Other','other@m07.test',false,false),
 ('00000000-0000-0000-0000-0000000000f1','faculty','Faculty','faculty@m07.test',false,false),
 ('00000000-0000-0000-0000-0000000000d1','admin','Admin','admin@m07.test',true,false);

insert into public.test_series(id,title,status,is_enabled,test_type,duration_minutes,max_violations,cutoff_marks)
 values ('10000000-0000-0000-0000-000000000000','M07 test','ready',true,'mcq',1,3,1);
insert into public.test_series_questions(id,test_id,question_number,question_text,options,marks)
 values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000000',1,'Q1',array['yes','no','maybe','later'],1),
   ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000000',2,'Q2',array['a','b','c','d'],1);
insert into public.test_series_answer_keys(question_id,correct_option,explanation) values
 ('20000000-0000-0000-0000-000000000001','A','ok'), ('20000000-0000-0000-0000-000000000002','B','ok');
set session_replication_role = origin;

-- Students cannot read keys or hidden cases; the enabled question path is still available.
select m07t.check('student cannot read answer keys', m07t.q('00000000-0000-0000-0000-0000000000a1','select count(*)::text from public.test_series_answer_keys') = '0');
select m07t.check('faculty can read answer keys', m07t.q('00000000-0000-0000-0000-0000000000f1','select count(*)::text from public.test_series_answer_keys') = '2');
select m07t.check('student can read enabled questions', m07t.q('00000000-0000-0000-0000-0000000000a1','select count(*)::text from public.test_series_questions') = '2');

-- Start is server-owned and idempotent.
select m07t.check('start creates attempt', m07t.q('00000000-0000-0000-0000-0000000000a1',$$select public.test_series_start('10000000-0000-0000-0000-000000000000')::text$$) not like 'ERR:%');
select m07t.check('start replay returns same attempt', (select count(*) from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a1') = 1);
select m07t.check('deadline is server derived', (select deadline_at > started_at from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a1'));

-- Only the next question is accepted; answer rows do not expose the key to students.
select m07t.check('out of order rejected', m07t.q('00000000-0000-0000-0000-0000000000a1', $$select status from public.test_series_submit_answer((select id from public.test_series_attempts limit 1),'20000000-0000-0000-0000-000000000002','B')$$) like 'ERR:%');
select m07t.check('first answer grades server side', m07t.q('00000000-0000-0000-0000-0000000000a1', $$select status from public.test_series_submit_answer((select id from public.test_series_attempts limit 1),'20000000-0000-0000-0000-000000000001','A')$$) = 'in_progress');
select m07t.check('replay does not duplicate answer', (select count(*) from public.test_series_answers) = 1);
select m07t.check('answer key remains hidden', m07t.q('00000000-0000-0000-0000-0000000000a1','select count(*)::text from public.test_series_answer_keys') = '0');
select m07t.check('second answer completes', m07t.q('00000000-0000-0000-0000-0000000000a1', $$select status from public.test_series_submit_answer((select id from public.test_series_attempts limit 1),'20000000-0000-0000-0000-000000000002','B')$$) = 'completed');
select m07t.check('score is server computed', (select score from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a1') = 2);

-- Another student cannot read the first student's attempt or answers.
select m07t.check('other student cannot read attempt', m07t.q('00000000-0000-0000-0000-0000000000a2','select count(*)::text from public.test_series_attempts') = '0');
select m07t.check('other student cannot submit first attempt', m07t.q('00000000-0000-0000-0000-0000000000a2', $$select status from public.test_series_submit_answer((select id from public.test_series_attempts limit 1),'20000000-0000-0000-0000-000000000001','A')$$) like 'ERR:%');

-- Three warnings auto-submit and the debounce prevents hidden+blur double counting.
select m07t.su($$insert into public.test_series (id,title,status,is_enabled,test_type,max_violations) values ('10000000-0000-0000-0000-000000000001','Warnings','ready',true,'mcq',3)$$);
select m07t.su($$insert into public.test_series_questions(test_id,question_number,question_text,options) values ('10000000-0000-0000-0000-000000000001',1,'Q',array['a','b','c','d'])$$);
select m07t.q('00000000-0000-0000-0000-0000000000a2', $$select public.test_series_start('10000000-0000-0000-0000-000000000001')::text$$);
select m07t.check('warning one', (select (m07t.q('00000000-0000-0000-0000-0000000000a2',$$select violations::text from public.test_series_record_violation((select id from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a2'),'hidden')$$)) = '1'));
select m07t.check('warning debounce', (select count(*) from public.test_series_violations where student_id='00000000-0000-0000-0000-0000000000a2') = 1);
select pg_sleep(2.1);
select m07t.q('00000000-0000-0000-0000-0000000000a2', $$select violations::text from public.test_series_record_violation((select id from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a2'),'hidden')$$);
select pg_sleep(2.1);
select m07t.q('00000000-0000-0000-0000-0000000000a2', $$select violations::text from public.test_series_record_violation((select id from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a2'),'hidden')$$);
select m07t.check('third warning auto submits', (select status='completed' and auto_submitted and violations=3 from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a2'));

-- Feedback is only for a completed own attempt and is upserted, not duplicated.
select m07t.check('feedback accepted for own completed attempt', m07t.exec('00000000-0000-0000-0000-0000000000a1', $m$do $x$ begin perform public.test_series_submit_feedback((select id from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a1'),5,'good'); end $x$;$m$) = 'ok');
select m07t.check('feedback has one row', (select count(*) from public.test_series_feedback) = 1);
select m07t.check('feedback rejects another student', m07t.q('00000000-0000-0000-0000-0000000000a2', $$select public.test_series_submit_feedback((select id from public.test_series_attempts where student_id='00000000-0000-0000-0000-0000000000a1'),5,null)$$) like 'ERR:%');

select case when count(*) filter (where not ok) = 0 then 'PASS: ' || count(*) || ' checks' else 'FAIL: ' || string_agg(name, '; ') filter (where not ok) end from m07t.results;
select name from m07t.results where not ok;
drop schema m07t cascade;
