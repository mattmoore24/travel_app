-- A pin goes where the traveler goes.
--
-- The founder tried to drop a pin in Manhattan and the app said "Could not
-- save". The map had let them pan there, the geocoder had named the corner,
-- and then validate_pin measured the spot against the centre of the city
-- whose chip was lit - Bangkok, 13,924 km away - and refused it. The rule was
-- from the brief's "launch dense, not wide" (§2.6), and it was doing its job.
-- The founder's decision (docs/PROGRESS.md, 2026-09-04) retires it:
--
--   "There is no reason to ever block someone from putting down a pin ...
--    never limit travelers on where they can put their trips or pins."
--
-- So, in order:
--
--   1. A CITY IS ANY CITY. pins.city_id and heat_history.city_id point at
--      public.cities (now ~49,000 rows with clocks, 20260904110100) rather
--      than at the four launch rows. validate_pin no longer knows the word
--      "launch"; it works out WHICH city the spot is in (the browsed city if
--      the spot is within 20 km of it, else the nearest city weighted by
--      size, so Midtown is New York and not Hoboken) and writes that.
--   2. THE MAP READS BY DISTANCE. city_pins, public_city_pins, heat_cells and
--      public_heat_cells answer for every live pin within map_radius_km()
--      of the browsed city's coordinate. A plan in Monaco is on the Nice map
--      and the Monaco map both; a city_id is a label, not a fence.
--   3. FEATURED CITIES, NOT OPEN CITIES. featured_cities() is what the map's
--      rail draws: the founder's launch cities plus any city whose visible
--      plans clear its k, most plans first. request_city() is dropped; the
--      table stays as the record it was.
--   4. A TIME IS OPTIONAL, A RANGE, OR TBD. intent_time_end and time_tbd,
--      threaded through both map feeds and post_joinable_pin.
--   5. TRAVELERS WITHIN A RADIUS. profiles.travelers_radius_km (default 32,
--      about twenty miles) and cities_within_km(); get_matches, the
--      trips_select_overlap policy behind it, send_message_request,
--      incoming_requests and meet_prompt_due all agree on it, so a hello to
--      somebody Cannes-to-Nice is never "recipient unavailable".
--   6. EVERY CLOCK READS THE CITY'S ZONE through city_clock_zone(): a launch
--      city's hand-set zone first, the seeded one otherwise, UTC last.
--
-- What did NOT move. §7 rule 2: every radius here is measured from a city a
-- person CHOSE (a chip, a search, a trip they typed) - no function in this
-- file takes a device coordinate, and the pgTAP asserts get_matches' argument
-- list is empty. Rule 3: the 72-hour CHECK is untouched, and a time range
-- that runs past the expiry is refused like a single hour was. Rule 6: the
-- heatmap's k is coalesce(launch_cities.heat_k, 3) everywhere, and a city is
-- not named on the rail below its k. Rule 8: businesses still register in a
-- launch city; that is the business side's decision, not this one's.
--
-- Two RETURNS TABLE signatures change (city_pins, public_city_pins,
-- get_matches, incoming_requests), so all four are dropped first and every
-- grant is restated - AGENTS.md, and the traps skill's account of the deploy
-- that died half-applied. post_joinable_pin gains two parameters, which is a
-- new overload, so the old one is dropped too.

-- =============================================================================
-- 1. EVERY CITY KNOWS ITS CLOCK, AND WHERE ITS NEIGHBOURS ARE
-- =============================================================================

alter table public.cities
  add constraint cities_timezone_is_a_zone
  check (timezone is null or public.is_valid_timezone(timezone));

-- The radius joins below prefilter on a latitude band, which this makes an
-- index range scan over ~49k rows instead of a table scan per trip.
create index if not exists cities_lat_lng_idx on public.cities (lat, lng);

-- ONE place the app asks "what time is it in this city". A launch city's
-- founder-set zone outranks the seeded one, because the founder has been
-- known to correct a zone by hand (20260831160000); a city seeded before the
-- column existed and never refreshed answers UTC rather than nothing.
create or replace function public.city_clock_zone(p_city_id int)
returns text
language sql
stable
as $$
  select coalesce(
    (select lc.timezone from public.launch_cities lc where lc.city_id = p_city_id),
    (select c.timezone from public.cities c where c.id = p_city_id),
    'UTC')
$$;
revoke execute on function public.city_clock_zone(int) from public;
grant execute on function public.city_clock_zone(int) to anon, authenticated;

comment on function public.city_clock_zone(int) is
  'The IANA zone every clock in the schema reads for a city: the launch '
  'city''s hand-set zone first, the seeded one otherwise, UTC last.';

-- The cities within p_km of a city, the city itself included, and ONLY the
-- city itself when p_km is 0 ("this city only"). Plain SQL with no SET
-- clause so the planner can inline it into the joins that call it, and a
-- bounding box before the haversine so cities_lat_lng_idx does the work.
create or replace function public.cities_within_km(p_city_id int, p_km numeric)
returns setof public.cities
language sql
stable
as $$
  select c.*
  from public.cities centre
  join public.cities c
    on c.id = centre.id
    or (
      p_km > 0
      and c.lat between centre.lat - p_km / 111.0 and centre.lat + p_km / 111.0
      and c.lng between centre.lng - p_km / (111.0 * greatest(cos(radians(centre.lat)), 0.1))
                    and centre.lng + p_km / (111.0 * greatest(cos(radians(centre.lat)), 0.1))
      and public.haversine_km(centre.lat, centre.lng, c.lat, c.lng) <= p_km
    )
  where centre.id = p_city_id
$$;
revoke execute on function public.cities_within_km(int, numeric) from public, anon;
grant execute on function public.cities_within_km(int, numeric) to authenticated;

