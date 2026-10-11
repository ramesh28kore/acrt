-- M05: MCQ quiz engine. Server-authoritative attempts, deadlines, grading and key confidentiality.
-- Additive. Depends on 20261010130000_m03_content_guards.sql (is_active_account, is_active_staff,
-- topic_is_published). Do NOT apply to a populated database before it has passed
-- supabase/tests/m05_quiz_guards.sql on an isolated copy and the owner has approved it.
--
-- BREAKING for the sibling Next.js app (D:\1.AVNT\CRT) that shares this database: it reads mcqs, and inserts
-- and updates mcq_attempts, with the student's own session, and grades with the service role. After this
-- migration students can only reach quizzes through the mcq_quiz_* functions, so the sibling must be
-- updated first.

alter table public.mcq_attempts
  add column if not exists deadline_at timestamptz,
  add column if not exists results jsonb;

-- Reading: questions only through the key-free functions; staff review directly ----------------------
drop policy if exists mcqs_select_authenticated on public.mcqs;
drop policy if exists mcqs_select_staff on public.mcqs;
create policy mcqs_select_staff on public.mcqs for select to authenticated using (public.is_active_staff());

drop policy if exists mcq_sets_select_published_or_staff on public.mcq_sets;
create policy mcq_sets_select_published_or_staff on public.mcq_sets for select to authenticated
  using (
    (is_published and public.topic_is_published(topic_id) and public.is_active_account())
    or public.is_active_staff()
  );

drop policy if exists mcq_answer_keys_faculty_admin on public.mcq_answer_keys;
create policy mcq_answer_keys_faculty_admin on public.mcq_answer_keys for all to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());

-- Attempts: written only by the quiz functions ------------------------------------------------------------------
drop policy if exists mcq_attempts_insert on public.mcq_attempts;
drop policy if exists mcq_attempts_update on public.mcq_attempts;
revoke insert, update, delete on public.mcq_attempts from authenticated;

drop policy if exists mcq_attempts_select on public.mcq_attempts;
create policy mcq_attempts_select on public.mcq_attempts for select to authenticated
  using (
    (student_id = auth.uid() and public.is_active_account())
    or public.faculty_can_view_student(student_id)
    or public.current_profile_role() = 'admin'
  );

