-- Optional glitch cloud sync. Run this in Supabase SQL Editor.
-- Row Level Security ensures each authenticated user can only access their own rows.
create table if not exists public.glitch_chats (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists glitch_chats_user_updated_idx on public.glitch_chats(user_id, updated_at desc);
alter table public.glitch_chats enable row level security;
drop policy if exists "Users can read their own glitch chats" on public.glitch_chats;
create policy "Users can read their own glitch chats" on public.glitch_chats for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own glitch chats" on public.glitch_chats;
create policy "Users can insert their own glitch chats" on public.glitch_chats for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their own glitch chats" on public.glitch_chats;
create policy "Users can update their own glitch chats" on public.glitch_chats for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own glitch chats" on public.glitch_chats;
create policy "Users can delete their own glitch chats" on public.glitch_chats for delete to authenticated using (auth.uid() = user_id);