-- WHICH CITY A SPOT IS IN. Nearest by distance alone puts Midtown Manhattan
-- in Hoboken (its centre is 3 km away; New York's is 5 km); population alone
-- puts every suburb of Paris in Paris. Distance over the fourth root of
-- population is the smallest weighting that answers New York for Midtown,
-- Monaco for Monaco (Nice is 13 km off and ten times the size) and Jersey
-- City for Jersey City. Half a degree of latitude either way is 55 km, which
-- is as far as a spot can be from any seeded city and still be "in" it; at
-- sea, or in the middle of nowhere, this answers null and the caller keeps
-- the city the traveler was browsing.
create or replace function public.nearest_city(p_lat double precision, p_lng double precision)
returns int
language sql
stable
as $$
  select c.id
  from public.cities c
  where c.lat between p_lat - 0.5 and p_lat + 0.5
    and c.lng between p_lng - 0.5 / greatest(cos(radians(p_lat)), 0.1)
                  and p_lng + 0.5 / greatest(cos(radians(p_lat)), 0.1)
  order by public.haversine_km(p_lat, p_lng, c.lat, c.lng)
             / power(greatest(c.population, 1000), 0.25),
           c.population desc,
           c.id
  limit 1
$$;
revoke execute on function public.nearest_city(double precision, double precision)
  from public, anon;
grant execute on function public.nearest_city(double precision, double precision)
  to authenticated;

-- How far from a browsed city's centre the map draws plans. One number,
-- named, because three feeds read it and a chip's count must not disagree
-- with the markers under it. Fifty kilometres is Nice to Cannes and back,
-- Lisbon to Sintra and Cascais, and all five boroughs from Manhattan.
create or replace function public.map_radius_km()
returns numeric
language sql
immutable
as $$ select 50::numeric $$;
revoke execute on function public.map_radius_km() from public;
grant execute on function public.map_radius_km() to anon, authenticated;

-- =============================================================================
-- 2. A PIN BELONGS TO A CITY, ANY CITY - AND MAY NAME A RANGE OR SAY TBD
-- =============================================================================

alter table public.pins drop constraint pins_city_id_fkey;
alter table public.pins
  add constraint pins_city_id_fkey foreign key (city_id) references public.cities (id);

alter table public.heat_history drop constraint heat_history_city_id_fkey;
alter table public.heat_history
  add constraint heat_history_city_id_fkey foreign key (city_id) references public.cities (id);

alter table public.pins
  add column intent_time_end time,
  add column time_tbd boolean not null default false;

-- A range has a start; TBD names no hour at all. Three honest shapes and no
-- fourth: "sometime that day" (both null, not TBD), "at 19:00", "19:00 to
-- 22:00", and "time TBD" - the founder's explicit ask, distinct from silence
-- because it tells the reader to ask rather than to assume.
alter table public.pins
  add constraint pins_range_needs_a_start
    check (intent_time_end is null or intent_time is not null),
  add constraint pins_tbd_names_no_hour
    check (not time_tbd or (intent_time is null and intent_time_end is null));

comment on column public.pins.intent_time_end is
  'The end of the plan''s window in the city''s own time, when the author '
  'gave one; an end at or before the start means past midnight. Null with a '
  'start means "at" rather than "between". Future intent like the hour '
  'beside it, never a statement about where anybody is (§7 rule 2).';
comment on column public.pins.time_tbd is
  'The author said the time is to be decided. Distinct from naming no hour: '
  'this is an answer ("ask me"), that is silence ("sometime that day").';

-- The trigger, restated in full: the city gate comes out, the city is
-- RESOLVED rather than trusted, the clock comes from city_clock_zone(), and
-- a range is checked like an hour was. Everything else is verbatim from
-- 20260902190000.
create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hint record;
  v_zone text;
  v_intent_at timestamptz;
  v_end_at timestamptz;
begin
  -- WHICH CITY. The client sends the city it was browsing, which is right
  -- whenever the spot is in that city's orbit (20 km: Nice to Monaco,
  -- Manhattan to Brooklyn) and wrong the moment somebody pans a continent
  -- - the case that used to be refused. Then the spot decides for itself,
  -- and only when the spot is nowhere near any seeded city (open sea, the
  -- outback) does the browsed city stand. Never a refusal: a pin is a
  -- plan, and a plan in the middle of nowhere is still a plan.
  select c.id, c.lat, c.lng into v_hint
  from public.cities c
  where c.id = new.city_id;
  if v_hint.id is null
     or public.haversine_km(new.lat, new.lng, v_hint.lat, v_hint.lng) > 20 then
    new.city_id := coalesce(public.nearest_city(new.lat, new.lng), new.city_id);
  end if;

  if new.expires_at <= now() then
    raise exception 'pin would already be expired' using errcode = 'check_violation';
  end if;
  -- +2 absorbs client-local vs UTC date drift in both directions.
  if new.intent_date < current_date - 1
     or new.intent_date > (new.expires_at at time zone 'UTC')::date + 2 then
    raise exception 'intent date must fall within the pin''s lifetime'
      using errcode = 'check_violation';
  end if;
  -- Timestamp granularity. The date window above is deliberately generous;
  -- an hour needs no generosity because the city's zone makes the
  -- comparison exact - and every city has a zone now.
  if new.intent_time is not null then
    v_zone := public.city_clock_zone(new.city_id);
    v_intent_at := (new.intent_date + new.intent_time) at time zone v_zone;
    if v_intent_at > new.expires_at then
      raise exception 'this plan''s time falls after the pin disappears'
        using errcode = 'check_violation', hint = 'intent_time_past_expiry';
    end if;
    if new.intent_time_end is not null then
      v_end_at := (new.intent_date + new.intent_time_end) at time zone v_zone;
      -- "10 PM to 2 AM" ends tomorrow. An end at or before the start is the
      -- only way to say so with two times, so it is read that way.
      if new.intent_time_end <= new.intent_time then
        v_end_at := v_end_at + interval '1 day';
      end if;
      if v_end_at > new.expires_at then
        raise exception 'this plan''s end falls after the pin disappears'
          using errcode = 'check_violation', hint = 'intent_time_past_expiry';
      end if;
    end if;
  end if;
  -- A pin may only name a business NEAR it. It used to be "in its city",
  -- which was a straight compare while both sides could only be one of
  -- four; with a resolved city a bar on the Jersey side of a Manhattan pin
  -- would fail an id compare and pass any honest one. Thirty kilometres is
  -- the same "this metro area" the map draws.
  if new.business_id is not null
     and not exists (
       select 1 from public.businesses b
       where b.id = new.business_id
         and public.haversine_km(new.lat, new.lng, b.lat, b.lng) <= 30
     ) then
    raise exception 'that business is not in this city' using errcode = 'check_violation';
  end if;
  -- THE LINK, MADE HERE RATHER THAN BY THE CLIENT. Exact name, sixty
  -- metres: when the spot came from place search, MapKit handed over the
  -- venue's real name, and a listed business of that name at that corner is
  -- that business. Anything vaguer would deep-link the wrong page, which is
  -- worse than no link. The city compare is gone from this one too, for
  -- the reason above.
  if new.business_id is null then
    select b.id into new.business_id
    from public.businesses b
    where b.active
      and b.state = 'listed'
      and lower(btrim(b.name)) = lower(btrim(new.venue_name))
      and public.haversine_km(new.lat, new.lng, b.lat, b.lng) <= 0.06
    order by public.haversine_km(new.lat, new.lng, b.lat, b.lng)
    limit 1;
  end if;
  if not new.seeded then
    perform pg_advisory_xact_lock(hashtext('pin_limit:' || new.user_id::text));
    if (select count(*) from public.pins
        where user_id = new.user_id and expires_at > now()) >= 10 then
      raise exception 'active pin limit reached (10)'
        using errcode = 'check_violation', hint = 'pin_cap';
    end if;
  end if;
  return new;
