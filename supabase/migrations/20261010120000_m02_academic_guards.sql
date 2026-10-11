-- M02: institute scoping for admins and removed-membership handling.
-- Additive only. Do NOT apply to a populated database before it has passed
-- supabase/tests/m02_academic_guards.sql on an isolated copy and the owner has approved it.
--
-- Scope rule: a super admin, or an admin with no institute assigned, keeps today's reach.
-- An admin who has an institute is limited to that institute. Rows without an institute
-- (unplaced students, legacy classes) stay manageable by every admin so placement still works.

create or replace function public.admin_manages_institute(p_institute uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select p.role = 'admin'
       and not p.is_disabled
       and (p.is_super_admin or p.institute_id is null or p_institute is null or p.institute_id = p_institute)
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.admin_manages_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.admin_manages_institute((select c.institute_id from public.classes c where c.id = p_class));
$$;

-- A class and a student may only be joined when their institutes agree (or one is unplaced).
create or replace function public.class_student_institutes_match(p_class uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select c.institute_id is null or s.institute_id is null or c.institute_id = s.institute_id
    from public.classes c, public.profiles s
    where c.id = p_class and s.id = p_student
  ), false);
$$;

create or replace function public.admin_manages_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.admin_manages_institute((select s.institute_id from public.profiles s where s.id = p_student));
$$;

revoke all on function public.admin_manages_institute(uuid) from public, anon;
revoke all on function public.admin_manages_class(uuid) from public, anon;
revoke all on function public.class_student_institutes_match(uuid, uuid) from public, anon;
revoke all on function public.admin_manages_student(uuid) from public, anon;
grant execute on function public.admin_manages_institute(uuid) to authenticated, service_role;
grant execute on function public.admin_manages_class(uuid) to authenticated, service_role;
grant execute on function public.class_student_institutes_match(uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_manages_student(uuid) to authenticated, service_role;

-- Profiles ------------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_visible on public.profiles;
create policy profiles_select_self_or_visible on public.profiles for select to authenticated
  using (id = auth.uid() or public.admin_manages_institute(institute_id) or public.faculty_can_view_student(id));

drop policy if exists profiles_staff_update on public.profiles;
create policy profiles_staff_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.admin_manages_institute(institute_id) or public.faculty_can_view_student(id))
  with check (id = auth.uid() or public.admin_manages_institute(institute_id) or public.faculty_can_view_student(id));

-- Classes -------------------------------------------------------------------------------
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (faculty_id = auth.uid() or public.is_class_member(id) or public.admin_manages_institute(institute_id));

drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert to authenticated
  with check (public.admin_manages_institute(institute_id));

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update to authenticated
  using (public.admin_manages_institute(institute_id))
  with check (public.admin_manages_institute(institute_id));

drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete to authenticated
  using (public.admin_manages_institute(institute_id));

-- Class members ---------------------------------------------------------------------------
drop policy if exists class_members_select on public.class_members;
create policy class_members_select on public.class_members for select to authenticated
  using (student_id = auth.uid() or public.is_class_faculty(class_id) or public.admin_manages_class(class_id));

drop policy if exists class_members_insert on public.class_members;
create policy class_members_insert on public.class_members for insert to authenticated
  with check (
    public.admin_manages_class(class_id)
    and public.admin_manages_student(student_id)
    and public.class_student_institutes_match(class_id, student_id)
  );

drop policy if exists class_members_update on public.class_members;
create policy class_members_update on public.class_members for update to authenticated
  using (public.admin_manages_class(class_id))
  with check (
    public.admin_manages_class(class_id)
    and public.admin_manages_student(student_id)
    and public.class_student_institutes_match(class_id, student_id)
  );

drop policy if exists class_members_delete on public.class_members;
create policy class_members_delete on public.class_members for delete to authenticated
  using (public.admin_manages_class(class_id));

-- Join codes ------------------------------------------------------------------------------
drop policy if exists join_codes_select on public.join_codes;
create policy join_codes_select on public.join_codes for select to authenticated
  using (public.is_class_faculty(class_id) or public.admin_manages_class(class_id));

drop policy if exists join_codes_write on public.join_codes;
create policy join_codes_write on public.join_codes for all to authenticated
  using (public.admin_manages_class(class_id))
  with check (public.admin_manages_class(class_id));

-- Sections --------------------------------------------------------------------------------
drop policy if exists sections_write on public.sections;
create policy sections_write on public.sections for all to authenticated
  using (public.admin_manages_institute(institute_id))
  with check (public.admin_manages_institute(institute_id));

-- Removed memberships no longer grant faculty visibility, class access or a login-gate tie.
create or replace function public.faculty_can_view_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.class_members cm
    join public.classes c on c.id = cm.class_id
    where cm.student_id = target_student_id
      and cm.status = 'active'
      and c.faculty_id = auth.uid()
  );
$$;

create or replace function public.is_class_member(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.class_members cm
    where cm.class_id = target_class_id and cm.student_id = auth.uid() and cm.status = 'active'
  );
$$;

create or replace function public.login_allowed_for(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role     text;
  v_branch   uuid;
  v_disabled boolean;
  v_open     boolean;
  v_dept     boolean;
  v_class    boolean;
begin
  select p.role, p.branch_id, p.is_disabled into v_role, v_branch, v_disabled
  from public.profiles p
  where p.id = p_user;

  if v_role is null then return false; end if;
  if coalesce(v_disabled, false) then return false; end if;
  if v_role <> 'student' then return true; end if;

  select coalesce(a.allow_unassigned, true) into v_open
  from public.access_settings a where a.id;
  v_open := coalesce(v_open, true);

  if not public.department_login_restricted() then
    v_dept := true;
  elsif v_branch is null then
    v_dept := v_open;
  else
    v_dept := exists (
      select 1 from public.branches b
      where b.id = v_branch and b.is_active and b.login_enabled
    );
  end if;

  if not public.class_login_restricted() then
    v_class := true;
  elsif not exists (
    select 1 from public.class_members cm
    join public.classes c on c.id = cm.class_id
    where cm.student_id = p_user and cm.status = 'active' and c.status = 'active'
  ) then
    v_class := v_open;
  else
    v_class := exists (
      select 1 from public.class_members cm
      join public.classes c on c.id = cm.class_id
      where cm.student_id = p_user
        and cm.status = 'active'
        and c.status = 'active'
        and c.login_enabled
    );
  end if;

  return v_dept and v_class;
end;
$$;

create or replace function public.access_gaps()
returns table(no_branch integer, no_class integer, either integer, allow_unassigned boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can view login access gaps';
  end if;

  return query
  with s as (
    select p.id,
           (p.branch_id is null) as nb,
           not exists (
             select 1 from public.class_members cm
             join public.classes c on c.id = cm.class_id
             where cm.student_id = p.id and cm.status = 'active' and c.status = 'active'
           ) as nc
    from public.profiles p
    where p.role = 'student'
  )
  select
    count(*) filter (where s.nb)::int,
    count(*) filter (where s.nc)::int,
    count(*) filter (where s.nb or s.nc)::int,
    (select coalesce(a.allow_unassigned, true) from public.access_settings a where a.id)
  from s;
end;
$$;
