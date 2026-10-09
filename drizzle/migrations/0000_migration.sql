create type public.app_role as enum ('student','faculty','admin','super_admin');

create table public.institutes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
grant select on public.institutes to authenticated;
grant all on public.institutes to service_role;
alter table public.institutes enable row level security;
insert into public.institutes (code, name) values
  ('PT','Avanthi Institute of Engineering & Technology (PT)'),
  ('Q6','Avanthi Institute of Engineering & Technology (Q6)');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  roll_number text,
  institute_id uuid references public.institutes(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_id uuid,
  institute_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.user_institute(_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select institute_id from public.profiles where id = _user_id
$$;

-- institutes
create policy "Signed-in users read institutes" on public.institutes for select to authenticated using (true);

-- profiles
create policy "Own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Super admin reads all profiles" on public.profiles for select to authenticated using (public.has_role(auth.uid(),'super_admin'));
create policy "Admin reads own college profiles" on public.profiles for select to authenticated
  using (public.has_role(auth.uid(),'admin') and institute_id = public.user_institute(auth.uid()));
create policy "Faculty reads own college profiles" on public.profiles for select to authenticated
  using (public.has_role(auth.uid(),'faculty') and institute_id = public.user_institute(auth.uid()));
create policy "Update own name" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- prevent users from changing protected columns on their own row
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.email := old.email;
    new.institute_id := old.institute_id;
    new.is_active := old.is_active;
    new.roll_number := old.roll_number;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile_columns();

-- user_roles
create policy "Own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Super admin reads roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(),'super_admin'));
create policy "Admin reads college roles" on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(),'admin') and public.user_institute(user_id) = public.user_institute(auth.uid()));

-- audit logs
create policy "Super admin reads audit" on public.audit_logs for select to authenticated using (public.has_role(auth.uid(),'super_admin'));
create policy "Admin reads college audit" on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(),'admin') and institute_id = public.user_institute(auth.uid()));
create policy "Users log own sign-in" on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and action = 'sign_in');

-- profile on new auth user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  if lower(new.email) = 'ramesh2kore@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'super_admin') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();