end
$$;

-- The member policy no longer asks whether the pin's city is open. What it
-- still asks is everything that was ever about a PERSON: live, somebody
-- else's, discoverable, not blocked.
drop policy pins_select_visible on public.pins;
create policy pins_select_visible
  on public.pins for select to authenticated
  using (
    expires_at > now()
    and (
      seeded
      or (
        user_id <> auth.uid()
        and public.is_discoverable_owner(user_id)
        and not public.is_blocked_pair(user_id)
      )
    )
  );

-- =============================================================================
-- 3. THE MAP READS BY DISTANCE
-- =============================================================================
--
-- Both feeds gain intent_time_end and time_tbd, so both are dropped first.
-- The WHERE changes from `p.city_id = p_city_id` to a haversine against the
-- browsed city's coordinate: the pin's own city_id is a label for the funnel
-- and the rail, and the map is a circle around wherever the person is
-- looking.

drop function public.city_pins(int);
create function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  note text,
  plan text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  intent_time time,
  intent_time_end time,
  time_tbd boolean,
  business_id uuid,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
as $$
  select
    p.id,
    p.user_id,
    pr.display_name,
    pr.age,
    pr.verified,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = p.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    p.venue_name,
    p.note,
    p.plan,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.intent_time,
    p.intent_time_end,
    p.time_tbd,
    p.business_id,
    p.seeded,
    p.seed_note,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p -- caller's RLS applies here: expiry and who may see whom
  join public.cities c on c.id = p_city_id
  left join public.profiles pr on pr.user_id = p.user_id
  where public.haversine_km(p.lat, p.lng, c.lat, c.lng) <= public.map_radius_km()
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.intent_time nulls last, p.created_at
$$;
revoke execute on function public.city_pins(int) from public, anon;
grant execute on function public.city_pins(int) to authenticated;

comment on function public.city_pins(int) is
  'Every live plan within map_radius_km() of the named city, as this member '
  'may see it. The pin''s own city_id is a label; the map is a circle.';