-- Internal helpers --------------------------------------------------------------------------------------------------
create or replace function public.mcq_set_unlocked(p_set uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (
      select 1 from public.mcq_attempts a
      where a.student_id = auth.uid() and a.mcq_set_id = p_set and a.submitted_at is not null
    )
    or not exists (
      select 1
      from public.mcq_sets cur
      join public.mcq_sets prev on prev.topic_id = cur.topic_id and prev.is_published
        and (prev."position", prev.id) < (cur."position", cur.id)
      where cur.id = p_set
        and not exists (
          select 1 from public.mcq_attempts a
          where a.student_id = auth.uid() and a.mcq_set_id = prev.id and a.submitted_at is not null
        )
    );
$$;

create or replace function public.mcq_assert_playable(p_set uuid)
returns public.mcq_sets language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text;
  v_set public.mcq_sets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to take quizzes.' using errcode = '42501';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and not p.is_disabled;
  if v_role is distinct from 'student' then
    raise exception 'Only active students can take quizzes.' using errcode = '42501';
  end if;
  if not public.login_allowed_for(auth.uid()) then
    raise exception 'Your access is currently restricted.' using errcode = '42501';
  end if;
  select * into v_set from public.mcq_sets s
  where s.id = p_set and s.is_published and public.topic_is_published(s.topic_id);
  if not found then
    raise exception 'This quiz isn''t available.' using errcode = '42501';
  end if;
  if not public.mcq_set_unlocked(p_set) then
    raise exception 'Finish the earlier quizzes in this topic first.' using errcode = '42501';
  end if;
  return v_set;
end;
$$;

-- Keeps only answers that belong to this set: known questions and options, one choice for
-- single-select, trimmed bounded text, and marked ids that exist.
create or replace function public.mcq_clean_answers(p_set uuid, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_in jsonb := case when jsonb_typeof(p_input) = 'object' then p_input else '{}'::jsonb end;
  v_opts jsonb := '{}'::jsonb;
  v_text jsonb := '{}'::jsonb;
  v_marked jsonb := '[]'::jsonb;
  q record;
  v_sel jsonb;
  v_ids text[];
  v_txt text;
begin
  if octet_length(v_in::text) > 200000 then
    raise exception 'Answers are too large.' using errcode = '22023';
  end if;
  for q in select m.id, m.question_type, m.options from public.mcqs m where m.mcq_set_id = p_set order by m."position", m.id loop
    if q.question_type in ('CODE_ANALYSIS_TEXTUAL', 'FIB_CODING') then
      v_txt := left(btrim(coalesce(v_in -> 'text' ->> q.id::text, '')), 500);
      if v_txt <> '' then
        v_text := v_text || jsonb_build_object(q.id::text, v_txt);
      end if;
    else
      v_sel := v_in -> 'options' -> q.id::text;
      if jsonb_typeof(v_sel) = 'array' and jsonb_typeof(q.options) = 'array' then
        select coalesce(array_agg(s.e order by s.ord), '{}') into v_ids from (
          select t.e, min(t.ord) as ord
          from jsonb_array_elements_text(v_sel) with ordinality as t(e, ord)
          where t.e in (select x ->> 'id' from jsonb_array_elements(q.options) x)
          group by t.e
        ) s;
        if q.question_type not like '%MORE_THAN_ONE%' and cardinality(v_ids) > 1 then
          v_ids := v_ids[1:1];
        end if;
        if cardinality(v_ids) > 0 then
          v_opts := v_opts || jsonb_build_object(q.id::text, to_jsonb(v_ids));
        end if;
      end if;
    end if;
  end loop;
  if jsonb_typeof(v_in -> 'marked') = 'array' then
    select coalesce(jsonb_agg(m.id::text order by m."position", m.id), '[]') into v_marked
    from public.mcqs m
    where m.mcq_set_id = p_set and m.id::text in (select jsonb_array_elements_text(v_in -> 'marked'));
  end if;
  return jsonb_build_object('options', v_opts, 'text', v_text, 'marked', v_marked);
end;
$$;

-- Scores cleaned answers against the protected keys. A question with no usable key is left out of the
-- scored total instead of penalising the student.
create or replace function public.mcq_grade(p_set uuid, p_clean jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  q record;
  v_graded jsonb := '[]'::jsonb;
  v_scored int := 0;
  v_gradeable int := 0;
  v_total int := 0;
  v_key jsonb;
  v_ok boolean;
  v_correct text[];
  v_sel text[];
  v_txt text;
  v_expected text;
begin
  for q in
    select m.id, k.answer_key
    from public.mcqs m left join public.mcq_answer_keys k on k.mcq_id = m.id
    where m.mcq_set_id = p_set order by m."position", m.id
  loop
    v_total := v_total + 1;
    v_key := q.answer_key;
    v_ok := null;
    v_correct := null;
    v_expected := null;
    v_txt := null;
    select coalesce(array_agg(e order by e), '{}') into v_sel
      from jsonb_array_elements_text(coalesce(p_clean -> 'options' -> q.id::text, '[]'::jsonb)) e;

    if jsonb_typeof(v_key) = 'object' and v_key ->> 'kind' = 'text' then
      v_expected := v_key ->> 'expected';
      v_txt := coalesce(p_clean -> 'text' ->> q.id::text, '');
      if btrim(coalesce(v_expected, '')) <> '' then
        v_ok := lower(btrim(v_txt)) = lower(btrim(v_expected));
      end if;
      v_sel := '{}';
    elsif jsonb_typeof(v_key) = 'object' and v_key ->> 'kind' = 'options' then
      select coalesce(array_agg(e order by e), '{}') into v_correct from jsonb_array_elements_text(v_key -> 'optionIds') e;
      if cardinality(v_correct) > 0 then
        v_ok := v_sel = v_correct;
      end if;
    end if;

    if v_ok is not null then
      v_gradeable := v_gradeable + 1;
      if v_ok then v_scored := v_scored + 1; end if;
    end if;

    v_graded := v_graded || jsonb_build_array(jsonb_build_object(
      'mcqId', q.id,
      'selectedOptionIds', to_jsonb(v_sel),
      'correctOptionIds', case when v_correct is null then null else to_jsonb(v_correct) end,
      'submittedText', v_txt,
      'expectedText', v_expected,
      'isCorrect', v_ok,
      'explanation', case when jsonb_typeof(v_key) = 'object' then v_key ->> 'explanation' else null end
    ));
  end loop;

  return jsonb_build_object(
    'scored', v_scored, 'gradeable', v_gradeable, 'total', v_total,
    'score', case when v_gradeable > 0 then round(v_scored::numeric / v_gradeable, 4) else null end,
    'graded', v_graded
  );
end;
$$;

-- The question payload a student may hold before submitting: no keys, flags or explanations.
create or replace function public.mcq_quiz_questions(p_set uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'position', m."position", 'questionType', m.question_type,
    'prompt', m.prompt, 'code', m.code, 'codeLang', m.code_lang,
    'multiple', m.question_type like '%MORE_THAN_ONE%',
    'textual', m.question_type in ('CODE_ANALYSIS_TEXTUAL', 'FIB_CODING'),
    'options', case when jsonb_typeof(m.options) = 'array' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', o ->> 'id', 'label', o ->> 'label', 'content', o ->> 'content') order by t.ord), '[]'::jsonb)
      from jsonb_array_elements(m.options) with ordinality as t(o, ord)
    ) else '[]'::jsonb end
  ) order by m."position", m.id), '[]'::jsonb)
  from public.mcqs m where m.mcq_set_id = p_set;
