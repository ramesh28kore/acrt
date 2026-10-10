-- Institute scope is derived from the acting account, never from client input.
create function public.admin_institute()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare campus uuid;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'An active admin account is required.' using errcode = '42501';
  end if;
  select institute_id into campus from public.profiles where id=auth.uid();
  if campus is null then raise exception 'Your admin account needs an institute. Contact the Super Admin.' using errcode = '42501'; end if;
  return campus;
end $$;

create function public.admin_dashboard_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campus uuid := public.admin_institute(); result jsonb;
begin
  select jsonb_build_object(
    'institute', (select jsonb_build_object('id',id,'code',code,'name',name) from public.institutes where id=campus),
    'total', count(*), 'active', count(*) filter (where p.is_active),
    'disabled', count(*) filter (where not p.is_active),
    'unassigned', count(*) filter (where not exists (select 1 from public.user_roles r where r.user_id=p.id)),
    'roles', (select coalesce(jsonb_object_agg(role,total),'{}'::jsonb) from (
      select r.role,count(*) total from public.user_roles r join public.profiles p on p.id=r.user_id where p.institute_id=campus group by r.role
    ) counts)
  ) into result from public.profiles p where p.institute_id=campus;
  return result;
end $$;

create function public.admin_dashboard_users(
  p_search text default '', p_role public.app_role default null,
  p_active boolean default null, p_page integer default 1
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campus uuid := public.admin_institute(); result jsonb;
begin
  if p_page is null or p_page < 1 or p_page > 100000 or p_search is null or length(p_search)>120 then raise exception 'Invalid filters.'; end if;
  with filtered as (
    select p.*, i.code institute_code, i.name institute_name,
      coalesce((select jsonb_agg(role order by role) from public.user_roles where user_id=p.id),'[]'::jsonb) roles
    from public.profiles p join public.institutes i on i.id=p.institute_id
    where p.institute_id=campus
      and (p_search='' or strpos(lower(p.full_name || ' ' || p.email || ' ' || coalesce(p.roll_number,'')),lower(p_search))>0)
      and (p_role is null or exists (select 1 from public.user_roles r where r.user_id=p.id and r.role=p_role))
      and (p_active is null or p.is_active=p_active)
  ), page as (select * from filtered order by created_at desc,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.admin_dashboard_activity(
  p_search text default '', p_action text default '', p_role public.app_role default null, p_page integer default 1
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campus uuid := public.admin_institute(); result jsonb;
begin
  if p_page is null or p_page<1 or p_page>100000 or p_search is null or length(p_search)>120 or p_action is null or length(p_action)>60 then raise exception 'Invalid filters.'; end if;
  with scoped as (
    select a.id,a.action,a.created_at,
      coalesce(nullif(actor.full_name,''),actor.email,case when a.actor_id is null then 'System' else 'Portal administrator' end) actor_name,
      actor.email actor_email,coalesce(nullif(target.full_name,''),target.email) target_name,
      i.code institute_code,
      coalesce(a.details->'actor_roles',a.details->'roles',
        (select jsonb_agg(role order by role) from public.user_roles where user_id=actor.id),'[]'::jsonb) actor_roles,
      '{}'::jsonb details
    from public.audit_logs a
      left join public.profiles actor on actor.id=a.actor_id and actor.institute_id=campus
      left join public.profiles target on target.id=a.target_id and target.institute_id=campus
      join public.institutes i on i.id=a.institute_id
    where a.institute_id=campus and (p_action='' or a.action=p_action)
  ), filtered as (
    select * from scoped where (p_role is null or actor_roles ? p_role::text)
      and (p_search='' or strpos(lower(actor_name || ' ' || coalesce(actor_email,'') || ' ' || coalesce(target_name,'') || ' ' || action),lower(p_search))>0)
  ), page as (select * from filtered order by created_at desc,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

-- Service-only: the server supplies the verified actor and a freshly created Auth ID.
create function public.admin_save_user(
  p_actor_id uuid, p_user_id uuid, p_full_name text, p_roll_number text,
  p_role public.app_role, p_is_active boolean, p_create boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare campus uuid; previous public.profiles; previous_roles jsonb;
begin
  perform pg_advisory_xact_lock(179155,1);
  if not public.has_role(p_actor_id,'admin') then raise exception 'An active admin account is required.' using errcode='42501'; end if;
  select institute_id into campus from public.profiles where id=p_actor_id;
  if campus is null then raise exception 'Your admin account needs an institute. Contact the Super Admin.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('student','faculty') then raise exception 'Admins can manage only student and faculty roles.' using errcode='42501'; end if;
  if p_is_active is null or p_create is null or nullif(trim(p_full_name),'') is null or length(trim(p_full_name))>120 or length(coalesce(p_roll_number,''))>40 then raise exception 'Enter a valid name, role, and roll number.'; end if;
  if p_user_id=p_actor_id then raise exception 'Only the Super Admin can change admin accounts.' using errcode='42501'; end if;
  select * into previous from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found.'; end if;
  select coalesce(jsonb_agg(role order by role),'[]'::jsonb) into previous_roles from public.user_roles where user_id=p_user_id;
  if previous_roles ?| array['admin','super_admin'] then raise exception 'Only the Super Admin can change admin accounts.' using errcode='42501'; end if;
  if p_create then
    if previous.institute_id is not null or previous.is_active or previous_roles<>'[]'::jsonb then raise exception 'This account has already been configured.' using errcode='42501'; end if;
  elsif previous.institute_id is distinct from campus then
    raise exception 'This account is outside your institute.' using errcode='42501';
  end if;
  update public.profiles set full_name=trim(p_full_name),roll_number=nullif(trim(p_roll_number),''),institute_id=campus,is_active=p_is_active where id=p_user_id;
  delete from public.user_roles where user_id=p_user_id;
  insert into public.user_roles(user_id,role) values(p_user_id,p_role);
  insert into public.audit_logs(actor_id,action,target_id,institute_id,details)
  values(p_actor_id,case when p_create then 'user_created'
    when previous.is_active is distinct from p_is_active then case when p_is_active then 'user_activated' else 'user_deactivated' end
    when previous_roles<>jsonb_build_array(p_role) then 'role_changed' else 'user_updated' end,
    p_user_id,campus,jsonb_build_object('actor_roles',jsonb_build_array('admin'),
      'before',jsonb_build_object('name',previous.full_name,'roles',previous_roles,'active',previous.is_active),
      'after',jsonb_build_object('name',trim(p_full_name),'roles',jsonb_build_array(p_role),'active',p_is_active)));
end $$;

revoke all on function public.admin_institute() from public,anon;
revoke all on function public.admin_dashboard_overview() from public,anon;
revoke all on function public.admin_dashboard_users(text,public.app_role,boolean,integer) from public,anon;
revoke all on function public.admin_dashboard_activity(text,text,public.app_role,integer) from public,anon;
revoke all on function public.admin_save_user(uuid,uuid,text,text,public.app_role,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_institute() to authenticated;
grant execute on function public.admin_dashboard_overview() to authenticated;
grant execute on function public.admin_dashboard_users(text,public.app_role,boolean,integer) to authenticated;
grant execute on function public.admin_dashboard_activity(text,text,public.app_role,integer) to authenticated;
grant execute on function public.admin_save_user(uuid,uuid,text,text,public.app_role,boolean,boolean) to service_role;
create index audit_logs_institute_created_idx on public.audit_logs(institute_id,created_at desc,id);
notify pgrst, 'reload schema';
