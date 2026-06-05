-- Run once in Supabase SQL Editor (Dashboard → SQL → New query)
-- Allows the anon/publishable key to read configurator data from the browser

create policy "Public read styles"
  on public.styles for select
  to anon, authenticated
  using (true);

create policy "Public read budget_ranges"
  on public.budget_ranges for select
  to anon, authenticated
  using (true);

create policy "Public read furniture_items"
  on public.furniture_items for select
  to anon, authenticated
  using (true);

create policy "Public read moodboard_images"
  on public.moodboard_images for select
  to anon, authenticated
  using (true);
