create table if not exists public.kiko_edit_jobs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.kiko_recording_sessions(id) on delete cascade,
  style text not null,
  objective text not null default '',
  status text not null default 'planned',
  stage text not null default 'Plan editorial listo',
  progress integer not null default 0 check (progress between 0 and 100),
  contract jsonb not null default '{}'::jsonb,
  result_object_key text,
  result_metadata jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kiko_edit_jobs_owner_idx
  on public.kiko_edit_jobs(owner_id, updated_at desc);
create index if not exists kiko_edit_jobs_session_idx
  on public.kiko_edit_jobs(session_id, created_at desc);

alter table public.kiko_edit_jobs enable row level security;
grant select, insert, update, delete on public.kiko_edit_jobs to authenticated;

drop policy if exists "kiko_owner_select" on public.kiko_edit_jobs;
drop policy if exists "kiko_owner_insert" on public.kiko_edit_jobs;
drop policy if exists "kiko_owner_update" on public.kiko_edit_jobs;
drop policy if exists "kiko_owner_delete" on public.kiko_edit_jobs;
create policy "kiko_owner_select" on public.kiko_edit_jobs
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "kiko_owner_insert" on public.kiko_edit_jobs
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "kiko_owner_update" on public.kiko_edit_jobs
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "kiko_owner_delete" on public.kiko_edit_jobs
  for delete to authenticated using ((select auth.uid()) = owner_id);
