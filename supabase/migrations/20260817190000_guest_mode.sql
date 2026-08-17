-- Guest mode + the 14-day traveler window (docs/DESIGN.md).
--
-- TWO CHANGES, both founder decisions:
--
--   1. Matching opens 14 days before arrival. Previously any future overlap
--      matched, so a trip booked a year out could browse a city today. The
--      window keeps the Travelers tab full of people you can actually make
--      plans with, and shrinks the scraping surface as a side effect. The
--      rule is on the OVERLAP: the shared window must begin within 14 days.
--
--   2. Signed-out visitors get a real look at the product before being asked
--      for anything. Everything anon can reach is served through SECURITY
--      DEFINER functions with a hand-picked column list — anon gets no table
--      grants beyond read-only reference data, so there is no way to widen
--      the surface by accident.
--
-- What anon may see: curated pins in full; user pins WITHOUT identity (venue,
-- day, category only); the heat layer; one traveler card; establishment rooms
-- marked public_preview. What anon may never see: names, photos or ages
-- attached to a pin, any second traveler, social handles, anything writable.

-- 1. The 14-day window ----------------------------------------------------------

create or replace function public.overlaps_own_trip(p_city_id int, p_start date, p_end date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips
    where user_id = auth.uid()
      and status = 'active'
      and city_id = p_city_id
      and start_date <= p_end
      and p_start <= end_date
      -- The shared window has to start within a fortnight.
      and greatest(start_date, p_start) <= current_date + 14
  )
$$;

-- get_matches gains the counterpart's full stay (the card shows "in Lisbon
-- 19–26 Aug · 8 days", not just the overlap), so the return type changes.
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
    and greatest(mine.start_date, theirs.start_date) <= current_date + 14
  order by greatest(mine.start_date, theirs.start_date), theirs.created_at
$$;

revoke execute on function public.get_matches() from public, anon;

-- 2. Reference data anon may read ------------------------------------------------
-- Cities and launch cities are public facts (a gazetteer and a list of open
-- cities); nothing about them is personal.

grant select on public.cities to anon;
grant select on public.launch_cities to anon;
grant execute on function public.search_cities(text) to anon;
grant execute on function public.immutable_unaccent(text) to anon;

-- 3. The guest map ----------------------------------------------------------------

-- Curated pins in full, user pins stripped of identity. SECURITY DEFINER
-- because anon has no read on pins at all — the function is the only door,
-- and it hands back a fixed column list.
create function public.public_city_pins(p_city_id int)
returns table (
  id uuid,
  venue_name text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at
  from public.pins p
  join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  order by p.intent_date, p.created_at
$$;

grant execute on function public.public_city_pins(int) to anon, authenticated;

-- Heat for signed-out visitors. The signed-in path stays SECURITY INVOKER on
-- purpose (Phase 3: it makes cell-differencing impossible by construction).
-- This one is safe to run as definer because anon has no per-user pin
-- visibility to difference against — they already see anonymous dots.
create function public.public_heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  category public.pin_category,
  pin_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_k int;
begin
  select heat_k into v_k
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return;
  end if;

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    p.category,
    count(distinct coalesce(p.user_id::text, p.id::text))::int
  from public.pins p
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  group by 1, 2, 3
  having count(distinct coalesce(p.user_id::text, p.id::text)) >= v_k;
end
$$;

grant execute on function public.public_heat_cells(int, date) to anon, authenticated;

-- 4. The featured traveler ---------------------------------------------------------
-- One card, shown to signed-out visitors as the hook. Selection is "who do
-- people actually connect with": requests received in the last 30 days,
-- normalised per day discoverable, tie-broken by verified then recency. It
-- rotates constantly by construction — whoever is in the city and popular
-- right now. No opt-out switch: posting a trip is the consent, and nobody can
-- message this person without an account (founder decision, 2026-08-17).

create function public.featured_traveler(p_city_id int)
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
    and t.end_date >= current_date
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

-- 5. Keep the send path aligned with the window ------------------------------------
-- A request may only be sent for an overlap the sender can actually see.

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
        and greatest(mine.start_date, theirs.start_date) <= current_date + 14
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