drop function public.public_city_pins(int);
create function public.public_city_pins(p_city_id int)
returns table (
  id uuid,
  venue_name text,
  note text,
  plan text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  intent_time time,
  intent_time_end time,
  time_tbd boolean,
  business_id uuid,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.note,
    p.plan,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.intent_time,
    p.intent_time_end,
    p.time_tbd,
    -- Never to a business. This is the door a business account reads the map
    -- through (features/guest/hooks useMapPins), and handing it the join
    -- between plans and its own listing is the owner-facing aggregate the
    -- package deliberately left out. A guest gets the link; a business gets
    -- the same pins with no listing attached.
    case when public.viewer_is_business() then null else p.business_id end,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  join public.cities c on c.id = p_city_id
  where public.haversine_km(p.lat, p.lng, c.lat, c.lng) <= public.map_radius_km()
    and p.expires_at > now()
    and (
      p.seeded
      or (
        public.is_discoverable_owner(p.user_id)
        and public.discovery_pair_ok(auth.uid(), p.user_id)
      )
    )
  order by p.intent_date, p.intent_time nulls last, p.created_at
$$;
revoke execute on function public.public_city_pins(int) from public;
grant execute on function public.public_city_pins(int) to anon, authenticated;

comment on function public.public_city_pins(int) is
  'Pins with no person attached, for guests, within map_radius_km() of the '
  'named city. Honours the owner''s audience: somebody who narrowed to '
  'verified is not on a signed-out visitor''s map either. Says whether a pin '
  'is open to join, how many are in, the optional hour or range or TBD, and '
  'the business the plan is at - that last one for everyone except a '
  'business account.';

-- =============================================================================
-- 4. HEAT READS THE SAME CIRCLE, AND EVERY CITY HAS A K
-- =============================================================================
--
-- k is coalesce(launch_cities.heat_k, 3): the founder can still raise a
-- city's floor by hand, and a city nobody has touched gets the global floor
-- the heat_history CHECK already asserts (poster_count >= 3). Never lower.

create or replace function public.heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
as $$
declare
  v_k int;
  v_centre record;
begin
  select c.lat, c.lng into v_centre from public.cities c where c.id = p_city_id;
  if v_centre.lat is null then
    return; -- unknown city: no heat
  end if;
  v_k := coalesce(
    (select lc.heat_k from public.launch_cities lc where lc.city_id = p_city_id and lc.active),
    3);

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    (count(distinct p.user_id) filter (where p.user_id is not null))::int
  from public.pins p -- caller's RLS applies here
  where public.haversine_km(p.lat, p.lng, v_centre.lat, v_centre.lng) <= public.map_radius_km()
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;
revoke execute on function public.heat_cells(int, date) from public, anon;
grant execute on function public.heat_cells(int, date) to authenticated;

create or replace function public.public_heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_k int;
  v_centre record;
begin
  select c.lat, c.lng into v_centre from public.cities c where c.id = p_city_id;
  if v_centre.lat is null then
    return;
  end if;
  v_k := coalesce(
    (select lc.heat_k from public.launch_cities lc where lc.city_id = p_city_id and lc.active),
    3);

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    (count(distinct p.user_id) filter (where p.user_id is not null))::int
  from public.pins p
  where public.haversine_km(p.lat, p.lng, v_centre.lat, v_centre.lng) <= public.map_radius_km()
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
    -- A definer runs no policies, so the visibility rules the authenticated
    -- function gets from RLS have to be restated here by hand.
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;
revoke execute on function public.public_heat_cells(int, date) from public;
grant execute on function public.public_heat_cells(int, date) to anon, authenticated;

-- History is keyed by the pin's own city label, which is what the sweep
-- wrote; the reader keeps that key and only changes where k and the clock
-- come from.
create or replace function public.heat_history_cells(p_city_id int)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_k int;
  v_now timestamp;
begin
  if not exists (select 1 from public.cities c where c.id = p_city_id) then
    return; -- unknown city: no history
  end if;
  v_k := coalesce(
    (select lc.heat_k from public.launch_cities lc where lc.city_id = p_city_id and lc.active),
    3);
  v_now := now() at time zone public.city_clock_zone(p_city_id);

  return query
  select
    h.cell_lat,
    h.cell_lng,
    round(avg(h.poster_count))::int
  from public.heat_history h
  where h.city_id = p_city_id
    and h.weekday = extract(dow from v_now)::smallint
    and h.hour_band in (public.heat_hour_band(v_now::time), 'unsaid')
    and h.observed_on >= (v_now::date - 90)
  group by h.cell_lat, h.cell_lng
  -- Both floors, both the city's current k. The first is the live threshold
  -- inherited; the second is the historical one, and it is the reason a cell
  -- that was busy once cannot become "usually busy".
  having min(h.poster_count) >= v_k
     and count(distinct h.observed_on) >= v_k;
end
$$;
revoke execute on function public.heat_history_cells(int) from public;
grant execute on function public.heat_history_cells(int) to anon, authenticated;

-- The sweep used to inner-join launch_cities for k, which meant a pin in
-- any other city was deleted and never remembered. Left join, same floor.
create or replace function public.expire_pins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.heat_history
    (city_id, cell_lat, cell_lng, weekday, hour_band, observed_on, poster_count)
  select
    p.city_id,
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    extract(dow from p.intent_date)::smallint,
    public.heat_hour_band(p.intent_time),
    p.intent_date,
    count(distinct p.user_id)::int
  from public.pins p
  left join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.expires_at <= now()
  group by
    p.city_id, 2, 3,
    extract(dow from p.intent_date),
    public.heat_hour_band(p.intent_time),
    p.intent_date,
    coalesce(lc.heat_k, 3)
  -- count(distinct) ignores nulls, so a curated pin contributes nothing and
  -- three of them can never make a bucket. Same rule as heat_cells.
  having count(distinct p.user_id) >= coalesce(lc.heat_k, 3)
  on conflict (city_id, cell_lat, cell_lng, weekday, hour_band, observed_on)
  do update set poster_count = greatest(
    heat_history.poster_count, excluded.poster_count
  );

  delete from public.pins where expires_at <= now();
  get diagnostics v_count = row_count;

  delete from public.heat_history where observed_on < current_date - 90;

  return v_count;
end
$$;
revoke execute on function public.expire_pins() from public, anon, authenticated;

-- =============================================================================
-- 5. FEATURED CITIES, NOT OPEN CITIES
-- =============================================================================
--
-- The rail used to be "the cities we have opened", counted. It is now "where
-- the plans are": every active launch city (the founder's picks, with their
-- curated pins) plus any city whose visible live plans clear its k, most
-- plans first. A city below its k is NOT named: a chip saying "Podunk" with
-- no number would still tell the world somebody has a plan in Podunk, which
-- is the enumeration the k floor exists to refuse. Eight at most, because
-- the rail is a row of chips and not a directory.
--
-- Two doors, as before: the member door is SECURITY INVOKER so RLS decides
-- what it may count, and the guest door restates the visibility by hand.

drop function public.city_pin_counts();
drop function public.public_city_pin_counts();

