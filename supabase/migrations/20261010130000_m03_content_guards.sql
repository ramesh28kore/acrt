-- M03: content visibility, lesson PDFs, publishing and the sequential progress gate.
-- Additive. Do NOT apply to a populated database before it has passed
-- supabase/tests/m03_content_guards.sql on an isolated copy and the owner has approved it.

-- Identity helpers. Unlike current_profile_role(), these treat a disabled account as having no access.
create or replace function public.is_active_account()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select not p.is_disabled from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select p.role in ('faculty', 'admin') and not p.is_disabled
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.topic_is_published(p_topic uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.topics t where t.id = p_topic and t.is_published);
$$;

create or replace function public.published_pdf_exists(p_path text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.sheets s
    where s.pdf_storage_path = p_path
      and s.is_published
      and public.topic_is_published(s.topic_id)
  );
$$;

revoke all on function public.is_active_account() from public, anon;
revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.topic_is_published(uuid) from public, anon;
revoke all on function public.published_pdf_exists(text) from public, anon;
grant execute on function public.is_active_account() to authenticated, service_role;
grant execute on function public.is_active_staff() to authenticated, service_role;
grant execute on function public.topic_is_published(uuid) to authenticated, service_role;
grant execute on function public.published_pdf_exists(text) to authenticated, service_role;

-- Reading ---------------------------------------------------------------------------------------
drop policy if exists topics_select_published_or_staff on public.topics;
create policy topics_select_published_or_staff on public.topics for select to authenticated
  using ((is_published and public.is_active_account()) or public.is_active_staff());

drop policy if exists sheets_select_published_or_staff on public.sheets;
create policy sheets_select_published_or_staff on public.sheets for select to authenticated
  using (
    (is_published and public.topic_is_published(topic_id) and public.is_active_account())
    or public.is_active_staff()
  );

-- Lesson PDFs: a signed link works only for a published lesson (staff may review drafts).
drop policy if exists cheat_sheets_read on storage.objects;
create policy cheat_sheets_read on storage.objects for select to authenticated
  using (
    bucket_id = 'cheat-sheets'
    and (public.is_active_staff() or (public.is_active_account() and public.published_pdf_exists(name)))
  );

-- Publishing: active staff only, and an unknown id is an error rather than a silent no-op.
-- Admin accounts still pass through the content-permission trigger on the updated table.
create or replace function public.set_topic_published(target_id uuid, published boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only faculty or admin can publish content' using errcode = '42501';
  end if;
  update public.topics set is_published = published where id = target_id;
  if not found then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_sheet_published(target_id uuid, published boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only faculty or admin can publish content' using errcode = '42501';
  end if;
  update public.sheets set is_published = published where id = target_id;
  if not found then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Progress gate: a student may only record progress on a visible lesson whose earlier
-- published lessons in the topic are complete. A row already completed is left to the
-- forward-only trigger, so completed lessons never become unwritable or re-locked.
create or replace function public.lesson_progress_gate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_sheet record;
begin
  if auth.uid() is null or public.is_active_staff() then
    return new;
  end if;
  if not public.is_active_account() then
    raise exception 'Your account cannot record progress.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return new;
  end if;

  select s.topic_id, s.position, s.id, s.is_published into v_sheet
  from public.sheets s where s.id = new.sheet_id;
  if not found or not v_sheet.is_published or not public.topic_is_published(v_sheet.topic_id) then
    raise exception 'This lesson is not available.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.sheets p
    where p.topic_id = v_sheet.topic_id
      and p.is_published
      and (p.position, p.id) < (v_sheet.position, v_sheet.id)
      and not exists (
        select 1 from public.lesson_progress lp
        where lp.student_id = auth.uid() and lp.sheet_id = p.id and lp.status = 'completed'
      )
  ) then
    raise exception 'Finish the earlier lessons in this topic first.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists lesson_progress_gate on public.lesson_progress;
create trigger lesson_progress_gate
  before insert or update on public.lesson_progress
  for each row execute function public.lesson_progress_gate();
