-- One day of slack on "is this trip still live", everywhere.
--
-- The comparisons below run against the SERVER's current_date, which is UTC.
-- The app filters the same trips against the DEVICE's local date. In a launch
-- city west of UTC that gap opens every evening: in Mexico City (UTC-6) from
-- 18:00 local the server already thinks it is tomorrow, so a traveler whose
-- trip ends today drops out of matching while their own Travelers tab still
-- lists them, and a first message to them is refused with "recipient
-- unavailable" on what the app still calls their last day. East of UTC the
-- same gap opens in the early morning.
--
-- The fix is the convention this schema already set for itself: the trip
-- validation trigger and my_trips both already say `current_date - 1`.
-- Matching, traveler_trips, the featured traveler and the trip_match branch
-- of send_message_request did not, so they are brought into line. A day is
-- the smallest slack that covers every timezone in both directions, and it
-- costs at most one extra day of visibility for a trip that just ended.
--
-- The season-long +180 horizon and the featured traveler's +14 window answer
-- a different question and are deliberately untouched.
--
-- Every body below is copied verbatim from the migration that last defined
-- it, with only those comparisons changed.

-- 1. Someone else's trips, as their profile lists them ---------------------

create or replace function public.traveler_trips(p_user_id uuid)
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
security definer
set search_path = public
as $$
  select t.id, c.id, c.name, c.country_name, t.start_date, t.end_date
  from public.trips t
  join public.cities c on c.id = t.city_id
  where t.user_id = p_user_id
    and t.status = 'active'
    and t.end_date >= current_date - 1
    and auth.uid() is not null
    and (
      p_user_id = auth.uid()
      or (public.is_discoverable_owner(p_user_id) and not public.is_blocked_pair(p_user_id))
    )
  order by t.start_date
$$;

revoke execute on function public.traveler_trips(uuid) from public, anon;


-- 2. Matching ---------------------------------------------------------------

create or replace function public.get_matches()
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
  -- distinct on (theirs.id) needs ORDER BY to lead with that column, which
  -- is not the order anyone wants to read; so the dedupe happens inside and
  -- the soonest-shared-window-first ordering is restored outside it.
  select *
  from (
    select distinct on (theirs.id)
      theirs.id as trip_id,
      theirs.user_id as user_id,
      p.display_name as display_name,
      p.age as age,
      p.verified as verified,
      p.languages as languages,
      p.bio as bio,
      p.occupation as occupation,
      p.gender as gender,
      c.id as city_id,
      c.name as city_name,
      c.country_name as city_country,
      greatest(mine.start_date, theirs.start_date) as overlap_start,
      least(mine.end_date, theirs.end_date) as overlap_end,
      theirs.start_date as their_start,
      theirs.end_date as their_end,
      (select pp.storage_path from public.profile_photos pp
        where pp.user_id = theirs.user_id and pp.moderation_status = 'approved'
        order by pp.position limit 1) as photo_path
    from public.trips mine
    join public.trips theirs
      on theirs.city_id = mine.city_id
     and theirs.user_id <> mine.user_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.end_date >= current_date - 1
    join public.profiles p on p.user_id = theirs.user_id
    join public.cities c on c.id = theirs.city_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date - 1
      and greatest(mine.start_date, theirs.start_date) <= current_date + 180
    -- Earliest shared window wins when the viewer has two overlapping trips.
    order by theirs.id, greatest(mine.start_date, theirs.start_date)
  ) m
  order by m.overlap_start, m.their_start, m.trip_id
$$;

revoke execute on function public.get_matches() from public, anon;


-- 3. The first message, so anyone visible is also reachable -----------------

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
       and theirs.end_date >= current_date - 1
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date - 1
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


-- 4. The guest teaser -------------------------------------------------------

create or replace function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    c.name,
    t.start_date,
    t.end_date,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = t.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
  from public.trips t
  join public.profiles p on p.user_id = t.user_id
  join public.cities c on c.id = t.city_id
  join public.users u on u.id = t.user_id
  where t.city_id = p_city_id
    and t.status = 'active'
    and u.status = 'active'
    and p.onboarding_completed_at is not null
    and t.end_date >= current_date - 1
    and t.start_date <= current_date + 14
  order by
    (select count(*) from public.message_requests r
      where r.recipient_id = t.user_id
        and r.created_at > now() - interval '30 days') desc,
    p.verified desc,
    t.created_at desc
  limit 1
$$;

grant execute on function public.featured_traveler(int) to anon, authenticated;
