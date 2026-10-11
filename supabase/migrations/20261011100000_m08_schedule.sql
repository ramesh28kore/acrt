-- M08: institute schedule configuration only. Existing calendars, profiles and activity are untouched.
create table public.curriculum_schedule_settings (
  institute_id uuid primary key references public.institutes(id),
  version integer not null check (version > 0),
  settings jsonb not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table public.curriculum_schedule_history (
  institute_id uuid not null references public.institutes(id),
  version integer not null,
  settings jsonb not null,
  catalog_signature text not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  primary key (institute_id, version)
);
alter table public.curriculum_schedule_settings enable row level security;
alter table public.curriculum_schedule_history enable row level security;
revoke all on public.curriculum_schedule_settings, public.curriculum_schedule_history from public, anon, authenticated;
grant select on public.curriculum_schedule_settings, public.curriculum_schedule_history to authenticated;
grant all on public.curriculum_schedule_settings, public.curriculum_schedule_history to service_role;

create function public.schedule_admin_scope(p_institute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' and not is_disabled and
    (is_super_admin or institute_id = p_institute) from public.profiles where id = auth.uid()), false)
$$;
create policy schedule_settings_read on public.curriculum_schedule_settings for select to authenticated using (
  exists (select 1 from public.profiles p where p.id=auth.uid() and not p.is_disabled and p.institute_id=curriculum_schedule_settings.institute_id)
  or public.is_super_admin()
);
create policy schedule_history_read on public.curriculum_schedule_history for select to authenticated
  using (public.schedule_admin_scope(institute_id));

-- Covers all scheduling metadata, including question counts; never includes answers or student data.
create function public.schedule_catalog_signature() returns text
language sql stable security definer set search_path = '' as $$
  with catalog as (
    select 'topic' kind,id,to_jsonb(t) value from (select id,name,position,is_published from public.topics) t
    union all select 'sheet',id,to_jsonb(t) from (select id,topic_id,title,position,is_published from public.sheets) t
    union all select 'set',id,to_jsonb(t) from (select id,topic_id,name,position,is_published from public.sets) t
    union all select 'quiz',id,to_jsonb(t) from (select id,topic_id,name,position,is_published from public.mcq_sets) t
    union all select 'problem',id,to_jsonb(t) from (select id,topic_id,set_id,title,position from public.problems) t
    union all select 'question',id,to_jsonb(t) from (select id,mcq_set_id from public.mcqs) t
  ) select md5(coalesce(jsonb_agg(value order by kind,id)::text,'[]')) from catalog
$$;

create function public.schedule_context(p_institute uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare viewer public.profiles; campus uuid; saved public.curriculum_schedule_settings; editable boolean;
begin
  select * into viewer from public.profiles where id=auth.uid();
  if not found or viewer.is_disabled or not coalesce(viewer.role in ('student','faculty','admin'),false) then
    raise exception 'An active account is required.' using errcode='42501';
  end if;
  campus := coalesce(p_institute, viewer.institute_id);
  if campus is distinct from viewer.institute_id and not public.is_super_admin() then
    raise exception 'This institute is outside your access.' using errcode='42501';
  end if;
  if campus is not null and not exists(select 1 from public.institutes where id=campus) then
    raise exception 'Institute not found.' using errcode='22023';
  end if;
  editable := public.schedule_admin_scope(campus) and
    (public.admin_has_permission('schedule','configure') or public.admin_has_permission('schedule','edit'));
  select * into saved from public.curriculum_schedule_settings where institute_id=campus;
  return jsonb_build_object(
    'instituteId',campus,'version',coalesce(saved.version,0),
    'settings',coalesce(saved.settings,'{"dailyMinutes":120,"restDays":[0],"order":"topic-interleaved"}'::jsonb),
    'canConfigure',editable,
    'canExport',public.schedule_admin_scope(campus) and public.admin_has_permission('schedule','export'),
    'signature',case when viewer.role='admin' then public.schedule_catalog_signature() else null end,
    'academicStart',(select start_date from public.academic_years where is_active order by start_date desc,id limit 1)
  );
end $$;

create function public.schedule_publish(p_institute uuid,p_settings jsonb,p_expected_version integer,p_signature text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer; rest integer[]; context jsonb;
begin
  if p_institute is null then raise exception 'Choose an institute.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_institute::text,80108));
  context := public.schedule_context(p_institute);
  if not (context->>'canConfigure')::boolean then
    raise exception 'Schedule configuration permission is required.' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version <> (context->>'version')::integer then
    raise exception 'The schedule changed. Preview it again before publishing.' using errcode='40001';
  end if;
  if p_signature is null or p_signature is distinct from context->>'signature' then
    raise exception 'The curriculum changed. Preview it again before publishing.' using errcode='40001';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' or
    (select count(*) from jsonb_object_keys(p_settings)) <> 3 or
    not (p_settings ?& array['dailyMinutes','restDays','order']) or
    jsonb_typeof(p_settings->'dailyMinutes') is distinct from 'number' or
    (p_settings->>'dailyMinutes') !~ '^[0-9]+$' or
    (p_settings->>'dailyMinutes')::integer not between 15 and 1440 or
    jsonb_typeof(p_settings->'order') is distinct from 'string' or
    p_settings->>'order' not in ('stage-first','topic-first','topic-interleaved') or
    jsonb_typeof(p_settings->'restDays') is distinct from 'array' then
    raise exception 'Invalid schedule settings.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_settings->'restDays') d where jsonb_typeof(d) <> 'number' or d::text !~ '^[0-6]$') then
    raise exception 'Invalid rest days.' using errcode='22023';
  end if;
  select coalesce(array_agg(value::integer),'{}'::integer[]) into rest from jsonb_array_elements_text(p_settings->'restDays');
  if cardinality(rest)>6 or cardinality(rest)<>(select count(distinct d) from unnest(rest) d) then
    raise exception 'Keep at least one study day and choose unique rest days.' using errcode='22023';
  end if;
  if exists(select 1 from public.problems p join public.sets s on s.id=p.set_id
    join public.topics t on t.id=p.topic_id where s.is_published and t.is_published and s.topic_id<>p.topic_id) then
    raise exception 'Repair curriculum references before publishing.' using errcode='23514';
  end if;
  v := p_expected_version + 1;
  insert into public.curriculum_schedule_settings(institute_id,version,settings,updated_by)
    values(p_institute,v,p_settings,auth.uid()) on conflict(institute_id) do update
    set version=excluded.version,settings=excluded.settings,updated_by=excluded.updated_by,updated_at=now();
  insert into public.curriculum_schedule_history(institute_id,version,settings,catalog_signature,published_by)
    values(p_institute,v,p_settings,p_signature,auth.uid());
  return v;
end $$;
revoke all on function public.schedule_admin_scope(uuid), public.schedule_catalog_signature(),
  public.schedule_context(uuid),public.schedule_publish(uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.schedule_admin_scope(uuid),public.schedule_context(uuid),
  public.schedule_publish(uuid,jsonb,integer,text) to authenticated;
notify pgrst,'reload schema';
