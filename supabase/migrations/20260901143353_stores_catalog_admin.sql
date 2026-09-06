-- Stores, extra product photos, Jack/Sarah staff allowlist.
-- Public can read catalog. Only staff_admins can write.

create table if not exists public.staff_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

comment on table public.staff_admins is
  'Jack/Sarah emails allowed to CRUD stores and catalog. Not partner Pro users.';

insert into public.staff_admins (email)
values ('aymen1889@outlook.fr')
on conflict (email) do nothing;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists stores_name_idx on public.stores (name);

comment on table public.stores is
  'Furniture partner magasin. Catalog pieces hang off store_id.';

alter table public.furniture_items
  add column if not exists store_id uuid references public.stores (id) on delete set null;

create index if not exists furniture_items_store_id_idx
  on public.furniture_items (store_id);

create table if not exists public.furniture_images (
  id uuid primary key default gen_random_uuid(),
  furniture_id uuid not null references public.furniture_items (id) on delete cascade,
  url text not null,
  storage_path text,
  kind text not null default 'extra' check (kind in ('hero', 'extra')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists furniture_images_furniture_idx
  on public.furniture_images (furniture_id, sort_order);

comment on table public.furniture_images is
  '2D shots per SKU. kind=hero is the Composer identity lock; extras are other angles.';

alter table public.staff_admins enable row level security;
alter table public.stores enable row level security;
alter table public.furniture_images enable row level security;

drop policy if exists "Staff read staff_admins" on public.staff_admins;
create policy "Staff read staff_admins"
  on public.staff_admins for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "Public read stores" on public.stores;
create policy "Public read stores"
  on public.stores for select
  to anon, authenticated
  using (true);

drop policy if exists "Staff write stores" on public.stores;
create policy "Staff write stores"
  on public.stores for all
  to authenticated
  using (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Public read furniture_images" on public.furniture_images;
create policy "Public read furniture_images"
  on public.furniture_images for select
  to anon, authenticated
  using (true);

drop policy if exists "Staff write furniture_images" on public.furniture_images;
create policy "Staff write furniture_images"
  on public.furniture_images for all
  to authenticated
  using (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Staff write furniture_items" on public.furniture_items;
create policy "Staff write furniture_items"
  on public.furniture_items for all
  to authenticated
  using (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do nothing;

drop policy if exists "Public read catalog bucket" on storage.objects;
create policy "Public read catalog bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'catalog');

drop policy if exists "Staff upload catalog bucket" on storage.objects;
create policy "Staff upload catalog bucket"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Staff update catalog bucket" on storage.objects;
create policy "Staff update catalog bucket"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Staff delete catalog bucket" on storage.objects;
create policy "Staff delete catalog bucket"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.staff_admins s
      where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
