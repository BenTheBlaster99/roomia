-- Run in Supabase SQL editor before: npm run generate-presets

create table if not exists public.room_presets (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  room_type text not null,
  style_id text,
  budget_tier text default 'comfortable',
  thumbnail_url text,
  room_config jsonb not null,
  furniture jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table public.room_presets enable row level security;

drop policy if exists "Public read room_presets" on public.room_presets;
create policy "Public read room_presets"
  on public.room_presets for select
  using (true);
