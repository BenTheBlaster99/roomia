-- Pro Dashboard workspace: uploads + stacked generations per user.
-- Apply via Supabase SQL Editor or `supabase db push`.

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('upload', 'generation')),
  name text not null,
  storage_path text not null,
  public_url text not null,
  parent_id uuid null references public.workspace_files (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_files_user_created_idx
  on public.workspace_files (user_id, created_at desc);

create index if not exists workspace_files_parent_idx
  on public.workspace_files (parent_id);

comment on table public.workspace_files is
  'Pro Dashboard Drive: user uploads and AI generations (stacked via parent_id).';

alter table public.workspace_files enable row level security;

drop policy if exists "Users select own workspace_files" on public.workspace_files;
create policy "Users select own workspace_files"
  on public.workspace_files for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own workspace_files" on public.workspace_files;
create policy "Users insert own workspace_files"
  on public.workspace_files for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own workspace_files" on public.workspace_files;
create policy "Users update own workspace_files"
  on public.workspace_files for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own workspace_files" on public.workspace_files;
create policy "Users delete own workspace_files"
  on public.workspace_files for delete
  to authenticated
  using (auth.uid() = user_id);

-- Supabase Storage fallback bucket (used when R2 env vars are absent).
insert into storage.buckets (id, name, public)
values ('workspace', 'workspace', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Users read own workspace objects" on storage.objects;
create policy "Users read own workspace objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users insert own workspace objects" on storage.objects;
create policy "Users insert own workspace objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspace'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own workspace objects" on storage.objects;
create policy "Users update own workspace objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workspace'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'workspace'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own workspace objects" on storage.objects;
create policy "Users delete own workspace objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'workspace'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read for rendered <img> tags (bucket is public).
drop policy if exists "Public read workspace objects" on storage.objects;
create policy "Public read workspace objects"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'workspace');