create function public.featured_cities()
returns table (
  city_id int,
  name text,
  country_code text,
  country_name text,
  admin text,
  lat double precision,
  lng double precision,
  population int,
  timezone text,
  pin_count int,
  featured boolean
)
language sql
stable
as $$
  with counted as (
    select p.city_id, count(*)::int as n
    from public.pins p -- caller's RLS applies here, exactly as in city_pins
    where p.expires_at > now()
      and not public.viewer_is_business()
      and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
    group by p.city_id
  ),
  picked as (
    select lc.city_id, true as featured
    from public.launch_cities lc
    where lc.active
    union
    select counted.city_id, false
    from counted
    left join public.launch_cities lc on lc.city_id = counted.city_id and lc.active
    where counted.n >= coalesce(lc.heat_k, 3)
  )
  select
    c.id,
    c.name,
    c.country_code,
    c.country_name,
    c.admin,
    c.lat,
    c.lng,
    c.population,
    public.city_clock_zone(c.id),
    -- NULL, never a small number, exactly as the old chip count was.
    (case when coalesce(counted.n, 0) >= coalesce(lc.heat_k, 3) then counted.n else null end)::int,
    bool_or(picked.featured)
  from picked
  join public.cities c on c.id = picked.city_id
  left join counted on counted.city_id = c.id
  left join public.launch_cities lc on lc.city_id = c.id and lc.active
  group by c.id, counted.n, lc.heat_k
  -- Ties break on id, which is the order the old rail had (fetchLaunchCities
  -- ordered by city_id), so a quiet day still opens the map where it did.
  order by coalesce(counted.n, 0) desc, bool_or(picked.featured) desc, c.id
  limit 8
$$;
revoke execute on function public.featured_cities() from public, anon;
grant execute on function public.featured_cities() to authenticated;

comment on function public.featured_cities() is
  'The map''s rail: every active launch city plus any city whose plans THIS '
  'caller can see clear its k, most plans first, eight at most. Counted '
  'under the same visibility rules city_pins applies, so a chip can never '
  'advertise a pin the map will not draw, and a city is never named below '
  'its k.';

create function public.public_featured_cities()
returns table (
  city_id int,
  name text,
  country_code text,
  country_name text,
  admin text,
  lat double precision,
  lng double precision,
  population int,
  timezone text,
  pin_count int,
  featured boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with counted as (
    select p.city_id, count(*)::int as n
    from public.pins p
    where p.expires_at > now()
      and (
        p.seeded
        or (
          public.is_discoverable_owner(p.user_id)
          and public.discovery_pair_ok(auth.uid(), p.user_id)
        )
      )
    group by p.city_id
  ),
  picked as (
    select lc.city_id, true as featured
    from public.launch_cities lc
    where lc.active
    union
    select counted.city_id, false
    from counted
    left join public.launch_cities lc on lc.city_id = counted.city_id and lc.active
    where counted.n >= coalesce(lc.heat_k, 3)
  )
  select
    c.id,
    c.name,
    c.country_code,
    c.country_name,
    c.admin,
    c.lat,
    c.lng,
    c.population,
    public.city_clock_zone(c.id),
    (case when coalesce(counted.n, 0) >= coalesce(lc.heat_k, 3) then counted.n else null end)::int,
    bool_or(picked.featured)
  from picked
  join public.cities c on c.id = picked.city_id
  left join counted on counted.city_id = c.id
  left join public.launch_cities lc on lc.city_id = c.id and lc.active
  group by c.id, counted.n, lc.heat_k
  -- Ties break on id, which is the order the old rail had (fetchLaunchCities
  -- ordered by city_id), so a quiet day still opens the map where it did.
  order by coalesce(counted.n, 0) desc, bool_or(picked.featured) desc, c.id
  limit 8
$$;
revoke execute on function public.public_featured_cities() from public;
grant execute on function public.public_featured_cities() to anon, authenticated;

comment on function public.public_featured_cities() is
  'featured_cities() for guests and businesses: the same rail, counted under '
  'the identity-free feed''s own visibility rules.';

-- Nobody has to ask for a city any more. The function goes; the table stays
-- as the record of who asked while it was needed, readable by the founder
-- alone as before.
drop function public.request_city(text);
comment on table public.city_requests is
  'Retired 2026-09-04: cities no longer open one at a time, so nothing '
  'writes here. Kept as the record of what travelers asked for while it '
  'mattered. Founder-readable only.';

-- =============================================================================
-- 6. ONE WRITE PATH, WITH ROOM FOR A RANGE AND A TBD, THAT SAYS WHERE IT WENT
-- =============================================================================
--
-- Two defaulted parameters are a new overload, so the old signature is
-- dropped rather than left to make every PostgREST call ambiguous. The
-- answer gains the CITY the pin resolved to: the map that posted a pin from
-- across a continent has to follow it there, and it cannot know where "there"
-- is without being told.

drop function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid
);

