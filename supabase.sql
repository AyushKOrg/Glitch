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


-- Daily Glitch VIP code system. Codes are single-use; only a SHA-256 hash and encrypted copy are stored.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.glitch_vip_active_code (
 singleton boolean primary key default true check(singleton),
 code_hash text not null check(code_hash ~ '^[0-9a-f]{64}$'),
 code_ciphertext text,
 rotated_at timestamptz not null default now()
);
alter table public.glitch_vip_active_code add column if not exists code_ciphertext text;
create table if not exists public.glitch_vip_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default now()
);
alter table public.glitch_vip_active_code enable row level security;
alter table public.glitch_vip_members enable row level security;
revoke all on table public.glitch_vip_active_code from public,anon,authenticated;
revoke all on table public.glitch_vip_members from public,anon,authenticated;
create or replace function public.get_glitch_vip_status()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();v_email text;
begin
 if v_user_id is null then raise exception 'Authentication required';end if;
 select lower(email) into v_email from auth.users where id=v_user_id;
 return jsonb_build_object('vip',v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com') or exists(select 1 from public.glitch_vip_members where user_id=v_user_id),'developer',v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com'));
end; $$;
create or replace function public.redeem_glitch_vip_code(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();v_email text;v_hash text;v_consumed_hash text;
begin
 if v_user_id is null then raise exception 'Authentication required';end if;
 if exists(select 1 from auth.users where id=v_user_id and is_anonymous=true) then raise exception 'Sign in with a registered account to redeem VIP access';end if;
 select lower(email) into v_email from auth.users where id=v_user_id;
 if v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com') then return jsonb_build_object('vip',true,'already_vip',true,'developer',true);end if;
 if exists(select 1 from public.glitch_vip_members where user_id=v_user_id) then return jsonb_build_object('vip',true,'already_vip',true);end if;
 if p_code is null or length(trim(p_code))<>13 then raise exception 'Invalid invite code';end if;
 v_hash:=encode(extensions.digest(upper(trim(p_code)),'sha256'),'hex');
 -- DELETE locks the row: only the first concurrent redemption can consume this code.
 delete from public.glitch_vip_active_code where singleton=true and code_hash=v_hash returning code_hash into v_consumed_hash;
 if v_consumed_hash is null then raise exception 'That VIP code is invalid, expired, or already used';end if;
 insert into public.glitch_vip_members(user_id) values(v_user_id) on conflict(user_id) do nothing;
 return jsonb_build_object('vip',true,'redeemed',true,'code_consumed',true);
end; $$;
drop function if exists public.rotate_glitch_vip_code(text,text);
create or replace function public.rotate_glitch_vip_code(p_code_hash text,p_code_ciphertext text,p_secret text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_secret text;
begin
 if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid code hash';end if;
 if p_code_ciphertext is null or length(p_code_ciphertext)<40 or length(p_code_ciphertext)>512 then raise exception 'Invalid encrypted code';end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='glitch_vip_rotation_secret' limit 1;
 if v_secret is null or p_secret is distinct from v_secret then raise exception 'Not authorised to rotate VIP code';end if;
 insert into public.glitch_vip_active_code(singleton,code_hash,code_ciphertext,rotated_at) values(true,p_code_hash,p_code_ciphertext,now())
 on conflict(singleton) do update set code_hash=excluded.code_hash,code_ciphertext=excluded.code_ciphertext,rotated_at=excluded.rotated_at;
 return jsonb_build_object('rotated',true);
end; $$;
create or replace function public.get_glitch_vip_code(p_secret text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_secret text;v_ciphertext text;
begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='glitch_vip_rotation_secret' limit 1;
 if v_secret is null or p_secret is distinct from v_secret then raise exception 'Not authorised to view VIP code';end if;
 select code_ciphertext into v_ciphertext from public.glitch_vip_active_code where singleton=true;
 if v_ciphertext is null then raise exception 'No active VIP code';end if;
 return v_ciphertext;
end; $$;
revoke all on function public.get_glitch_vip_status() from public,anon;
revoke all on function public.redeem_glitch_vip_code(text) from public,anon;
revoke all on function public.rotate_glitch_vip_code(text,text,text) from public,anon,authenticated;
revoke all on function public.get_glitch_vip_code(text) from public;
grant execute on function public.get_glitch_vip_status() to authenticated;
grant execute on function public.redeem_glitch_vip_code(text) to authenticated;
grant execute on function public.rotate_glitch_vip_code(text,text,text) to anon,authenticated;
grant execute on function public.get_glitch_vip_code(text) to anon,authenticated;

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
  select (exists(select 1 from public.glitch_vip_members where user_id=v_user_id) or exists(select 1 from auth.users where id=v_user_id and lower(email) in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com'))) into v_vip;
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
  select (exists(select 1 from public.glitch_vip_members where user_id=v_user_id) or exists(select 1 from auth.users where id=v_user_id and lower(email) in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com'))) into v_vip;
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

 
-- Unified private cloud snapshot for account chat history, profile and preferences.
-- The API validates the authenticated user and writes with their JWT; RLS provides
-- an additional owner-only boundary. This does not store credentials or auth tokens.
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
