-- Store public profile + featured SKUs for the 2x2 catalogue preview.

alter table public.stores
  add column if not exists logo_url text,
  add column if not exists quartier text,
  add column if not exists whatsapp text,
  add column if not exists maps_url text;

comment on column public.stores.logo_url is 'Public catalog logo (storage catalog/stores/{id}/logo.*)';
comment on column public.stores.quartier is 'Neighbourhood, e.g. El Mouradia';
comment on column public.stores.whatsapp is 'Shop WhatsApp digits or +213…';
comment on column public.stores.maps_url is 'Google Maps URL, or a search address';

alter table public.furniture_items
  add column if not exists featured boolean not null default false;

comment on column public.furniture_items.featured is 'Show on the public 2x2 store preview (max 4 used).';

create index if not exists furniture_items_store_featured_idx
  on public.furniture_items (store_id)
  where featured;
