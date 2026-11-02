create table if not exists public.kiko_brand_accounts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  handle text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.kiko_portfolios (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.kiko_brand_accounts(id) on delete cascade,
  name text not null,
  niche text not null default 'Marca personal',
  essence text not null default 'Claro, cercano y profesional',
  accent text not null default 'violet',
  created_at timestamptz not null default now()
);

create table if not exists public.kiko_recording_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.kiko_portfolios(id) on delete cascade,
  title text not null,
  script text not null default '',
  status text not null default 'recording',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kiko_scenes (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.kiko_recording_sessions(id) on delete cascade,
  position integer not null,
  title text not null,
  script text not null,
  selected_take_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.kiko_takes (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.kiko_recording_sessions(id) on delete cascade,
  scene_id uuid not null references public.kiko_scenes(id) on delete cascade,
  object_key text not null unique,
  mime_type text not null,
  bytes bigint not null,
  duration_ms integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.kiko_scenes
  drop constraint if exists kiko_scenes_selected_take_id_fkey;
alter table public.kiko_scenes
  add constraint kiko_scenes_selected_take_id_fkey
  foreign key (selected_take_id) references public.kiko_takes(id) on delete set null;

create index if not exists kiko_portfolios_owner_idx on public.kiko_portfolios(owner_id);
create index if not exists kiko_sessions_owner_idx on public.kiko_recording_sessions(owner_id, updated_at desc);
create index if not exists kiko_scenes_session_idx on public.kiko_scenes(session_id, position);
create index if not exists kiko_takes_scene_idx on public.kiko_takes(scene_id, created_at desc);

alter table public.kiko_brand_accounts enable row level security;
alter table public.kiko_portfolios enable row level security;
alter table public.kiko_recording_sessions enable row level security;
alter table public.kiko_scenes enable row level security;
alter table public.kiko_takes enable row level security;

grant select, insert, update, delete on public.kiko_brand_accounts to authenticated;
grant select, insert, update, delete on public.kiko_portfolios to authenticated;
grant select, insert, update, delete on public.kiko_recording_sessions to authenticated;
grant select, insert, update, delete on public.kiko_scenes to authenticated;
grant select, insert, update, delete on public.kiko_takes to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['kiko_brand_accounts','kiko_portfolios','kiko_recording_sessions','kiko_scenes','kiko_takes'] loop
    execute format('drop policy if exists "kiko_owner_select" on public.%I', table_name);
    execute format('drop policy if exists "kiko_owner_insert" on public.%I', table_name);
    execute format('drop policy if exists "kiko_owner_update" on public.%I', table_name);
    execute format('drop policy if exists "kiko_owner_delete" on public.%I', table_name);
    execute format('create policy "kiko_owner_select" on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy "kiko_owner_insert" on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy "kiko_owner_update" on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy "kiko_owner_delete" on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kiko-videos', 'kiko-videos', false, 1073741824, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kiko_video_select" on storage.objects;
drop policy if exists "kiko_video_insert" on storage.objects;
drop policy if exists "kiko_video_update" on storage.objects;
drop policy if exists "kiko_video_delete" on storage.objects;
create policy "kiko_video_select" on storage.objects for select to authenticated using (bucket_id = 'kiko-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kiko_video_insert" on storage.objects for insert to authenticated with check (bucket_id = 'kiko-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kiko_video_update" on storage.objects for update to authenticated using (bucket_id = 'kiko-videos' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'kiko-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kiko_video_delete" on storage.objects for delete to authenticated using (bucket_id = 'kiko-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
