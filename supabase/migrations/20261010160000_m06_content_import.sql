-- M06: content-import bookkeeping. Additive; no existing table, policy or function is changed.
-- Written only by the importer (importer/), which connects as the database owner. Readable by super admins.
-- Do NOT apply to a populated database before it has passed supabase/tests/m06_content_import.sql on an
-- isolated copy and the owner has approved it.

create table if not exists public.content_import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  command text not null check (command in ('apply', 'verify', 'keys', 'restore')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'aborted')),
  target_host text not null,
  source_fingerprint text,
  counts jsonb not null default '{}'::jsonb,
  note text
);

-- What the importer last wrote for each row: the hash of the import-owned columns, so a later run can tell an
-- unedited row (current = written) from one that was edited by hand (current <> written).
create table if not exists public.content_import_state (
  entity_type text not null check (entity_type in
    ('topic', 'set', 'problem', 'sheet', 'mcq_set', 'mcq', 'solution', 'case', 'answer_key')),
  entity_id uuid not null,
  source_hash text not null,
  written_hash text not null,
  -- Prior import-owned columns of an updated row, for restore. Never kept for answer keys.
  previous_row jsonb,
  run_id uuid references public.content_import_runs (id) on delete set null,
  imported_at timestamptz not null default now(),
  primary key (entity_type, entity_id),
  constraint content_import_state_no_key_copy check (entity_type <> 'answer_key' or previous_row is null)
);
create index if not exists content_import_state_run_idx on public.content_import_state (run_id);

create table if not exists public.content_import_issues (
  id bigint generated always as identity primary key,
  run_id uuid references public.content_import_runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  severity text not null check (severity in ('error', 'warning', 'info')),
  code text not null,
  entity_type text,
  entity_id text,
  source_path text,
  message text not null,
  context jsonb not null default '{}'::jsonb
);
create index if not exists content_import_issues_run_idx on public.content_import_issues (run_id, severity);

alter table public.content_import_runs enable row level security;
alter table public.content_import_state enable row level security;
alter table public.content_import_issues enable row level security;

revoke all on public.content_import_runs, public.content_import_state, public.content_import_issues from public, anon, authenticated;
grant select on public.content_import_runs, public.content_import_state, public.content_import_issues to authenticated;

drop policy if exists content_import_runs_select on public.content_import_runs;
create policy content_import_runs_select on public.content_import_runs for select to authenticated using (public.is_super_admin());
drop policy if exists content_import_state_select on public.content_import_state;
create policy content_import_state_select on public.content_import_state for select to authenticated using (public.is_super_admin());
drop policy if exists content_import_issues_select on public.content_import_issues;
create policy content_import_issues_select on public.content_import_issues for select to authenticated using (public.is_super_admin());
