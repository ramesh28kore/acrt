-- Super admin dashboard: guarded, transactional management and paginated reads.
alter table public.profiles add column disabled_at timestamptz;

create or replace function public.protect_profile_columns()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.email := old.email;
    new.institute_id := old.institute_id;
    new.is_active := old.is_active;
    new.roll_number := old.roll_number;
    new.disabled_at := old.disabled_at;
  end if;
  if not new.is_active then
    new.disabled_at := coalesce(old.disabled_at, now());
  else
    new.disabled_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
update public.profiles set disabled_at = now() where not is_active;
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Account creation alone must never grant a role, even for the owner's email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, is_active, disabled_at)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), false, now())
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and r.role = _role and p.is_active
  )
$$;
create or replace function public.user_institute(_user_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select institute_id from public.profiles where id = _user_id and is_active
$$;
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.user_institute(uuid) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.user_institute(uuid) to authenticated, service_role;

create or replace function public.assert_super_admin()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'An active super admin account is required.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.assert_super_admin() from public, anon;
grant execute on function public.assert_super_admin() to authenticated;

-- A login record cannot supply its own timestamp, actor role, or institute.
create or replace function public.stamp_login_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) = 'authenticated' and new.action = 'sign_in' then
    if new.actor_id is distinct from auth.uid() or not exists (
      select 1 from public.profiles where id = auth.uid() and is_active
    ) then
      raise exception 'An active account is required.' using errcode = '42501';
    end if;
    new.target_id := null;
    new.institute_id := public.user_institute(auth.uid());
    new.created_at := now();
    new.details := jsonb_build_object('roles', (
      select jsonb_agg(role) from public.user_roles where user_id = auth.uid()
    ));
  end if;
  return new;
end $$;
create trigger audit_stamp_login before insert on public.audit_logs
for each row execute function public.stamp_login_audit();
revoke all on function public.stamp_login_audit() from public, anon, authenticated;

create or replace function public.super_admin_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_super_admin();
  select jsonb_build_object(
    'total', (select count(*) from public.profiles),
    'active', (select count(*) from public.profiles where is_active),
    'disabled', (select count(*) from public.profiles where not is_active),
    'unassigned', (select count(*) from public.profiles p where not exists (select 1 from public.user_roles r where r.user_id = p.id)),
    'roles', (select coalesce(jsonb_object_agg(role, total), '{}'::jsonb) from (select role, count(*) total from public.user_roles group by role) r),
    'institutes', (select coalesce(jsonb_agg(to_jsonb(i) order by i.code), '[]'::jsonb) from (
      select i.id, i.code, i.name, count(p.id) as users,
        count(p.id) filter (where p.is_active) as active,
        count(p.id) filter (where exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='student')) as students,
        count(p.id) filter (where exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='faculty')) as faculty,
        count(p.id) filter (where exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='admin')) as admins
      from public.institutes i left join public.profiles p on p.institute_id=i.id
      group by i.id
    ) i)
  ) into result;
  return result;
end $$;

create or replace function public.super_admin_users(
  p_search text default '', p_role public.app_role default null,
  p_institute_id uuid default null, p_active boolean default null,
  p_page integer default 1
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_super_admin();
  if p_page < 1 or p_page > 100000 or length(p_search) > 120 then raise exception 'Invalid filters.'; end if;
  with filtered as (
    select p.*, i.code as institute_code, i.name as institute_name,
      coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id=p.id), '[]'::jsonb) as roles
    from public.profiles p left join public.institutes i on i.id=p.institute_id
    where (p_search = '' or strpos(lower(p.full_name || ' ' || p.email || ' ' || coalesce(p.roll_number,'')), lower(p_search)) > 0)
      and (p_role is null or exists (select 1 from public.user_roles r where r.user_id=p.id and r.role=p_role))
      and (p_institute_id is null or p.institute_id=p_institute_id)
      and (p_active is null or p.is_active=p_active)
  ), page as (select * from filtered order by created_at desc, id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, id) from page), '[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.super_admin_activity(
  p_search text default '', p_action text default '', p_role public.app_role default null,
  p_institute_id uuid default null, p_page integer default 1
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_super_admin();
  if p_page < 1 or p_page > 100000 or length(p_search) > 120 then raise exception 'Invalid filters.'; end if;
  with filtered as (
    select a.*, coalesce(nullif(actor.full_name,''), actor.email, 'System') as actor_name,
      actor.email as actor_email, coalesce(nullif(target.full_name,''), target.email) as target_name,
      i.code as institute_code,
      coalesce(a.details->'actor_roles', a.details->'roles',
        (select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id=a.actor_id), '[]'::jsonb) as actor_roles
    from public.audit_logs a
      left join public.profiles actor on actor.id=a.actor_id
      left join public.profiles target on target.id=a.target_id
      left join public.institutes i on i.id=a.institute_id
    where (p_action='' or a.action=p_action)
      and (p_institute_id is null or a.institute_id=p_institute_id)
      and (p_search='' or strpos(lower(coalesce(actor.full_name,'') || ' ' || coalesce(actor.email,'') || ' ' || coalesce(target.full_name,'') || ' ' || a.action), lower(p_search)) > 0)
  ), matched as (select * from filtered where p_role is null or actor_roles ? p_role::text),
  page as (select * from matched order by created_at desc, id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total', (select count(*) from matched),
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, id) from page), '[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.super_admin_update_user(
  p_user_id uuid, p_full_name text, p_roll_number text, p_institute_id uuid,
  p_role public.app_role, p_is_active boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.profiles; previous_roles jsonb;
