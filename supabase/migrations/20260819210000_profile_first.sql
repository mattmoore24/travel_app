-- Profile-first restructure (founder review, 2026-08-19).
--
-- Trips stop being a side page and become the headline of a profile: you add
-- them there, other travelers read them there, and every overlap you share
-- with someone shows up rather than just the nearest one. That means two
-- deliberate changes to what other people can see:
--
--   * UPCOMING trips of a discoverable traveler are readable by any signed-in
--     traveler, not only by someone who already overlaps them. Travel plans
--     are the thing this app is for, and a profile that hides them is a
--     profile with nothing on it. Past trips stay private, blocked pairs and
--     hidden accounts stay invisible, and nothing here exposes live location
--     (brief §7 hard rule 2) — a plan for next month is not a position now.
--   * The matching horizon widens from 14 days to a season, so a trip you
--     book early still finds people.
--
-- Also adds the optional occupation/school line to profiles.

-- 1. Occupation / school -----------------------------------------------------

alter table public.profiles
  add column occupation text check (occupation is null or char_length(occupation) <= 80);

grant select (occupation) on public.profiles to authenticated;
grant update (occupation) on public.profiles to authenticated;

-- 2. Upcoming trips are part of a public profile -----------------------------

-- Kept: the old overlap policy still grants reads of trips that ended within
-- the last day (so a just-finished overlap does not vanish mid-conversation).
create policy trips_select_upcoming
  on public.trips for select to authenticated
  using (
    user_id <> auth.uid()
    and status = 'active'
    and end_date >= current_date
    and public.is_discoverable_owner(user_id)
    and not public.is_blocked_pair(user_id)
  );

-- One call for "everything this traveler has planned", city names included.
-- SECURITY INVOKER: the policy above is what decides, not this function.
create function public.traveler_trips(p_user_id uuid)
returns table (
  trip_id uuid,
  city_id int,
  city_name text,
  city_country text,
  start_date date,
  end_date date
)
language sql
stable
as $$
  select t.id, c.id, c.name, c.country_name, t.start_date, t.end_date
  from public.trips t
  join public.cities c on c.id = t.city_id
  where t.user_id = p_user_id
    and t.status = 'active'
    and t.end_date >= current_date
  order by t.start_date
$$;

revoke execute on function public.traveler_trips(uuid) from public, anon;

-- 3. Matching shows every overlap, over a season -----------------------------

drop function public.get_matches();

create function public.get_matches()
returns table (
  trip_id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  occupation text,
  gender public.gender,
  city_id int,
  city_name text,
  city_country text,
  overlap_start date,
  overlap_end date,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
as $$
  select
    theirs.id,
    theirs.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    p.occupation,
    p.gender,
    c.id,
    c.name,
    c.country_name,
    greatest(mine.start_date, theirs.start_date),
    least(mine.end_date, theirs.end_date),
    theirs.start_date,
    theirs.end_date,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = theirs.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
  from public.trips mine
  join public.trips theirs
    on theirs.city_id = mine.city_id
   and theirs.user_id <> mine.user_id
   and theirs.start_date <= mine.end_date
   and mine.start_date <= theirs.end_date
   and theirs.end_date >= current_date
  join public.profiles p on p.user_id = theirs.user_id
  join public.cities c on c.id = theirs.city_id
  where mine.user_id = auth.uid()
    and mine.status = 'active'
    and mine.end_date >= current_date
    -- A season, not a fortnight: someone who books three months out should
    -- still find the people who booked the same weeks.
    and greatest(mine.start_date, theirs.start_date) <= current_date + 180
  order by greatest(mine.start_date, theirs.start_date), theirs.created_at
$$;

revoke execute on function public.get_matches() from public, anon;

-- send_message_request's trip_match branch used the same 14-day horizon; it
-- has to agree with what the client can see or "say hi" fails on a traveler
-- the app just offered.
create or replace function public.send_message_request(
  p_recipient uuid,
  p_source public.request_source,
  p_first_message text,
  p_profile_element text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_verdict jsonb;
  v_status public.request_status;
  v_masked public.request_status;
  v_id uuid;
  v_shadowbanned boolean;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily request limit reached' using errcode = 'check_violation';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  -- ORACLE-PROOF ERRORS: every relationship failure raises the SAME message.
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable';
  end if;
  if public.has_accepted_chat(p_recipient) then
    raise exception 'already connected with this traveler';
  end if;

  if p_source = 'trip_match' then
    if not exists (
      select 1
      from public.trips mine
      join public.trips theirs
        on theirs.city_id = mine.city_id
       and theirs.start_date <= mine.end_date
       and mine.start_date <= theirs.end_date
       and theirs.end_date >= current_date
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date
        and greatest(mine.start_date, theirs.start_date) <= current_date + 180
    ) then
      raise exception 'recipient unavailable';
    end if;
  elsif p_source = 'pin' then
    if not exists (
      select 1
      from public.pins p
      join public.launch_cities lc on lc.city_id = p.city_id and lc.active
      where p.user_id = p_recipient and p.expires_at > now()
    ) then
      raise exception 'recipient unavailable';
    end if;
  else
    raise exception 'unknown request source';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  v_status := case
    when v_verdict ->> 'action' = 'block' then 'blocked_by_moderation'::public.request_status
    when public.config_flag('require_llm_moderation') then 'pending_moderation'::public.request_status
    else 'pending'::public.request_status
  end;

  v_masked := v_status;
  select status = 'shadowbanned' into v_shadowbanned
  from public.users where id = v_sender;
  if v_shadowbanned and v_status in ('pending', 'pending_moderation') then
    v_status := 'declined';
  end if;

  delete from public.message_requests
  where sender_id = v_sender and recipient_id = p_recipient
    and status = 'blocked_by_moderation';

  begin
    insert into public.message_requests
      (sender_id, recipient_id, source, profile_element, first_message,
       moderation_verdict, status)
    values
      (v_sender, p_recipient, p_source, p_profile_element, p_first_message,
       v_verdict, v_status)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'request already sent to this traveler';
  end;

  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_sender, 'message_request', v_id,
     case
       when v_status = 'blocked_by_moderation' then 'blocked'
       when v_status = 'declined' then 'shadowban_suppressed'
       when v_status = 'pending_moderation' then 'queued_for_llm'
       else 'stub_approved'
     end,
     'prefilter-v1', v_verdict);

  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_masked = 'pending',
    'queued', v_masked = 'pending_moderation',
    'blocked', v_masked = 'blocked_by_moderation');
end
$$;

-- 4. Handle gate: direct chats only ------------------------------------------
--
-- has_accepted_chat predates establishment rooms, so it matches ANY active
-- chat the pair both appear in via chat_participants. Rooms track membership
-- in room_members today, so nothing leaks — but the gate protects a hard rule
-- (brief §7: handles never visible pre-accept), and a gate that depends on
-- another table's current bookkeeping is one refactor away from being wrong.
create or replace function public.has_accepted_chat(owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants po
      on po.chat_id = c.id and po.user_id = owner_id
    join public.chat_participants pv
      on pv.chat_id = c.id and pv.user_id = auth.uid()
    where c.status = 'active'
      and c.kind = 'direct'
      and owner_id <> auth.uid()
  )
$$;