create function public.post_joinable_pin(
  p_city_id int,
  p_venue_name text,
  p_note text,
  p_place_label text,
  p_category public.pin_category,
  p_lat double precision,
  p_lng double precision,
  p_intent_date date,
  p_expires_at timestamptz,
  p_plan text default null,
  p_intent_time time default null,
  p_joinable boolean default true,
  p_business_id uuid default null,
  p_intent_time_end time default null,
  p_time_tbd boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pin uuid;
  v_city int;
  v_chat uuid;
  v_recent int;
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('post a plan');

  -- A business named on purpose has to be one a traveler can open. The
  -- distance check stays in validate_pin, which every write path shares.
  if p_business_id is not null and not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.active and b.state = 'listed'
  ) then
    raise exception 'That business is not on the map any more.'
      using errcode = 'check_violation';
  end if;

  -- The cap is on GROUPS, so it only applies when one is about to be opened.
  -- A message-me-first pin opens no room and answers to the ten-live-pins
  -- limit in validate_pin instead.
  if p_joinable then
    perform pg_advisory_xact_lock(hashtext('joinable_pin:' || v_user::text));
    select count(*) into v_recent
      from public.groups
     where created_by = v_user
       and pin_id is not null
       and created_at > now() - interval '24 hours';
    if v_recent >= 5 then
      raise exception 'You have opened a few plans to join today already. Post this one as message-me-first, or try again tomorrow.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.pins (
    user_id, city_id, venue_name, note, place_label, plan,
    category, lat, lng, intent_date, intent_time, intent_time_end, time_tbd,
    expires_at, seeded, business_id
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    nullif(btrim(coalesce(p_plan, '')), ''),
    p_category, p_lat, p_lng, p_intent_date, p_intent_time, p_intent_time_end,
    coalesce(p_time_tbd, false),
    p_expires_at, false, p_business_id
  )
  returning id, city_id into v_pin, v_city;

  if not p_joinable then
    return jsonb_build_object(
      'pin_id', v_pin, 'chat_id', null, 'city', public.city_json(v_city));
  end if;

  -- The group is called what the plan is called - the plan text first, the
  -- venue as fallback. groups.name allows 2 to 60 characters and both
  -- sources allow 1 to 80, so both ends need saying: a long name is cut,
  -- and a one-character one - which would fail the CHECK and roll the pin
  -- back with it - gets a name instead.
  v_name := left(btrim(coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p_venue_name)), 60);
  if char_length(v_name) < 2 then
    v_name := 'Meet up';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  -- No end date, deliberately. The pin's 72 hours are the pin's; the
  -- conversation that came out of it is not on a timer.
  insert into public.groups (chat_id, created_by, name, speaking, max_stay_until, pin_id)
  values (v_chat, v_user, v_name, 'everyone', null, v_pin);

  -- 'infinity' rather than a date, for the same reason create_group does it:
  -- room_members.expires_at is NOT NULL and `null::date + 7` is null, which
  -- would fail at 23502 and take the whole pin down with it.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, null, 'infinity', 'admin');

  return jsonb_build_object(
    'pin_id', v_pin, 'chat_id', v_chat, 'city', public.city_json(v_city));
end
$$;
revoke execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid, time, boolean
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid, time, boolean
) to authenticated;

comment on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid, time, boolean
) is
  'Posts a plan, in either of the two shapes the form offers. p_joinable '
  'opens the group chat that makes it joinable; false posts the same pin '
  'with nobody able to walk in. Both shapes come through here because pins '
  'are immutable, so the optional hour, its optional end, and TBD have to '
  'arrive with the insert - and so does the business the plan names, when '
  'it was opened from that business''s page. p_city_id is the city the map '
  'was browsing; validate_pin resolves the pin''s real city from the spot, '
  'and the answer''s `city` says which one it chose.';

-- The city a pin resolved to, as the client's CityRow plus its clock, so
-- the map can adopt it in one move. Defined here, after its first caller
-- above: plpgsql binds names at run time, and the write path is the only
-- reader.
create or replace function public.city_json(p_city_id int)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'country_code', c.country_code,
    'country_name', c.country_name,
    'admin', c.admin,
    'lat', c.lat,
    'lng', c.lng,
    'population', c.population,
    'timezone', public.city_clock_zone(c.id))
  from public.cities c
  where c.id = p_city_id
$$;
revoke execute on function public.city_json(int) from public, anon;
grant execute on function public.city_json(int) to authenticated;

-- =============================================================================
-- 7. TRAVELERS WITHIN A RADIUS
-- =============================================================================
--
-- "Allow users to see other travelers within a ~20 mile radius of the city
-- that they selected, similar to how Hinge does it ... users should be able
-- to decide what radius." A traveler staying in Nice reaches Monaco (13 km),
-- Antibes (17 km) and Cannes (26 km) at the default; "this city only" is 0.
--
-- The radius is the VIEWER's, measured from the VIEWER's own trip city, and
-- it is the one number every surface below reads: the policy that lets a
-- trip row be read at all, the queue built on it, the hello sent from the
-- queue, the chip on the hello's card, and the meet question after the
-- trip. One of them disagreeing is how "recipient unavailable" happens to a
-- person the queue just showed you.

alter table public.profiles
  add column travelers_radius_km int not null default 32
    check (travelers_radius_km between 0 and 500);

grant select (travelers_radius_km) on public.profiles to authenticated;
grant update (travelers_radius_km) on public.profiles to authenticated;

comment on column public.profiles.travelers_radius_km is
  'How far from each of this traveler''s trip cities the Travelers tab '
  'reaches, in kilometres; 0 is that city only. Default 32, about twenty '
  'miles. Measured from cities.lat/lng of a trip the person TYPED, never '
  'from a device (§7 rule 2).';

-- The policy predicate. SECURITY DEFINER, as before, so it can read the
-- caller's own trips and radius under RLS that would otherwise recurse.
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
      -- Same season-long horizon as get_matches and send_message_request,
      -- so all three agree about who is reachable.
      and greatest(mine.start_date, p_start) <= current_date + 180
  )
$$;
revoke execute on function public.overlaps_own_trip(int, date, date) from public, anon;

-- get_matches gains three OUT columns (how far, and which of MY cities this
-- overlap is measured from), so it is dropped first. The body is
-- 20260823030000's with the city join widened; the ORDER stays overlap
-- first, because the tab is a queue of people and not a map.
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
      and greatest(mine.start_date, theirs.start_date) <= current_date + 180
      -- Who can see you, both ways.
      and public.discovery_pair_ok(auth.uid(), theirs.user_id)
    -- Nearest of my trips first when two of them reach the same person.
    order by theirs.id, greatest(mine.start_date, theirs.start_date),
             public.haversine_km(mc.lat, mc.lng, c.lat, c.lng)
  ) m
  order by m.overlap_start, m.their_start, m.trip_id
$$;
revoke execute on function public.get_matches() from public, anon;