begin
  -- Serializes role/status changes so two managers cannot disable one another concurrently.
  perform pg_advisory_xact_lock(179155, 1);
  perform public.assert_super_admin();
  if p_role is null or p_is_active is null or nullif(trim(p_full_name),'') is null or length(trim(p_full_name)) > 120 or length(coalesce(p_roll_number,'')) > 40 then
    raise exception 'Enter a valid name, role, and roll number.';
  end if;
  if p_role <> 'super_admin' and p_institute_id is null then raise exception 'Choose an institute.'; end if;
  if p_institute_id is not null and not exists (select 1 from public.institutes where id=p_institute_id) then raise exception 'Institute not found.'; end if;
  select * into previous from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found.'; end if;
  select coalesce(jsonb_agg(role order by role),'[]'::jsonb) into previous_roles from public.user_roles where user_id=p_user_id;
  if p_user_id=auth.uid() and (not p_is_active or p_role<>'super_admin' or p_institute_id is distinct from previous.institute_id) then
    raise exception 'You cannot change your own access, role, or institute.';
  end if;
  if previous.is_active and previous_roles ? 'super_admin' and (not p_is_active or p_role<>'super_admin') and (
    select count(*) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='super_admin' and p.is_active
  ) <= 1 then raise exception 'Keep at least one active super admin.'; end if;
  update public.profiles set full_name=trim(p_full_name), roll_number=nullif(trim(p_roll_number),''),
    institute_id=p_institute_id, is_active=p_is_active where id=p_user_id;
  delete from public.user_roles where user_id=p_user_id;
  insert into public.user_roles(user_id,role) values (p_user_id,p_role);
  insert into public.audit_logs(actor_id,action,target_id,institute_id,details)
  values(auth.uid(), case when previous_roles='[]'::jsonb then 'user_created'
    when previous.is_active is distinct from p_is_active then case when p_is_active then 'user_activated' else 'user_deactivated' end
    when previous_roles <> jsonb_build_array(p_role) then 'role_changed' else 'user_updated' end,
    p_user_id,p_institute_id,jsonb_build_object('actor_roles',jsonb_build_array('super_admin'),
      'before',jsonb_build_object('name',previous.full_name,'roles',previous_roles,'active',previous.is_active,'institute_id',previous.institute_id),
      'after',jsonb_build_object('name',trim(p_full_name),'roles',jsonb_build_array(p_role),'active',p_is_active,'institute_id',p_institute_id)));
end $$;

create or replace function public.super_admin_save_institute(p_id uuid, p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid; previous jsonb;
begin
  perform pg_advisory_xact_lock(179155, 1);
  perform public.assert_super_admin();
  if p_code is null or upper(trim(p_code)) !~ '^[A-Z0-9]{2,12}$' or nullif(trim(p_name),'') is null or length(trim(p_name)) > 160 then
    raise exception 'Enter a 2-12 character institute code and a name of up to 160 characters.';
  end if;
  if p_id is null then
    insert into public.institutes(code,name) values(upper(trim(p_code)),trim(p_name)) returning id into saved_id;
  else
    select to_jsonb(i) into previous from public.institutes i where id=p_id for update;
    if not found then raise exception 'Institute not found.'; end if;
    update public.institutes set code=upper(trim(p_code)),name=trim(p_name) where id=p_id returning id into saved_id;
  end if;
  insert into public.audit_logs(actor_id,action,institute_id,details)
    values(auth.uid(),case when p_id is null then 'institute_created' else 'institute_updated' end,saved_id,
      jsonb_build_object('actor_roles',jsonb_build_array('super_admin'),'before',previous,'code',upper(trim(p_code)),'name',trim(p_name)));
  return saved_id;
end $$;

revoke all on function public.super_admin_overview() from public, anon;
revoke all on function public.super_admin_users(text,public.app_role,uuid,boolean,integer) from public, anon;
revoke all on function public.super_admin_activity(text,text,public.app_role,uuid,integer) from public, anon;
revoke all on function public.super_admin_update_user(uuid,text,text,uuid,public.app_role,boolean) from public, anon;
revoke all on function public.super_admin_save_institute(uuid,text,text) from public, anon;
grant execute on function public.super_admin_overview() to authenticated;
grant execute on function public.super_admin_users(text,public.app_role,uuid,boolean,integer) to authenticated;
grant execute on function public.super_admin_activity(text,text,public.app_role,uuid,integer) to authenticated;
grant execute on function public.super_admin_update_user(uuid,text,text,uuid,public.app_role,boolean) to authenticated;
grant execute on function public.super_admin_save_institute(uuid,text,text) to authenticated;

create index profiles_institute_id_idx on public.profiles(institute_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc, id);
notify pgrst, 'reload schema';