$$;

create or replace function public.mcq_active_payload(p_attempt uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'phase', 'active',
    'attemptId', a.id,
    'startedAt', a.started_at,
    'deadlineAt', a.deadline_at,
    'serverNow', now(),
    'durationMinutes', s.duration_minutes,
    'set', jsonb_build_object('id', s.id, 'name', s.name),
    'questions', public.mcq_quiz_questions(a.mcq_set_id),
    'answers', a.answers
  )
  from public.mcq_attempts a join public.mcq_sets s on s.id = a.mcq_set_id
  where a.id = p_attempt;
$$;

-- Grades what was saved and closes the attempt. Runs only from the functions below.
create or replace function public.mcq_finalize_attempt(p_attempt uuid, p_answers jsonb, p_late boolean, p_auto boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_att public.mcq_attempts%rowtype;
  v_clean jsonb;
  v_result jsonb;
begin
  select * into v_att from public.mcq_attempts where id = p_attempt for update;
  if not found then
    raise exception 'Attempt not found.' using errcode = '42501';
  end if;
  if v_att.submitted_at is not null then
    return v_att.results;
  end if;
  v_clean := public.mcq_clean_answers(v_att.mcq_set_id, p_answers);
  v_result := public.mcq_grade(v_att.mcq_set_id, v_clean)
    || jsonb_build_object('attemptId', v_att.id, 'late', p_late, 'autoSubmitted', p_auto, 'mcqSetId', v_att.mcq_set_id,
                          'questions', public.mcq_quiz_questions(v_att.mcq_set_id));
  update public.mcq_attempts
     set answers = v_clean,
         score = (v_result ->> 'score')::numeric,
         results = v_result,
         submitted_at = now()
   where id = p_attempt;
  return v_result;
end;
$$;

-- Public functions ---------------------------------------------------------------------------------------------------
create or replace function public.mcq_quiz_start(p_set uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_set public.mcq_sets%rowtype;
  v_att public.mcq_attempts%rowtype;
  v_recent int;
begin
  v_set := public.mcq_assert_playable(p_set);

  select count(*) into v_recent from public.mcq_attempts
  where student_id = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent >= 20 then
    raise exception 'Too many attempts started. Wait a moment and try again.' using errcode = 'P0001';
  end if;

  select * into v_att from public.mcq_attempts
  where student_id = auth.uid() and mcq_set_id = p_set and submitted_at is null
  order by created_at desc limit 1 for update;
  if found then
    if v_att.deadline_at is not null and now() > v_att.deadline_at + interval '5 seconds' then
      perform public.mcq_finalize_attempt(v_att.id, v_att.answers, false, true);
    else
      return public.mcq_active_payload(v_att.id);
    end if;
  end if;

  insert into public.mcq_attempts (student_id, mcq_set_id, answers, started_at, deadline_at)
  values (
    auth.uid(), p_set, '{"options":{},"text":{},"marked":[]}'::jsonb, now(),
    case when v_set.duration_minutes is not null then now() + make_interval(mins => v_set.duration_minutes) end
  ) returning * into v_att;
  return public.mcq_active_payload(v_att.id);
end;
$$;

create or replace function public.mcq_quiz_state(p_set uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_set public.mcq_sets%rowtype;
  v_att public.mcq_attempts%rowtype;
  v_history jsonb;
  v_info jsonb;
begin
  v_set := public.mcq_assert_playable(p_set);
  v_info := jsonb_build_object(
    'id', v_set.id, 'name', v_set.name, 'durationMinutes', v_set.duration_minutes,
    'timed', v_set.duration_minutes is not null,
    'questionCount', (select count(*) from public.mcqs where mcq_set_id = p_set)
  );

  select * into v_att from public.mcq_attempts
  where student_id = auth.uid() and mcq_set_id = p_set order by created_at desc limit 1 for update;

  if found and v_att.submitted_at is null then
    if v_att.deadline_at is not null and now() > v_att.deadline_at + interval '5 seconds' then
      perform public.mcq_finalize_attempt(v_att.id, v_att.answers, false, true);
      select * into v_att from public.mcq_attempts where id = v_att.id;
    else
      return public.mcq_active_payload(v_att.id) || jsonb_build_object('set', v_info);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', a.id, 'submittedAt', a.submitted_at, 'score', a.score,
    'scored', a.results -> 'scored', 'gradeable', a.results -> 'gradeable', 'total', a.results -> 'total'
  ) order by a.submitted_at desc), '[]'::jsonb) into v_history
  from (
    select * from public.mcq_attempts
    where student_id = auth.uid() and mcq_set_id = p_set and submitted_at is not null
    order by submitted_at desc limit 20
  ) a;

  if v_att.id is null or v_att.submitted_at is null then
    return jsonb_build_object('phase', 'intro', 'set', v_info, 'history', v_history, 'serverNow', now());
  end if;
  return jsonb_build_object('phase', 'result', 'set', v_info, 'attemptId', v_att.id,
                            'result', v_att.results, 'history', v_history, 'serverNow', now());
