-- Glitch private cloud Library.
insert into storage.buckets (id, name, public, file_size_limit)
values ('glitch-library', 'glitch-library', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

create table if not exists public.glitch_library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  source text not null default 'upload' check (source in ('upload','generated')),
  created_at timestamptz not null default now()
);
alter table public.glitch_library_items enable row level security;
revoke all on table public.glitch_library_items from public, anon, authenticated;
drop policy if exists "Glitch Library select own items" on public.glitch_library_items;
create policy "Glitch Library select own items" on public.glitch_library_items
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Glitch Library insert own items" on public.glitch_library_items;
create policy "Glitch Library insert own items" on public.glitch_library_items
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Glitch Library delete own items" on public.glitch_library_items;
create policy "Glitch Library delete own items" on public.glitch_library_items
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, delete on public.glitch_library_items to authenticated;

drop policy if exists "Glitch Library read own objects" on storage.objects;
create policy "Glitch Library read own objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'glitch-library' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Glitch Library upload own objects" on storage.objects;
create policy "Glitch Library upload own objects" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'glitch-library' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Glitch Library delete own objects" on storage.objects;
create policy "Glitch Library delete own objects" on storage.objects
  for delete to authenticated using (
    bucket_id = 'glitch-library' and (storage.foldername(name))[1] = auth.uid()::text
  );