comment on function public.get_matches() is
  'The Travelers queue: everybody with an active trip within the caller''s '
  'travelers_radius_km of one of the caller''s own trip cities, on '
  'overlapping dates. SECURITY INVOKER - the trips_select_overlap policy '
  'decides which rows exist at all. Takes no coordinate: every distance is '
  'city centre to city centre.';

-- The hello. The trip branch reaches as far as the queue does; the pin
-- branch no longer asks whether the pin's city is open. Body otherwise
-- verbatim from 20260902150000, except that the four raise literals that
-- said "request" now say "hello" - the client reads the HINT on every one
-- of them, the word is banned from copy, and the restated body would have
-- put the old sentences past the copy lint's historical allowlist.
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
    raise exception 'daily hello limit reached'
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
      and greatest(mine.start_date, theirs.start_date) <= current_date + 180
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
    raise exception 'unknown hello source';
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
    raise exception 'hello already sent to this traveler'
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

-- The inbox card's chip. It gains the RECIPIENT's own city for the window,
-- because "Both in Cannes" is a lie when you are in Nice; the client says
-- "In Cannes while you're in Nice" instead. New OUT column, so dropped
-- first. Body otherwise verbatim from 20260902210000.
drop function public.incoming_requests();
create function public.incoming_requests()
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  age int,
  verified boolean,
  profile_element text,
  first_message text,
  photo_path text,
  created_at timestamptz,
  overlap_city text,
  overlap_start date,
  overlap_end date,
  overlap_my_city text
)
language sql
stable
as $$
  select
    r.id,
    r.sender_id,
    p.display_name,
    p.age,
    p.verified,
    r.profile_element,
    r.first_message,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = r.sender_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.created_at,
    o.city_label,
    o.starts_on,
    o.ends_on,
    o.my_city_label
  from public.message_requests r
  join public.profiles p on p.user_id = r.sender_id
  -- The earliest window the two of you actually share, within the reader's
  -- own radius. `left join lateral` so a hello with no readable overlap
  -- still renders the card; the columns come back null and the chip is
  -- simply absent.
  left join lateral (
    select
      c.name as city_label,
      mc.name as my_city_label,
      greatest(mine.start_date, theirs.start_date) as starts_on,
      least(mine.end_date, theirs.end_date) as ends_on
    from public.trips mine
    join public.cities mc on mc.id = mine.city_id
    join public.profiles me on me.user_id = mine.user_id
    join public.cities_within_km(mine.city_id, me.travelers_radius_km) c on true
    join public.trips theirs
      on theirs.city_id = c.id
     and theirs.user_id = r.sender_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.status = 'active'
     and theirs.end_date >= current_date - 1
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date - 1
    order by greatest(mine.start_date, theirs.start_date),
             public.haversine_km(mc.lat, mc.lng, c.lat, c.lng)
    limit 1
  ) o on true
  where r.recipient_id = auth.uid() and r.status = 'pending'
    and r.withdrawn_at is null
  order by r.created_at desc
$$;
revoke execute on function public.incoming_requests() from public, anon;
grant execute on function public.incoming_requests() to authenticated;

-- The meet question after a shared stay reaches as far as the queue that
-- introduced the two of you. Same signature; body otherwise verbatim from
-- 20260902240000.
create or replace function public.meet_prompt_due(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants me
      on me.chat_id = c.id and me.user_id = auth.uid()
    join public.chat_participants them
      on them.chat_id = c.id and them.user_id <> auth.uid()
    where c.id = p_chat_id
      and c.kind = 'direct'
      and c.status = 'active'
      and not exists (
        select 1 from public.reports r
        where r.reporter_id = auth.uid()
          and r.reported_user_id = them.user_id
      )
      -- The caller's OWN answer, and only ever the caller's. Reading the
      -- other participant's row here - even as a `not exists` - is how this
      -- feature would become a reciprocal-interest reveal.
      and not exists (
        select 1 from public.chat_meet_answers a
        where a.chat_id = c.id and a.user_id = auth.uid()
      )
      and (
        select max(least(mine.end_date, theirs.end_date))
        from public.trips mine
        join public.profiles mp on mp.user_id = mine.user_id
        join public.cities_within_km(mine.city_id, mp.travelers_radius_km) near on true
        join public.trips theirs
          on theirs.city_id = near.id
         and theirs.user_id = them.user_id
         and theirs.start_date <= mine.end_date
         and mine.start_date <= theirs.end_date
        where mine.user_id = auth.uid()
          and mine.status = 'active'
          and theirs.status = 'active'
      ) between current_date - 30 and current_date - 1
  )
$$;
revoke execute on function public.meet_prompt_due(uuid) from public, anon;
grant execute on function public.meet_prompt_due(uuid) to authenticated;

-- =============================================================================
-- 8. THE THREE CLOCKS READ EVERY CITY'S ZONE
-- =============================================================================
--
-- Each inner-joined launch_cities for the zone (and, for the trip clock, its
-- k), so a trip to Porto or a plan in Manhattan got no push at all. Same
-- signatures; bodies verbatim from 20260902230000 (the trip clock, rough
-- windows excluded) and 20260902040000 (the two plan clocks) except for the
-- join and the zone.

