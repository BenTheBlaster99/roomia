-- Per-SKU placement size in metres (InstantMesh / catalog honesty).
alter table public.furniture_items
  add column if not exists width_m numeric,
  add column if not exists depth_m numeric,
  add column if not exists height_m numeric;

comment on column public.furniture_items.width_m is 'Placement width in metres';
comment on column public.furniture_items.depth_m is 'Placement depth in metres (front-back)';
comment on column public.furniture_items.height_m is 'Placement height in metres';
