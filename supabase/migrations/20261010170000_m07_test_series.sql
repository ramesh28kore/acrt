-- M07: secure test-series examinations. Additive and local-review gated.
-- Depends on M02-M06. This migration never publishes a test, imports rows, or exposes answer keys.
-- Students receive questions only through an in-progress attempt and write answers through security-definer RPCs.

create table if not exists public.test_series (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  description text,
  instructions text,
  source_filename text,
  status text not null default 'draft' check (status in ('draft', 'ready')),
  is_enabled boolean not null default false,
  answers_confirmed_by uuid references public.profiles(id) on delete set null,
  answers_confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  test_type text not null default 'mcq' check (test_type in ('mcq', 'coding')),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  cutoff_marks integer check (cutoff_marks is null or cutoff_marks >= 0),
  max_violations integer not null default 3 check (max_violations between 1 and 20)
);

alter table public.test_series add column if not exists duration_minutes integer;
alter table public.test_series add column if not exists cutoff_marks integer;
alter table public.test_series add column if not exists max_violations integer not null default 3;

create table if not exists public.test_series_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.test_series(id) on delete cascade,
  question_number integer not null check (question_number > 0),
  question_text text not null check (length(btrim(question_text)) > 0),
  options text[] not null check (cardinality(options) between 2 and 26 and array_position(options, '') is null and array_position(options, null) is null),
  marks integer not null default 1 check (marks > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_id, question_number)
);

create table if not exists public.test_series_answer_keys (
  question_id uuid primary key references public.test_series_questions(id) on delete cascade,
  correct_option char(1) check (correct_option ~ '^[A-Z]$'),
  explanation text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.test_series_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.test_series(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null default 1 check (attempt_number > 0),
  total_questions integer not null default 0,
  correct_answers integer not null default 0,
  wrong_answers integer not null default 0,
  score integer not null default 0,
  total_marks integer not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  completed_at timestamptz,
  violations integer not null default 0 check (violations >= 0),
  auto_submitted boolean not null default false,
  unique (test_id, student_id, attempt_number)
);

alter table public.test_series_attempts add column if not exists deadline_at timestamptz;
alter table public.test_series_attempts add column if not exists violations integer not null default 0;
alter table public.test_series_attempts add column if not exists auto_submitted boolean not null default false;

create table if not exists public.test_series_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_series_attempts(id) on delete cascade,
  question_id uuid not null references public.test_series_questions(id) on delete cascade,
  selected_option char(1) not null check (selected_option in ('A','B','C','D')),
  is_correct boolean not null,
  marks_awarded integer not null default 0 check (marks_awarded >= 0),
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table if not exists public.test_series_violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_series_attempts(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('hidden', 'blur')),
  created_at timestamptz not null default now()
);