create or replace function public.push_trip_starts_tomorrow(p_now timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.push_queue (user_id, title, body, data)
  select
    t.user_id,
    c.name || ' tomorrow',
    -- THE K RULE, AS A SENTENCE. The number goes out only when it is at
    -- least this city's k; below that the push is identical minus the
    -- disclosure. Never a smaller number, never "a few": either the count
    -- clears the floor or the sentence does not mention population at all.
    case
      when overlap.n >= coalesce(lc.heat_k, 3)
        then overlap.n || ' travelers are there on your dates.'
      else 'Your trip starts tomorrow. See who else has the same dates.'
    end,
    jsonb_build_object('type', 'trip', 'city_id', c.id)
  from public.trips t
  join public.cities c on c.id = t.city_id
  left join public.launch_cities lc on lc.city_id = c.id and lc.active
  left join public.notification_prefs np on np.user_id = t.user_id
  cross join lateral (
    select count(distinct th.user_id)::int as n
    from public.trips th
    where th.city_id = t.city_id
      and th.user_id <> t.user_id
      and th.status = 'active'
      -- A rough window is not a person on your dates. The count goes out
      -- under the k floor, and a population disclosed to somebody is not
      -- allowed to be padded with windows nobody committed to.
      and not th.approximate
      and th.start_date <= t.end_date
      and t.start_date <= th.end_date
      and public.is_discoverable_owner(th.user_id)
      and not public.is_business_account(th.user_id)
  ) overlap
  where t.status = 'active'
    -- The recipient's own standing. trips are not cancelled when an account
    -- is closed and push_tokens are not deleted on a ban, so without this a
    -- banned account gets "Lisbon tomorrow" and taps through to the gate that
    -- tells it the account is closed. Plain active only: a shadowbanned
    -- account keeps its illusion, and the illusion is that nothing arrives.
    and exists (
      select 1 from public.users ru where ru.id = t.user_id and ru.status = 'active'
    )
    and coalesce(np.trip_clocks, true)
    -- The date has to be a claim before a push can repeat it. "Bangkok
    -- tomorrow" on the first day of a window somebody described as "probably
    -- most of September" is the app inventing a travel date and then telling
    -- its owner about it.
    and not t.approximate
    -- The city's REAL clock, every city's now: a push aimed at the evening
    -- is allowed to be approximate; one aimed at a date boundary is not.
    and extract(hour from (p_now at time zone public.city_clock_zone(c.id))) = 18
    and t.start_date = (p_now at time zone public.city_clock_zone(c.id))::date + 1
    -- Never twice for the same trip, whatever the scheduler does.
    and not exists (
      select 1 from public.push_queue q
      where q.user_id = t.user_id
        and q.data ->> 'type' = 'trip'
        and q.data ->> 'city_id' = c.id::text
        and q.created_at > p_now - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.push_trip_starts_tomorrow(timestamptz)
  from public, anon, authenticated;

create or replace function public.push_plan_is_soon(p_now timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.push_queue (user_id, title, body, data)
  select
    rm.user_id,
    coalesce(p.venue_name, g.name),
    'Happening today. ' || going.n || case when going.n = 1
      then ' person is in.' else ' people are in.' end,
    jsonb_build_object(
      'type', 'message', 'kind', 'room', 'chat_id', g.chat_id, 'clock', 'plan_soon')
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.cities c on c.id = p.city_id
  join public.room_members rm on rm.chat_id = g.chat_id
  left join public.chat_prefs pref on pref.chat_id = g.chat_id and pref.user_id = rm.user_id
  left join public.notification_prefs np on np.user_id = rm.user_id
  cross join lateral (
    select count(*)::int as n
    from public.room_members rm2
    where rm2.chat_id = g.chat_id
      and rm2.archived_at is null
      and rm2.expires_at > p_now
  ) going
  where p.expires_at > p_now
    and p.intent_date = (p_now at time zone public.city_clock_zone(c.id))::date
    -- Three hours before an 18:00 evening, on the city's own clock.
    and extract(hour from (p_now at time zone public.city_clock_zone(c.id))) = 15
    -- Never for a plan nobody joined: a notification whose content is that
    -- you are on your own is not one this app sends.
    and going.n >= 2
    and rm.archived_at is null
    and rm.expires_at > p_now
    and not rm.muted
    and exists (
      select 1 from public.users ru where ru.id = rm.user_id and ru.status = 'active'
    )
    and coalesce(pref.muted, false) = false
    and coalesce(np.trip_clocks, true)
    and not exists (
      select 1 from public.push_queue q
      where q.user_id = rm.user_id
        and q.data ->> 'clock' = 'plan_soon'
        and q.data ->> 'chat_id' = g.chat_id::text
        and q.created_at > p_now - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.push_plan_is_soon(timestamptz)
  from public, anon, authenticated;

create or replace function public.push_last_call(p_now timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.push_queue (user_id, title, body, data)
  select
    rm.user_id,
    coalesce(p.venue_name, g.name),
    'Closing at ' || to_char(p.expires_at at time zone public.city_clock_zone(c.id), 'HH24:MI')
      || '. ' || going.n || case when going.n = 1
      then ' person is in.' else ' people are in.' end,
    jsonb_build_object(
      'type', 'message', 'kind', 'room', 'chat_id', g.chat_id, 'clock', 'last_call')
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.cities c on c.id = p.city_id
  join public.room_members rm on rm.chat_id = g.chat_id
  left join public.chat_prefs pref on pref.chat_id = g.chat_id and pref.user_id = rm.user_id
  left join public.notification_prefs np on np.user_id = rm.user_id
  cross join lateral (
    select count(*)::int as n
    from public.room_members rm2
    where rm2.chat_id = g.chat_id
      and rm2.archived_at is null
      and rm2.expires_at > p_now
  ) going
  where p.expires_at > p_now + interval '3 hours'
    and p.expires_at <= p_now + interval '4 hours'
    and going.n >= 2
    and rm.archived_at is null
    and rm.expires_at > p_now
    and not rm.muted
    and exists (
      select 1 from public.users ru where ru.id = rm.user_id and ru.status = 'active'
    )
    and coalesce(pref.muted, false) = false
    and coalesce(np.trip_clocks, true)
    and not exists (
      select 1 from public.push_queue q
      where q.user_id = rm.user_id
        and q.data ->> 'clock' = 'last_call'
        and q.data ->> 'chat_id' = g.chat_id::text
        and q.created_at > p_now - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.push_last_call(timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
