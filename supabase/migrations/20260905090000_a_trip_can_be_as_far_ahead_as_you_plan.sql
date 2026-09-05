-- A trip can be as far ahead as somebody plans, and the queue can be one
-- trip at a time.
--
-- Founder, 2026-09-04: "people could even put trips on their profile for the
-- full year at the beginning of the year in an extreme case (or even
-- earlier, there'd be no limit)" and "users should be able to select one,
-- multiple, or all of their planned trips to be shown in the travelers
-- section". Two changes, made together because they are the same fact read
-- three ways:
--
-- 1. THE HORIZON COMES OUT. overlaps_own_trip (the trips_select_overlap
--    policy's predicate), get_matches and send_message_request all cut an
--    overlap off at current_date + 180. That was "a season" when the app
--    launched with four cities; it is a limit on planning now, and the three
--    are restated without it so they still agree about who is reachable. The
--    other guards stand: an active trip, dates that cross, the radius from
--    the caller's own city, and discovery_pair_ok both ways.
--
-- 2. get_matches TAKES THE CALLER'S OWN TRIP IDS. `p_trip_ids uuid[] default
--    null` narrows the queue to some of the caller's trips; null is every
--    trip, so daily_spotlight's zero-argument call is unchanged. The ids are
--    joined to `trips where user_id = auth.uid()`, so an id that is not the
--    caller's filters to nothing rather than to somebody else's queue. It is
--    still the ONLY argument, and it is still not a coordinate (§7 rule 2):
--    every distance stays city centre to city centre. A parameter is a new
--    signature, so the zero-argument function is dropped first and the
--    grants restated.
--
-- The selection is a view preference. It changes nothing about who can see
-- the person: their profile is shown to everyone the audience setting
-- allows, on every trip, whichever trips they are looking at.
--
-- One reader keeps the number: expire_message_requests
-- (20260831194500) still says `start_date <= sent + 180` when choosing
-- which of the sender's trips can hold a hello open. Under its own
-- `least(trip window, sent + 30)` cap the term cannot change a result -
-- a trip starting more than 180 days after the send ends later than the
-- 30-day cap does - so it is left as it is rather than restated for no
-- effect, and this comment is where the next reader learns that.

create or replace function public.overlaps_own_trip(p_city_id int, p_start date, p_end date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips mine
    join public.profiles me on me.user_id = mine.user_id
    join public.cities_within_km(mine.city_id, me.travelers_radius_km) near
      on near.id = p_city_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.start_date <= p_end
      and p_start <= mine.end_date
  )
$$;
revoke execute on function public.overlaps_own_trip(int, date, date) from public, anon;

drop function public.get_matches();
create function public.get_matches(p_trip_ids uuid[] default null)
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
  photo_path text,
  distance_km int,
  my_city_id int,
  my_city_name text
)
language sql
stable
as $$
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
        order by pp.position limit 1) as photo_path,
      round(public.haversine_km(mc.lat, mc.lng, c.lat, c.lng))::int as distance_km,
      mc.id as my_city_id,
      mc.name as my_city_name
    from public.trips mine
    join public.cities mc on mc.id = mine.city_id
    join public.profiles me on me.user_id = mine.user_id
    join public.cities_within_km(mine.city_id, me.travelers_radius_km) c on true
    join public.trips theirs
      on theirs.city_id = c.id
     and theirs.user_id <> mine.user_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.end_date >= current_date - 1
    join public.profiles p on p.user_id = theirs.user_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date - 1
      -- The picker on the tab: some of MY trips, or all of them.
      and (p_trip_ids is null or mine.id = any(p_trip_ids))
      -- Who can see you, both ways.
      and public.discovery_pair_ok(auth.uid(), theirs.user_id)
    -- Nearest of my trips first when two of them reach the same person.
    order by theirs.id, greatest(mine.start_date, theirs.start_date),
             public.haversine_km(mc.lat, mc.lng, c.lat, c.lng)
  ) m
  order by m.overlap_start, m.their_start, m.trip_id
$$;
revoke execute on function public.get_matches(uuid[]) from public, anon;
grant execute on function public.get_matches(uuid[]) to authenticated;

comment on function public.get_matches(uuid[]) is
  'The Travelers queue: everybody with an active trip within the caller''s '
  'travelers_radius_km of one of the caller''s own trip cities, on '
  'overlapping dates, however far ahead. p_trip_ids narrows it to some of '
  'the caller''s trips (null is all of them) and is the only argument: it '
  'is never a coordinate, and every distance is city centre to city centre. '
  'SECURITY INVOKER - the trips_select_overlap policy decides which rows '
  'exist at all.';

-- The hello, restated without the horizon. Body otherwise verbatim from
-- 20260904200000.
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
  v_cap int;
  v_sent_today int;
  v_city int;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'not_authenticated';
  end if;
  perform public.assert_good_standing();

  -- THE DAILY CAP.
  --
  -- Checked before anything about the recipient, on purpose: the answer is
  -- then identical whoever you aimed at, so a capped sender learns nothing
  -- about who exists, who blocked them, or who is discoverable.
  --
  -- This returns rather than raising, because it is not an error - it is the
  -- app saying you have done enough for one day, and the composer says so
  -- warmly. And it is a SAFETY limit, never a tier: hard rule 1 says the core
  -- is free, so this must never be sold back as "more hellos per day".
  -- Serialised per sender, the way every other counted cap in this schema
  -- is (trips, pins, photos, strikes, verification, group creation).
  perform pg_advisory_xact_lock(hashtext('first_messages:' || v_sender::text));
  select coalesce(
    (select (value #>> '{}')::int from public.app_config
      where key = 'first_messages_per_day'), 8)
  into v_cap;
  select count(*)::int into v_sent_today
  from public.message_requests
  where sender_id = v_sender and created_at >= date_trunc('day', now());
  if v_sent_today >= v_cap then
    return jsonb_build_object(
      'request_id', null, 'delivered', false, 'queued', false, 'blocked', false,
      'capped', true, 'allowed', v_cap, 'used', v_sent_today,
      'category', null);
  end if;

  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily limit for saying hi reached'
      using errcode = 'check_violation', hint = 'hello_daily_cap';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot say hi to yourself';
  end if;
  -- ORACLE-PROOF ERRORS: every relationship failure raises the SAME message
  -- and the SAME hint.
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
  end if;
  if public.has_accepted_chat(p_recipient) then
    raise exception 'already connected with this traveler' using hint = 'already_connected';
  end if;

  -- Both branches SELECT the city they are proving exists; a null answer
  -- folds into the SAME oracle-proof 'recipient unavailable' with the SAME
  -- hint, so no branch can leak a new fact about who is out there.
  if p_source = 'trip_match' then
    -- The SENDER's radius from the SENDER's city: exactly the reach of the
    -- queue the hello was sent from, so a person the queue showed is never
    -- refused here.
    select mine.city_id into v_city
    from public.trips mine
    join public.profiles me on me.user_id = mine.user_id
    join public.cities_within_km(mine.city_id, me.travelers_radius_km) near on true
    join public.trips theirs
      on theirs.city_id = near.id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.end_date >= current_date - 1
    where mine.user_id = v_sender and mine.status = 'active'
      and theirs.user_id = p_recipient and theirs.status = 'active'
      and mine.end_date >= current_date - 1
    -- Deterministic when two travelers overlap in more than one city: the one
    -- they are in soonest is the one the hello is about.
    order by greatest(mine.start_date, theirs.start_date), mine.city_id
    limit 1;
    if v_city is null then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  elsif p_source = 'pin' then
    select p.city_id into v_city
    from public.pins p
    where p.user_id = p_recipient and p.expires_at > now()
    -- The pin with longest left is the one somebody is answering.
    order by p.expires_at desc, p.city_id
    limit 1;
    if v_city is null then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  else
    raise exception 'unknown source for saying hi';
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
       moderation_verdict, status, city_id)
    values
      (v_sender, p_recipient, p_source, p_profile_element, p_first_message,
       v_verdict, v_status, v_city)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already said hi to this traveler'
      using hint = 'hello_already_sent';
  end;

  -- 'prefilter_blocked', NOT 'blocked'. The regex said maybe; nobody read the
  -- sentence; the app then told the writer to reword it and send again. That
  -- is not evidence of anything, so it is audited (the creep metric needs it)
  -- and kept off is_strike_action's list.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_sender, 'message_request', v_id,
     case
       when v_status = 'blocked_by_moderation' then 'prefilter_blocked'
       when v_status = 'declined' then 'shadowban_suppressed'
       when v_status = 'pending_moderation' then 'queued_for_llm'
       else 'stub_approved'
     end,
     'prefilter-v1', v_verdict);

  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_masked = 'pending',
    'queued', v_masked = 'pending_moderation',
    'blocked', v_masked = 'blocked_by_moderation',
    'capped', false,
    'allowed', v_cap,
    'used', v_sent_today + 1,
    'category', case when v_masked = 'blocked_by_moderation'
                     then v_verdict ->> 'category' else null end);
end
$$;
revoke execute on function public.send_message_request(uuid, public.request_source, text, text)
  from public, anon;
grant execute on function public.send_message_request(uuid, public.request_source, text, text)
  to authenticated;