create table if not exists public.test_series_feedback (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_series_attempts(id) on delete cascade,
  test_id uuid not null references public.test_series(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (attempt_id, student_id)
);

create table if not exists public.test_series_coding_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.test_series(id) on delete cascade,
  question_number integer not null check (question_number > 0),
  source_problem_id uuid references public.problems(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  difficulty text,
  content jsonb not null default '[]'::jsonb,
  samples jsonb not null default '[]'::jsonb,
  marks integer not null default 25 check (marks between 1 and 1000),
  unique (test_id, question_number)
);

create table if not exists public.test_series_coding_cases (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.test_series_coding_questions(id) on delete cascade,
  input text not null default '',
  expected_output text not null default '',
  is_sample boolean not null default false,
  position integer not null default 0
);

create table if not exists public.test_series_coding_drafts (
  attempt_id uuid not null references public.test_series_attempts(id) on delete cascade,
  question_id uuid not null references public.test_series_coding_questions(id) on delete cascade,
  code text not null default '' check (length(code) <= 100000),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table if not exists public.test_series_coding_submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_series_attempts(id) on delete cascade,
  question_id uuid not null references public.test_series_coding_questions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  passed integer not null check (passed >= 0),
  total integer not null check (total >= 0),
  marks_awarded integer not null check (marks_awarded >= 0),
  verdict text not null,
  created_at timestamptz not null default now()
);

create index if not exists test_series_attempts_test_idx on public.test_series_attempts(test_id, status);
create index if not exists test_series_answers_attempt_idx on public.test_series_answers(attempt_id);
create index if not exists test_series_violations_attempt_idx on public.test_series_violations(attempt_id, created_at);
create index if not exists test_series_coding_cases_question_idx on public.test_series_coding_cases(question_id, position);

alter table public.test_series enable row level security;
alter table public.test_series_questions enable row level security;
alter table public.test_series_answer_keys enable row level security;
alter table public.test_series_attempts enable row level security;
alter table public.test_series_answers enable row level security;
alter table public.test_series_violations enable row level security;
alter table public.test_series_feedback enable row level security;
alter table public.test_series_coding_questions enable row level security;
alter table public.test_series_coding_cases enable row level security;
alter table public.test_series_coding_drafts enable row level security;
alter table public.test_series_coding_submissions enable row level security;

-- Existing sibling policies are replaced with active-account-aware policies.
drop policy if exists test_series_select on public.test_series;
create policy test_series_select on public.test_series for select to authenticated using (
  (is_enabled and public.is_active_account()) or public.is_active_staff());
drop policy if exists test_series_admin_write on public.test_series;
create policy test_series_admin_write on public.test_series for all to authenticated using (
  public.current_profile_role() = 'admin' and public.is_active_account()) with check (
  public.current_profile_role() = 'admin' and public.is_active_account());

drop policy if exists test_series_questions_select on public.test_series_questions;
create policy test_series_questions_select on public.test_series_questions for select to authenticated using (
  public.is_active_staff() or exists (select 1 from public.test_series t where t.id = test_id and t.is_enabled and public.is_active_account()));
drop policy if exists test_series_questions_admin_write on public.test_series_questions;
create policy test_series_questions_admin_write on public.test_series_questions for all to authenticated using (
  public.current_profile_role() = 'admin' and public.is_active_account()) with check (
  public.current_profile_role() = 'admin' and public.is_active_account());

drop policy if exists test_series_answer_keys_staff_select on public.test_series_answer_keys;
create policy test_series_answer_keys_staff_select on public.test_series_answer_keys for select to authenticated using (public.is_active_staff());
drop policy if exists test_series_answer_keys_admin_insert on public.test_series_answer_keys;
create policy test_series_answer_keys_admin_insert on public.test_series_answer_keys for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists test_series_attempts_select on public.test_series_attempts;
create policy test_series_attempts_select on public.test_series_attempts for select to authenticated using (
  (student_id = auth.uid() and public.is_active_account()) or public.is_active_staff());
drop policy if exists test_series_answers_select on public.test_series_answers;
create policy test_series_answers_select on public.test_series_answers for select to authenticated using (
  public.is_active_staff() or exists (select 1 from public.test_series_attempts a where a.id = attempt_id and a.student_id = auth.uid() and public.is_active_account()));
drop policy if exists tsv_select on public.test_series_violations;
create policy tsv_select on public.test_series_violations for select to authenticated using (student_id = auth.uid() or public.is_active_staff());
drop policy if exists test_series_feedback_select on public.test_series_feedback;
create policy test_series_feedback_select on public.test_series_feedback for select to authenticated using (student_id = auth.uid() or public.is_active_staff());
drop policy if exists test_series_feedback_insert on public.test_series_feedback;
create policy test_series_feedback_insert on public.test_series_feedback for insert to authenticated with check (student_id = auth.uid() and public.is_active_account());
drop policy if exists tscq_select on public.test_series_coding_questions;
create policy tscq_select on public.test_series_coding_questions for select to authenticated using (
  public.is_active_staff() or exists (select 1 from public.test_series_attempts a join public.test_series t on t.id = a.test_id
    where a.test_id = test_series_coding_questions.test_id and a.student_id = auth.uid() and public.is_active_account()
      and (t.is_enabled or a.status = 'completed')));
drop policy if exists tscc_staff_select on public.test_series_coding_cases;
create policy tscc_staff_select on public.test_series_coding_cases for select to authenticated using (public.is_active_staff());
drop policy if exists tscd_own on public.test_series_coding_drafts;
create policy tscd_own on public.test_series_coding_drafts for all to authenticated using (exists (
  select 1 from public.test_series_attempts a where a.id = attempt_id and a.student_id = auth.uid())) with check (exists (
  select 1 from public.test_series_attempts a where a.id = attempt_id and a.student_id = auth.uid() and a.status = 'in_progress'));
drop policy if exists tscs_select on public.test_series_coding_submissions;
create policy tscs_select on public.test_series_coding_submissions for select to authenticated using (student_id = auth.uid() or public.is_active_staff());

revoke insert, update, delete on public.test_series_attempts, public.test_series_answers, public.test_series_violations from authenticated;
revoke all on public.test_series_coding_cases from authenticated;
grant select on public.test_series, public.test_series_questions, public.test_series_attempts, public.test_series_answers,
  public.test_series_violations, public.test_series_feedback, public.test_series_coding_questions,
  public.test_series_coding_drafts, public.test_series_coding_submissions to authenticated;
grant insert on public.test_series_feedback to authenticated;

create or replace function public.test_series_deadline(p_attempt_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(a.deadline_at,
    case when t.duration_minutes is null then null else a.started_at + make_interval(mins => t.duration_minutes) end)
  from public.test_series_attempts a join public.test_series t on t.id = a.test_id where a.id = p_attempt_id
$$;

create or replace function public.test_series_start(p_test_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_attempt uuid; v_type text; v_total int; v_marks int; v_duration int;
begin
  if v_uid is null or not public.is_active_account() then raise exception 'Not authorized'; end if;
  select t.test_type, t.duration_minutes into v_type, v_duration from public.test_series t where t.id = p_test_id and t.is_enabled;
  if v_type is null then raise exception 'This test is not available'; end if;
  select id into v_attempt from public.test_series_attempts where test_id = p_test_id and student_id = v_uid order by attempt_number desc limit 1;
  if v_attempt is not null then return v_attempt; end if;
  if v_type = 'coding' then select count(*), coalesce(sum(marks), 0) into v_total, v_marks from public.test_series_coding_questions where test_id = p_test_id;
  else select count(*), coalesce(sum(marks), 0) into v_total, v_marks from public.test_series_questions where test_id = p_test_id; end if;
  if v_total = 0 then raise exception 'This test has no questions'; end if;
  insert into public.test_series_attempts(test_id, student_id, total_questions, total_marks, deadline_at)
    values (p_test_id, v_uid, v_total, v_marks, case when v_duration is null then null else now() + make_interval(mins => v_duration) end)
    on conflict (test_id, student_id, attempt_number) do nothing returning id into v_attempt;
  if v_attempt is null then select id into v_attempt from public.test_series_attempts where test_id = p_test_id and student_id = v_uid and attempt_number = 1; end if;
  return v_attempt;
end; $$;

create or replace function public.test_series_finish_if_expired(p_attempt_id uuid)
returns table(answered int, total_questions int, score int, total_marks int, correct_answers int, wrong_answers int, status text)
language plpgsql security definer set search_path = public as $$
declare v_attempt public.test_series_attempts%rowtype; v_deadline timestamptz;
begin
  select * into v_attempt from public.test_series_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or (v_attempt.student_id is distinct from auth.uid() and not public.is_active_staff()) then raise exception 'Attempt not found'; end if;
  v_deadline := public.test_series_deadline(p_attempt_id);
    if v_attempt.status = 'in_progress' and v_deadline is not null and now() >= v_deadline then
    update public.test_series_attempts set status = 'completed', completed_at = v_deadline, auto_submitted = true where id = p_attempt_id;
  end if;
  return query select (select count(*)::int from public.test_series_answers where attempt_id = a.id), a.total_questions, a.score, a.total_marks, a.correct_answers, a.wrong_answers, a.status from public.test_series_attempts a where a.id = p_attempt_id;
end; $$;

create or replace function public.test_series_review(p_attempt_id uuid)
returns table(question_number integer, question_text text, options text[], selected_option text,
  correct_option text, is_correct boolean, explanation text)
language plpgsql stable security definer set search_path = public as $$
declare v_attempt public.test_series_attempts%rowtype;
begin
  select * into v_attempt from public.test_series_attempts where id = p_attempt_id;
  if v_attempt.id is null
     or (v_attempt.student_id is distinct from auth.uid() and not public.is_active_staff())
     or (v_attempt.student_id = auth.uid() and not public.is_active_account()) then
    raise exception 'Attempt not found';
  end if;
  if v_attempt.status <> 'completed' then raise exception 'The review opens once the test is finished'; end if;
  return query
    select q.question_number, q.question_text, q.options,
      a.selected_option::text, k.correct_option::text, a.is_correct, k.explanation
    from public.test_series_questions q
    left join public.test_series_answers a on a.question_id = q.id and a.attempt_id = v_attempt.id
    left join public.test_series_answer_keys k on k.question_id = q.id
    where q.test_id = v_attempt.test_id order by q.question_number;
end; $$;

create or replace function public.test_series_submit_answer(p_attempt_id uuid, p_question_id uuid, p_selected text)
returns table(answered int, total_questions int, score int, total_marks int, correct_answers int, wrong_answers int, status text)
language plpgsql security definer set search_path = public as $$
declare v_attempt public.test_series_attempts%rowtype; v_expected uuid; v_key char(1); v_marks int; v_selected char(1); v_deadline timestamptz; v_correct boolean;
begin
  v_selected := upper(btrim(p_selected));
  if v_selected !~ '^[A-Z]$' then raise exception 'Choose one of the options'; end if;
  select * into v_attempt from public.test_series_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_id is distinct from auth.uid() or not public.is_active_account() then raise exception 'Attempt not found'; end if;
  v_deadline := public.test_series_deadline(p_attempt_id);
  if v_attempt.status = 'in_progress' and v_deadline is not null and now() >= v_deadline then
    update public.test_series_attempts set status = 'completed', completed_at = v_deadline, auto_submitted = true where id = p_attempt_id;
  elsif v_attempt.status = 'in_progress' then
    select q.id into v_expected from public.test_series_questions q where q.test_id = v_attempt.test_id and not exists
      (select 1 from public.test_series_answers a where a.attempt_id = v_attempt.id and a.question_id = q.id)
      order by q.question_number limit 1;
    if v_expected is not null and v_expected = p_question_id then
      select k.correct_option, q.marks into v_key, v_marks from public.test_series_questions q left join public.test_series_answer_keys k on k.question_id = q.id where q.id = p_question_id;
      v_correct := v_key is not null and v_key = v_selected;
      insert into public.test_series_answers(attempt_id, question_id, selected_option, is_correct, marks_awarded)
        values (v_attempt.id, p_question_id, v_selected, v_correct, case when v_correct then v_marks else 0 end) on conflict do nothing;
    elsif v_expected is not null and not exists (select 1 from public.test_series_answers where attempt_id = v_attempt.id and question_id = p_question_id) then
      raise exception 'Answer the questions in order';
    end if;
    update public.test_series_attempts t set correct_answers = s.correct, wrong_answers = s.wrong, score = s.score,
      status = case when s.answered >= t.total_questions then 'completed' else 'in_progress' end,
      completed_at = case when s.answered >= t.total_questions then coalesce(t.completed_at, now()) else null end
      from (select count(*)::int answered, count(*) filter (where is_correct)::int correct, count(*) filter (where not is_correct)::int wrong, coalesce(sum(marks_awarded),0)::int score from public.test_series_answers where attempt_id = p_attempt_id) s where t.id = p_attempt_id;
  end if;
  return query select (select count(*)::int from public.test_series_answers where attempt_id = a.id), a.total_questions, a.score, a.total_marks, a.correct_answers, a.wrong_answers, a.status from public.test_series_attempts a where a.id = p_attempt_id;
end; $$;

create or replace function public.test_series_record_violation(p_attempt_id uuid, p_reason text)
returns table(violations int, max_violations int, status text) language plpgsql security definer set search_path = public as $$
declare a public.test_series_attempts%rowtype; v_max int; v_count int; v_last timestamptz;
begin
  select * into a from public.test_series_attempts where id = p_attempt_id for update;
  if a.id is null or a.student_id is distinct from auth.uid() or not public.is_active_account() then raise exception 'Attempt not found'; end if;
  select t.max_violations into v_max from public.test_series t where t.id = a.test_id;
  if a.status = 'in_progress' then
    select max(created_at) into v_last from public.test_series_violations where attempt_id = a.id;
    if v_last is null or now() - v_last > interval '2 seconds' then
      insert into public.test_series_violations(attempt_id, student_id, reason) values (a.id, a.student_id, case when p_reason = 'blur' then 'blur' else 'hidden' end);
      v_count := a.violations + 1;
      if v_count >= v_max then update public.test_series_attempts set violations=v_count, status='completed', auto_submitted=true, completed_at=now() where id=a.id; else update public.test_series_attempts set violations=v_count where id=a.id; end if;
    end if;
  end if;
  return query select a2.violations, v_max, a2.status from public.test_series_attempts a2 where a2.id = a.id;
end; $$;

create or replace function public.test_series_submit_feedback(p_attempt_id uuid, p_rating int, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_account() or not exists (select 1 from public.test_series_attempts where id=p_attempt_id and student_id=auth.uid() and status='completed') then raise exception 'Completed attempt required'; end if;
  insert into public.test_series_feedback(attempt_id, test_id, student_id, rating, comment)
    select p_attempt_id, a.test_id, auth.uid(), p_rating, nullif(btrim(p_comment),'')
      from public.test_series_attempts a where a.id = p_attempt_id
    on conflict (attempt_id) do update set test_id=excluded.test_id, student_id=excluded.student_id,
      rating=excluded.rating, comment=excluded.comment;
end; $$;

revoke all on function public.test_series_deadline(uuid), public.test_series_start(uuid), public.test_series_finish_if_expired(uuid), public.test_series_submit_answer(uuid,uuid,text), public.test_series_record_violation(uuid,text), public.test_series_submit_feedback(uuid,int,text) from public, anon;
grant execute on function public.test_series_deadline(uuid), public.test_series_start(uuid), public.test_series_finish_if_expired(uuid), public.test_series_submit_answer(uuid,uuid,text), public.test_series_record_violation(uuid,text), public.test_series_submit_feedback(uuid,int,text) to authenticated;

notify pgrst, 'reload schema';