end;
$$;

create or replace function public.mcq_quiz_save(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_att public.mcq_attempts%rowtype;
begin
  if auth.uid() is null or not public.is_active_account() then
    raise exception 'Sign in to save answers.' using errcode = '42501';
  end if;
  select * into v_att from public.mcq_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then
    raise exception 'Attempt not found.' using errcode = '42501';
  end if;
  if v_att.submitted_at is not null then
    return jsonb_build_object('ok', false, 'submitted', true);
  end if;
  if v_att.deadline_at is not null and now() > v_att.deadline_at + interval '5 seconds' then
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  update public.mcq_attempts
     set answers = public.mcq_clean_answers(v_att.mcq_set_id, p_answers)
   where id = p_attempt;
  return jsonb_build_object('ok', true, 'serverNow', now());
end;
$$;

create or replace function public.mcq_quiz_submit(p_attempt uuid, p_answers jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_att public.mcq_attempts%rowtype;
  v_late boolean;
begin
  if auth.uid() is null or not public.is_active_account() then
    raise exception 'Sign in to submit.' using errcode = '42501';
  end if;
  select * into v_att from public.mcq_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then
    raise exception 'Attempt not found.' using errcode = '42501';
  end if;
  if v_att.submitted_at is not null then
    return v_att.results;
  end if;
  v_late := v_att.deadline_at is not null and now() > v_att.deadline_at + interval '5 seconds';
  -- After the deadline the answers sent with the request are ignored; only what was saved in time counts.
  return public.mcq_finalize_attempt(
    p_attempt,
    case when v_late or p_answers is null then v_att.answers else p_answers end,
    v_late, false
  );
end;
$$;

create or replace function public.mcq_quiz_result(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_att public.mcq_attempts%rowtype;
begin
  if auth.uid() is null or not public.is_active_account() then
    raise exception 'Sign in to view results.' using errcode = '42501';
  end if;
  select * into v_att from public.mcq_attempts where id = p_attempt and student_id = auth.uid();
  if not found then
    raise exception 'Attempt not found.' using errcode = '42501';
  end if;
  if v_att.submitted_at is null then
    raise exception 'Results are available after you submit.' using errcode = '42501';
  end if;
  return v_att.results;
end;
$$;

-- Privileges --------------------------------------------------------------------------------------------------------------
revoke all on function public.mcq_set_unlocked(uuid) from public, anon, authenticated;
revoke all on function public.mcq_assert_playable(uuid) from public, anon, authenticated;
revoke all on function public.mcq_clean_answers(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mcq_grade(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mcq_quiz_questions(uuid) from public, anon, authenticated;
revoke all on function public.mcq_active_payload(uuid) from public, anon, authenticated;
revoke all on function public.mcq_finalize_attempt(uuid, jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function public.mcq_quiz_start(uuid) from public, anon;
revoke all on function public.mcq_quiz_state(uuid) from public, anon;
revoke all on function public.mcq_quiz_save(uuid, jsonb) from public, anon;
revoke all on function public.mcq_quiz_submit(uuid, jsonb) from public, anon;
revoke all on function public.mcq_quiz_result(uuid) from public, anon;
grant execute on function public.mcq_quiz_start(uuid) to authenticated, service_role;
grant execute on function public.mcq_quiz_state(uuid) to authenticated, service_role;
grant execute on function public.mcq_quiz_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.mcq_quiz_submit(uuid, jsonb) to authenticated, service_role;
grant execute on function public.mcq_quiz_result(uuid) to authenticated, service_role;

-- Publishing and duration: active staff only; unknown ids are errors ----------------------------------------------------------
create or replace function public.set_mcq_set_published(target_id uuid, published boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only faculty or admin can publish content' using errcode = '42501';
  end if;
  update public.mcq_sets set is_published = published where id = target_id;
  if not found then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_mcq_set_duration(target_id uuid, minutes integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only faculty or admin can set quiz duration' using errcode = '42501';
  end if;
  if minutes is not null and (minutes <= 0 or minutes > 600) then
    raise exception 'Quiz duration must be between 1 and 600 minutes' using errcode = '22023';
  end if;
  update public.mcq_sets set duration_minutes = minutes where id = target_id;
  if not found then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
end;
$$;
