-- M04: coding practice integrity, drafts, playground limits and the solution reveal rule.
-- Additive. Depends on 20261010130000_m03_content_guards.sql (is_active_account, is_active_staff,
-- topic_is_published). Do NOT apply to a populated database before it has passed
-- supabase/tests/m04_coding_guards.sql on an isolated copy and the owner has approved it.
--
-- BREAKING for the sibling Next.js app (D:\1.AVNT\CRT) that shares this database: it inserts
-- graded rows into public.submissions with the student's own session. After this migration only
-- the service-role function record_graded_submission() can do that; the sibling must be updated first.

-- Visibility -------------------------------------------------------------------------------------
create or replace function public.set_is_visible(p_set uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.sets s
    where s.id = p_set and s.is_published and public.topic_is_published(s.topic_id)
  );
$$;

create or replace function public.problem_is_visible(p_problem uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.problems p
    where p.id = p_problem and public.set_is_visible(p.set_id) and public.topic_is_published(p.topic_id)
  );
$$;

revoke all on function public.set_is_visible(uuid) from public, anon;
revoke all on function public.problem_is_visible(uuid) from public, anon;
grant execute on function public.set_is_visible(uuid) to authenticated, service_role;
grant execute on function public.problem_is_visible(uuid) to authenticated, service_role;

drop policy if exists sets_select_published_or_staff on public.sets;
create policy sets_select_published_or_staff on public.sets for select to authenticated
  using (
    (is_published and public.topic_is_published(topic_id) and public.is_active_account())
    or public.is_active_staff()
  );

drop policy if exists problems_select_authenticated on public.problems;
drop policy if exists problems_select_published_or_staff on public.problems;
create policy problems_select_published_or_staff on public.problems for select to authenticated
  using (
    (public.set_is_visible(set_id) and public.topic_is_published(topic_id) and public.is_active_account())
    or public.is_active_staff()
  );

-- Only the sample cases are readable by students, and only for visible problems.
drop policy if exists test_cases_select on public.test_cases;
create policy test_cases_select on public.test_cases for select to authenticated
  using (
    (is_sample and public.problem_is_visible(problem_id) and public.is_active_account())
    or public.is_active_staff()
  );

-- Active staff only (a disabled account keeps no authoring rights).
drop policy if exists test_cases_staff_write on public.test_cases;
create policy test_cases_staff_write on public.test_cases for all to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());
drop policy if exists problem_solutions_faculty_admin on public.problem_solutions;
create policy problem_solutions_faculty_admin on public.problem_solutions for all to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());
drop policy if exists problem_tutorials_faculty_admin on public.problem_tutorials;
create policy problem_tutorials_faculty_admin on public.problem_tutorials for all to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());
drop policy if exists problem_validations_staff_read on public.problem_validations;
create policy problem_validations_staff_read on public.problem_validations for select to authenticated
  using (public.is_active_staff());
drop policy if exists problem_validations_staff_write on public.problem_validations;
create policy problem_validations_staff_write on public.problem_validations for all to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());

-- Submissions: written only by the grader ------------------------------------------------------------
drop policy if exists submissions_insert on public.submissions;
drop policy if exists submissions_update on public.submissions;
revoke insert, update, delete on public.submissions from authenticated;

drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (
    (student_id = auth.uid() and public.is_active_account())
    or public.faculty_can_view_student(student_id)
    or public.current_profile_role() = 'admin'
  );

