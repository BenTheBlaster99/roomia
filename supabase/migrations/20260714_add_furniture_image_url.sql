-- Product hero photo for marketplace, studio cards, and IP-Adapter reference.
alter table public.furniture_items
  add column if not exists image_url text;

comment on column public.furniture_items.image_url is
  'Public URL to Sarah product photo (Supabase Storage product-images/)';
