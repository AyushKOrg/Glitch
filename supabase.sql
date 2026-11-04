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


-- VIP invite system. Codes are stored only as SHA-256 hashes and can be redeemed once.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.glitch_vip_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);
create table if not exists public.glitch_vip_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.glitch_vip_codes enable row level security;
alter table public.glitch_vip_members enable row level security;
revoke all on table public.glitch_vip_codes from public, anon, authenticated;
revoke all on table public.glitch_vip_members from public, anon, authenticated;

create or replace function public.get_glitch_vip_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  return jsonb_build_object('vip', exists(select 1 from public.glitch_vip_members where user_id = v_user_id));
end;
$$;

create or replace function public.redeem_glitch_vip_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hash text;
  v_redeemed_by uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from auth.users where id = v_user_id and is_anonymous = true) then
    raise exception 'Sign in with a registered account to redeem VIP access';
  end if;
  if exists(select 1 from public.glitch_vip_members where user_id = v_user_id) then
    return jsonb_build_object('vip', true, 'already_vip', true);
  end if;
  if p_code is null or length(trim(p_code)) < 8 or length(trim(p_code)) > 100 then
    raise exception 'Invalid invite code';
  end if;
  v_hash := encode(extensions.digest(lower(trim(p_code)), 'sha256'), 'hex');
  update public.glitch_vip_codes
    set redeemed_by = v_user_id, redeemed_at = now()
    where code_hash = v_hash and redeemed_by is null
    returning redeemed_by into v_redeemed_by;
  if v_redeemed_by is null then raise exception 'That VIP code is invalid or has already been used'; end if;
  insert into public.glitch_vip_members(user_id) values (v_user_id)
    on conflict (user_id) do nothing;
  return jsonb_build_object('vip', true, 'redeemed', true);
end;
$$;

revoke all on function public.get_glitch_vip_status() from public, anon;
revoke all on function public.redeem_glitch_vip_code(text) from public, anon;
grant execute on function public.get_glitch_vip_status() to authenticated;
grant execute on function public.redeem_glitch_vip_code(text) to authenticated;

-- OWNER ONLY: create a one-time invite by replacing the example string, then run this
-- statement in the Supabase SQL Editor. Give the plain code to exactly one person.
-- insert into public.glitch_vip_codes(code_hash)
-- values (encode(extensions.digest(lower(trim('REPLACE-WITH-YOUR-PRIVATE-VIP-CODE')), 'sha256'), 'hex'));


-- Pollinations image-generation quota: 15 successful daily generations for free accounts.
-- VIP membership bypasses the counter. The database derives the account from auth.uid().
create table if not exists public.glitch_image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  used integer not null default 0 check (used >= 0 and used <= 15),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table public.glitch_image_usage enable row level security;
revoke all on table public.glitch_image_usage from public, anon, authenticated;

create or replace function public.get_glitch_image_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer := 0;
  v_vip boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select exists(select 1 from public.glitch_vip_members where user_id = v_user_id) into v_vip;
  select coalesce((select used from public.glitch_image_usage where user_id=v_user_id and usage_date=v_day),0) into v_used;
  return jsonb_build_object('vip',v_vip,'used',v_used,'remaining',case when v_vip then null else greatest(15-v_used,0) end,'limit',case when v_vip then null else 15 end,'date',v_day);
end;
$$;

create or replace function public.reserve_glitch_image_generation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer := 0;
  v_vip boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select exists(select 1 from public.glitch_vip_members where user_id = v_user_id) into v_vip;
  if v_vip then return jsonb_build_object('allowed',true,'vip',true,'used',0,'remaining',null,'limit',null); end if;
  insert into public.glitch_image_usage(user_id,usage_date,used)
  values(v_user_id,v_day,0) on conflict(user_id,usage_date) do nothing;
  update public.glitch_image_usage set used=used+1,updated_at=now()
    where user_id=v_user_id and usage_date=v_day and used<15 returning used into v_used;
  if not found then
    select used into v_used from public.glitch_image_usage where user_id=v_user_id and usage_date=v_day;
    return jsonb_build_object('allowed',false,'vip',false,'used',v_used,'remaining',0,'limit',15);
  end if;
  return jsonb_build_object('allowed',true,'vip',false,'used',v_used,'remaining',greatest(15-v_used,0),'limit',15);
end;
$$;

-- Refund a reserved slot if the upstream image request fails.
create or replace function public.refund_glitch_image_generation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.glitch_image_usage set used=greatest(used-1,0),updated_at=now()
    where user_id=v_user_id and usage_date=v_day returning used into v_used;
  return jsonb_build_object('refunded',found,'used',coalesce(v_used,0),'remaining',greatest(15-coalesce(v_used,0),0));
end;
$$;

revoke all on function public.get_glitch_image_usage() from public, anon;
revoke all on function public.reserve_glitch_image_generation() from public, anon;
revoke all on function public.refund_glitch_image_generation() from public, anon;
grant execute on function public.get_glitch_image_usage() to authenticated;
grant execute on function public.reserve_glitch_image_generation() to authenticated;
grant execute on function public.refund_glitch_image_generation() to authenticated;
