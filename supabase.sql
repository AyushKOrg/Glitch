-- Glitch Supabase setup.
-- Run this complete script in Supabase SQL Editor after enabling Anonymous Sign-Ins.
-- All guest quota operations run with the caller's JWT; no service-role key is used.

-- Guest quota storage. Clients cannot read or modify this table directly.
create table if not exists public.glitch_guest_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used integer not null default 0 check (used >= 0 and used <= 30),
  updated_at timestamptz not null default now()
);

alter table public.glitch_guest_usage enable row level security;
revoke all on table public.glitch_guest_usage from public, anon, authenticated;

-- Atomically consume one message. Concurrent requests cannot exceed the 30-message limit.
create or replace function public.consume_guest_message()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_used integer;
  v_allowed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from auth.users
    where id = v_user_id and is_anonymous = true
  ) then
    raise exception 'This quota is only available to anonymous guest accounts';
  end if;

  insert into public.glitch_guest_usage (user_id, used)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  update public.glitch_guest_usage
  set used = used + 1, updated_at = now()
  where user_id = v_user_id and used < 30
  returning used into v_used;

  if found then
    v_allowed := true;
  else
    select used into v_used
    from public.glitch_guest_usage
    where user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'used', v_used,
    'remaining', greatest(30 - v_used, 0),
    'limit', 30,
    'allowed', v_allowed
  );
end;
$$;

-- Read the caller's own guest allowance.
create or replace function public.get_guest_message_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from auth.users
    where id = v_user_id and is_anonymous = true
  ) then
    raise exception 'This quota is only available to anonymous guest accounts';
  end if;

  select coalesce(
    (select used from public.glitch_guest_usage where user_id = v_user_id),
    0
  ) into v_used;

  return jsonb_build_object(
    'used', v_used,
    'remaining', greatest(30 - v_used, 0),
    'limit', 30
  );
end;
$$;

revoke all on function public.consume_guest_message() from public, anon;
revoke all on function public.get_guest_message_usage() from public, anon;
grant execute on function public.consume_guest_message() to authenticated;
grant execute on function public.get_guest_message_usage() to authenticated;


-- Private, account-scoped memory. Anonymous guest sessions can use it too;
-- each row is only visible to the authenticated owner through the caller's JWT.
create table if not exists public.glitch_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (user_id, content)
);

alter table public.glitch_memories enable row level security;
revoke all on table public.glitch_memories from public, anon, authenticated;
drop policy if exists "Users can read their own Glitch memories" on public.glitch_memories;
create policy "Users can read their own Glitch memories"
  on public.glitch_memories for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can add their own Glitch memories" on public.glitch_memories;
create policy "Users can add their own Glitch memories"
  on public.glitch_memories for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own Glitch memories" on public.glitch_memories;
create policy "Users can delete their own Glitch memories"
  on public.glitch_memories for delete to authenticated
  using (auth.uid() = user_id);
grant select, insert, delete on public.glitch_memories to authenticated;

-- Optional per-user chat table. RLS keeps each account's rows private.
create table if not exists public.glitch_chats (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists glitch_chats_user_updated_idx
  on public.glitch_chats(user_id, updated_at desc);

alter table public.glitch_chats enable row level security;

drop policy if exists "Users can read their own glitch chats" on public.glitch_chats;
create policy "Users can read their own glitch chats"
  on public.glitch_chats for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own glitch chats" on public.glitch_chats;
create policy "Users can insert their own glitch chats"
  on public.glitch_chats for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own glitch chats" on public.glitch_chats;
create policy "Users can update their own glitch chats"
  on public.glitch_chats for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own glitch chats" on public.glitch_chats;
create policy "Users can delete their own glitch chats"
  on public.glitch_chats for delete to authenticated
  using (auth.uid() = user_id);
