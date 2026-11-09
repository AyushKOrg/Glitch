-- Run once in Supabase SQL Editor for Glitch cloud synchronisation.
create table if not exists public.glitch_account_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.glitch_account_data enable row level security;
revoke all on table public.glitch_account_data from public, anon, authenticated;
drop policy if exists "Users can read their own Glitch account data" on public.glitch_account_data;
create policy "Users can read their own Glitch account data"
  on public.glitch_account_data for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own Glitch account data" on public.glitch_account_data;
create policy "Users can insert their own Glitch account data"
  on public.glitch_account_data for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own Glitch account data" on public.glitch_account_data;
create policy "Users can update their own Glitch account data"
  on public.glitch_account_data for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.glitch_account_data to authenticated;