-- The one write path. Callable by the server with the service role only; it re-checks the account,
-- the problem, the size limits and the per-minute rate, and acts as the student so the existing
-- attendance trigger (which requires auth.uid() = student) still credits the activity.
create or replace function public.record_graded_submission(
  p_student uuid, p_problem uuid, p_code text, p_language text, p_status text, p_results jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_role text;
  v_disabled boolean;
  v_recent int;
  v_limit int;
  v_id uuid;
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
begin
  if p_status not in ('passed', 'failed') then
    raise exception 'Invalid submission status' using errcode = '22023';
  end if;
  if p_language not in ('python', 'c', 'cpp', 'java', 'javascript') then
    raise exception 'Unsupported language' using errcode = '22023';
  end if;
  if p_code is null or octet_length(p_code) > 65536 then
    raise exception 'Submission is too large' using errcode = '22023';
  end if;
  if p_results is not null and octet_length(p_results::text) > 262144 then
    raise exception 'Result is too large' using errcode = '22023';
  end if;

  select p.role, p.is_disabled into v_role, v_disabled from public.profiles p where p.id = p_student;
  if not found or v_disabled then
    raise exception 'This account cannot submit' using errcode = '42501';
  end if;
  if v_role = 'student' and not public.login_allowed_for(p_student) then
    raise exception 'Your access is currently restricted' using errcode = '42501';
  end if;

  if v_role = 'student' and not public.problem_is_visible(p_problem) then
    raise exception 'This problem is not available' using errcode = '42501';
  end if;
  if not exists (select 1 from public.problems where id = p_problem) then
    raise exception 'This problem is not available' using errcode = '42501';
  end if;

  v_limit := case when v_role = 'student' then 10 else 60 end;
  select count(*) into v_recent from public.submissions
  where student_id = p_student and created_at > now() - interval '1 minute';
  if v_recent >= v_limit then
    raise exception 'Too many submissions, wait a moment and try again' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claim.sub', p_student::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_student::text, 'role', 'authenticated')::text, true);

  insert into public.submissions (student_id, problem_id, code, language, status, results)
  values (p_student, p_problem, p_code, p_language, p_status, p_results)
  returning id into v_id;

  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  return v_id;
end;
$$;

revoke all on function public.record_graded_submission(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_graded_submission(uuid, uuid, text, text, text, jsonb) to service_role;

-- Solution reveal: the database applies the rule, so no service key is needed to read it ----------------
create or replace function public.coding_attempts(p_problem uuid)
returns table (passed boolean, attempts int)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(bool_or(s.status = 'passed'), false), count(*)::int
  from public.submissions s
  where s.student_id = auth.uid() and s.problem_id = p_problem and s.status in ('passed', 'failed');
$$;

create or replace function public.student_solution(p_problem uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_passed boolean;
  v_attempts int;
  v_row public.problem_solutions%rowtype;
begin
  if not public.is_active_account() or not public.problem_is_visible(p_problem) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if public.problem_is_live_test_source(p_problem) then
    return jsonb_build_object('ok', false, 'reason', 'test_source');
  end if;
  select ca.passed, ca.attempts into v_passed, v_attempts from public.coding_attempts(p_problem) ca;
  if not (v_passed or v_attempts >= 3) then
    return jsonb_build_object('ok', false, 'reason', 'not_solved', 'attemptsRemaining', greatest(0, 3 - v_attempts));
  end if;
  select * into v_row from public.problem_solutions where problem_id = p_problem;
  if not found or not v_row.is_published or v_row.solution is null
     or not exists (select 1 from public.problem_validations v where v.problem_id = p_problem and v.status = 'passed') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  return jsonb_build_object(
    'ok', true,
    'solution', v_row.solution, 'language', v_row.language, 'approach', v_row.approach,
    'algorithm', v_row.algorithm, 'explanation', v_row.explanation,
    'timeComplexity', v_row.time_complexity, 'spaceComplexity', v_row.space_complexity
  );
end;
$$;

-- Teaching sections are shown from the start; only the final code waits for the reveal rule.
-- A tutorial needs a verified published solution, and is withheld while the problem feeds a live exam.
create or replace function public.student_tutorial(p_problem uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_passed boolean;
  v_attempts int;
  v_earned boolean;
  v_sol public.problem_solutions%rowtype;
  v_tut public.problem_tutorials%rowtype;
begin
  if not public.is_active_account() or not public.problem_is_visible(p_problem) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if public.problem_is_live_test_source(p_problem) then
    return jsonb_build_object('ok', false, 'reason', 'test_source');
  end if;
  select ca.passed, ca.attempts into v_passed, v_attempts from public.coding_attempts(p_problem) ca;
  v_earned := v_passed or v_attempts >= 3;

  select * into v_sol from public.problem_solutions where problem_id = p_problem;
  if not found or not v_sol.is_published or v_sol.solution is null
     or not exists (select 1 from public.problem_validations v where v.problem_id = p_problem and v.status = 'passed') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  select * into v_tut from public.problem_tutorials where problem_id = p_problem and is_published;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  return jsonb_build_object(
    'ok', true,
    'codeLocked', not v_earned,
    'attemptsRemaining', case when v_earned then 0 else greatest(0, 3 - v_attempts) end,
    'tutorial', jsonb_build_object(
      'understandProblem', v_tut.understand_problem, 'given', v_tut.given,
      'exampleWalkthrough', v_tut.example_walkthrough, 'thinkingPrompts', v_tut.thinking_prompts,
      'solutionSteps', v_tut.solution_steps, 'pseudocode', v_tut.pseudocode, 'dryRun', v_tut.dry_run,
      'commonMistakes', v_tut.common_mistakes, 'practiceChallenges', v_tut.practice_challenges,
      'hints', v_tut.hints,
      'approach', v_sol.approach, 'algorithm', v_sol.algorithm, 'explanation', v_sol.explanation,
      'timeComplexity', v_sol.time_complexity, 'spaceComplexity', v_sol.space_complexity
    ),
    'solution', case when v_earned then jsonb_build_object('solution', v_sol.solution, 'language', v_sol.language) else null end
  );
end;
$$;

revoke all on function public.coding_attempts(uuid) from public, anon;
revoke all on function public.student_solution(uuid) from public, anon;
revoke all on function public.student_tutorial(uuid) from public, anon;
grant execute on function public.coding_attempts(uuid) to authenticated, service_role;
grant execute on function public.student_solution(uuid) to authenticated, service_role;
grant execute on function public.student_tutorial(uuid) to authenticated, service_role;

-- Server-only read of every case (hidden ones included) for grading.
create or replace function public.grading_cases(p_problem uuid)
returns table (input text, expected_output text, is_sample boolean, "position" integer)
language sql stable security definer set search_path to 'public' as $$
  select t.input, t.expected_output, t.is_sample, t."position"
  from public.test_cases t where t.problem_id = p_problem order by t."position", t.id;
$$;
revoke all on function public.grading_cases(uuid) from public, anon, authenticated;
grant execute on function public.grading_cases(uuid) to service_role;

-- Practice drafts (autosave) ---------------------------------------------------------------------------
create table if not exists public.practice_drafts (
  student_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  language text not null default 'python',
  code text not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, problem_id),
  constraint practice_drafts_language check (language in ('python', 'c', 'cpp', 'java', 'javascript')),
  constraint practice_drafts_code_size check (octet_length(code) <= 65536)
);
alter table public.practice_drafts enable row level security;
revoke all on public.practice_drafts from public, anon;
grant select, insert, update, delete on public.practice_drafts to authenticated;
grant all on public.practice_drafts to service_role;

drop policy if exists practice_drafts_owner_select on public.practice_drafts;
create policy practice_drafts_owner_select on public.practice_drafts for select to authenticated
  using (student_id = auth.uid() and public.is_active_account());
drop policy if exists practice_drafts_owner_insert on public.practice_drafts;
create policy practice_drafts_owner_insert on public.practice_drafts for insert to authenticated
  with check (student_id = auth.uid() and public.is_active_account() and public.problem_is_visible(problem_id));
drop policy if exists practice_drafts_owner_update on public.practice_drafts;
create policy practice_drafts_owner_update on public.practice_drafts for update to authenticated
  using (student_id = auth.uid() and public.is_active_account())
  with check (student_id = auth.uid() and public.is_active_account() and public.problem_is_visible(problem_id));
drop policy if exists practice_drafts_owner_delete on public.practice_drafts;
create policy practice_drafts_owner_delete on public.practice_drafts for delete to authenticated
  using (student_id = auth.uid());

drop trigger if exists practice_drafts_set_updated_at on public.practice_drafts;
create trigger practice_drafts_set_updated_at before update on public.practice_drafts
  for each row execute function public.set_updated_at();

-- Playground: size, language and count limits, and no read access beyond the owner ---------------------
alter table public.playground_programs
  drop constraint if exists playground_programs_language_check,
  drop constraint if exists playground_programs_code_size,
  drop constraint if exists playground_programs_stdin_size,
  drop constraint if exists playground_programs_title_size;
alter table public.playground_programs
  add constraint playground_programs_language_check check (language in ('python', 'c', 'cpp', 'java', 'javascript')) not valid,
  add constraint playground_programs_code_size check (octet_length(code) <= 65536) not valid,
  add constraint playground_programs_stdin_size check (octet_length(stdin) <= 65536) not valid,
  add constraint playground_programs_title_size check (char_length(btrim(title)) between 1 and 120) not valid;

create or replace function public.playground_programs_cap()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null
     and (select count(*) from public.playground_programs where owner_id = new.owner_id) >= 50 then
    raise exception 'You can keep at most 50 saved programs. Delete one first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists playground_programs_cap on public.playground_programs;
create trigger playground_programs_cap before insert on public.playground_programs
  for each row execute function public.playground_programs_cap();

drop policy if exists playground_programs_select on public.playground_programs;
create policy playground_programs_select on public.playground_programs for select to authenticated
  using (owner_id = auth.uid() and public.is_active_account());
drop policy if exists playground_programs_insert on public.playground_programs;
create policy playground_programs_insert on public.playground_programs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_active_account());
drop policy if exists playground_programs_update on public.playground_programs;
create policy playground_programs_update on public.playground_programs for update to authenticated
  using (owner_id = auth.uid() and public.is_active_account())
  with check (owner_id = auth.uid() and public.is_active_account());
