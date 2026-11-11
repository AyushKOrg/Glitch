-- Glitch developer-access expansion. Run once in Supabase SQL Editor.
-- Keeps the existing two developers and adds the five newly approved accounts.

create or replace function public.get_glitch_vip_status()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();v_email text;
begin
 if v_user_id is null then raise exception 'Authentication required';end if;
 select lower(email) into v_email from auth.users where id=v_user_id;
 return jsonb_build_object('vip',v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com','aaravkrishprof@gmail.com','aayushispro67@gmail.com','aayushcmshri@gmail.com','aaravkrish713@gmail.com','aaravkrish0510@gmail.com') or exists(select 1 from public.glitch_vip_members where user_id=v_user_id),'developer',v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com','aaravkrishprof@gmail.com','aayushispro67@gmail.com','aayushcmshri@gmail.com','aaravkrish713@gmail.com','aaravkrish0510@gmail.com'));
end; $$;

create or replace function public.redeem_glitch_vip_code(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();v_email text;v_hash text;v_consumed_hash text;
begin
 if v_user_id is null then raise exception 'Authentication required';end if;
 if exists(select 1 from auth.users where id=v_user_id and is_anonymous=true) then raise exception 'Sign in with a registered account to redeem VIP access';end if;
 select lower(email) into v_email from auth.users where id=v_user_id;
 if v_email in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com','aaravkrishprof@gmail.com','aayushispro67@gmail.com','aayushcmshri@gmail.com','aaravkrish713@gmail.com','aaravkrish0510@gmail.com') then return jsonb_build_object('vip',true,'already_vip',true,'developer',true);end if;
 if exists(select 1 from public.glitch_vip_members where user_id=v_user_id) then return jsonb_build_object('vip',true,'already_vip',true);end if;
 if p_code is null or length(trim(p_code))<>13 then raise exception 'Invalid invite code';end if;
 v_hash:=encode(extensions.digest(upper(trim(p_code)),'sha256'),'hex');
 -- DELETE locks the row: only the first concurrent redemption can consume this code.
 delete from public.glitch_vip_active_code where singleton=true and code_hash=v_hash returning code_hash into v_consumed_hash;
 if v_consumed_hash is null then raise exception 'That VIP code is invalid, expired, or already used';end if;
 insert into public.glitch_vip_members(user_id) values(v_user_id) on conflict(user_id) do nothing;
 return jsonb_build_object('vip',true,'redeemed',true,'code_consumed',true);
end; $$;

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
  select (exists(select 1 from public.glitch_vip_members where user_id=v_user_id) or exists(select 1 from auth.users where id=v_user_id and lower(email) in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com','aaravkrishprof@gmail.com','aayushispro67@gmail.com','aayushcmshri@gmail.com','aaravkrish713@gmail.com','aaravkrish0510@gmail.com'))) into v_vip;
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
  select (exists(select 1 from public.glitch_vip_members where user_id=v_user_id) or exists(select 1 from auth.users where id=v_user_id and lower(email) in ('aayushyt2013@gmail.com','aarav.krish62442@gmail.com','aaravkrishprof@gmail.com','aayushispro67@gmail.com','aayushcmshri@gmail.com','aaravkrish713@gmail.com','aaravkrish0510@gmail.com'))) into v_vip;
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
