-- A SKU can belong to several of Sarah’s styles. No FK to public.styles:
-- that table is the old 5-slug set and is empty; source of truth is lib/style-details.ts.

create table if not exists public.furniture_style_tags (
  furniture_id uuid not null references public.furniture_items (id) on delete cascade,
  style_id text not null,
  created_at timestamptz not null default now(),
  primary key (furniture_id, style_id)
);

create index if not exists furniture_style_tags_style_idx
  on public.furniture_style_tags (style_id);

comment on table public.furniture_style_tags is
  'Many-to-many style tags. A sofa can be japandi and scandinavian.';

alter table public.furniture_style_tags enable row level security;

drop policy if exists "Public read furniture_style_tags" on public.furniture_style_tags;
create policy "Public read furniture_style_tags"
  on public.furniture_style_tags for select
  to anon, authenticated
  using (true);

drop policy if exists "Staff write furniture_style_tags" on public.furniture_style_tags;
create policy "Staff write furniture_style_tags"
  on public.furniture_style_tags for all
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

-- Seed from the old single style_id, plus a close neighbour.
insert into public.furniture_style_tags (furniture_id, style_id)
select id, style_id from public.furniture_items
where style_id in ('industrial', 'maximalism', 'minimalism')
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select id, 'bauhaus' from public.furniture_items where style_id = 'industrial'
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select id, 'glamour' from public.furniture_items where style_id = 'maximalism'
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select id, 'japandi' from public.furniture_items where style_id = 'minimalism'
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select id, v.style_id
from public.furniture_items i
cross join (values ('rustic'), ('exotic')) as v(style_id)
where i.style_id = 'traditional_algerian'
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select id, v.style_id
from public.furniture_items i
cross join (values ('scandinavian'), ('cottagecore')) as v(style_id)
where i.style_id = 'mediterranean_coastal'
on conflict do nothing;

-- First Hotelia pass — Sarah can correct later.
insert into public.furniture_style_tags (furniture_id, style_id)
select i.id, v.style_id
from public.furniture_items i
join public.stores s on s.id = i.store_id
cross join lateral (
  select unnest(
    case lower(i.name)
      when 'bed 1' then array['scandinavian', 'japandi']
      when 'big seat' then array['scandinavian', 'japandi']
      when 'big table with chairs' then array['rustic', 'scandinavian']
      when 'fluffy chair' then array['scandinavian', 'cottagecore']
      when 'mid chair' then array['industrial', 'bauhaus']
      when 'one seat' then array['minimalism', 'japandi']
      when 'sofa bizar' then array['maximalism', 'bohemian']
      when 'table 5 head' then array['industrial', 'minimalism']
      when 'table de nuit' then array['japandi', 'scandinavian']
      when 'table de nuit 2' then array['japandi', 'scandinavian']
      when 'two seat' then array['japandi', 'scandinavian']
      else array['scandinavian', 'japandi']
    end
  ) as style_id
) v
where s.slug = 'hotelia-space'
on conflict do nothing;

insert into public.furniture_style_tags (furniture_id, style_id)
select furniture_id, 'art_deco' from public.furniture_style_tags where style_id = 'glamour'
on conflict do nothing;
