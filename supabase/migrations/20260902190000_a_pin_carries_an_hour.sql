-- A pin carries an hour — and three more things the map could not say
-- =============================================================================
--
-- One migration slot, four packages' database halves. They are here together
-- because the batch was given ONE migration file, not because they belong in
-- one commit; the file is named for the largest of them. In order:
--
--   1. map-pin-carries-an-hour ....... pins.intent_time, and the trigger moves
--                                      to timestamp granularity so an hour on
--                                      the last valid day cannot outlive the
--                                      pin (§7 rule 3).
--   2. map-pins-link-to-a-business ... pins.business_id, and the link is made
--                                      server-side by name and proximity.
--   3. city-rail-says-whats-on ....... city_pin_counts(), its guest twin, and
--                                      city_requests + request_city().
--   4. map-heat-remembers-usually-busy heat_history (no user reference at
--                                      all), written by the expiry sweep, read
--                                      back through a k-thresholded function.
--
-- Two OUT-column changes ride in here (city_pins, public_city_pins), so both
-- are dropped first and every grant is restated — AGENTS.md, and the traps
-- skill's account of the deploy that died half-applied.

-- =============================================================================
-- 1. A PIN CARRIES AN HOUR
-- =============================================================================
--
-- intent_date is a date and the actual hour survived only as prose in the
-- details field, so at nine at night a Today filter served this morning's
-- beach plan beside tonight's bar. Nullable, and it stays nullable: "sometime
-- that day" is a real answer and a pin without an hour is a first-class pin.

alter table public.pins
  add column intent_time time;

comment on column public.pins.intent_time is
  'The wall-clock hour of the plan, in the city''s own time, when the author '
  'set one. Null means "sometime that day" and is a first-class answer. It '
  'is FUTURE INTENT like the date beside it and never a statement about '
  'where anybody is (§7 rule 2): "here at 8" is a plan, "here now" is a '
  'presence claim and the app does not make one.';

-- =============================================================================
-- 2. A PIN CAN NAME A BUSINESS
-- =============================================================================
--
-- The hero mechanic is "I want to go to X on Y" and X was free text with no
-- relationship to the listing sitting at the same coordinates, so the intent
-- layer and the premises layer never met.

alter table public.pins
  add column business_id uuid references public.businesses (id) on delete set null;

create index pins_business_idx on public.pins (business_id) where business_id is not null;

comment on column public.pins.business_id is
  'The listed business this plan is at, when the two are the same place. '
  'ON DELETE SET NULL: a business that leaves takes its page, not the plans '
  'people made. Traveler-facing only — the owner-facing "four travelers plan '
  'to come" is a §10 analytics question with its own threshold argument and '
  'is deliberately not in this migration.';

-- INSERT on pins is granted per COLUMN (20260828150000: created_at belongs to
-- the server), so both new columns have to join the list or the app's insert
-- dies with permission denied while the read half looks fine. SELECT stays a
-- table-level grant, so `select *` keeps working (test 31 pins that).
grant insert (intent_time, business_id) on public.pins to authenticated;

-- =============================================================================
-- 3. validate_pin GROWS AN HOUR AND A BUSINESS
-- =============================================================================
--
-- Restated from the LIVE definition (20260831140000, which is the one that
-- carries the pin_cap hint) with three additions. An older copy would have
-- silently reverted that hint; this file's own instructions say so and the
-- last session paid for it once already.
--
-- THE HOUR IS THE §7 RULE 3 EDGE. The row CHECK `expires_at <= created_at +
-- 72 hours` is untouched and airtight, so an hour can never lengthen a pin's
-- life. What it CAN do is make the app advertise "here at 22:00" on a pin
-- that goes dark at 20:00 — a plan stated past its own ceiling. The date
-- check above absorbs client-vs-UTC drift with a +2 day window because a bare
-- date has nowhere else to go; an hour does, because launch_cities knows the
-- city's IANA zone (20260831160000). So the intent MOMENT is resolved in the
-- city's own clock and compared to expires_at exactly, with no slack at all.

create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city record;
  v_intent_at timestamptz;
begin
  select lc.active, lc.radius_km, lc.timezone, c.lat, c.lng
    into v_city
  from public.launch_cities lc
  join public.cities c on c.id = lc.city_id
  where lc.city_id = new.city_id;

  if not v_city.active then
    raise exception 'this city is not open yet' using errcode = 'check_violation';
  end if;
  if public.haversine_km(new.lat, new.lng, v_city.lat, v_city.lng) > v_city.radius_km then
    raise exception 'pin location is outside the city area' using errcode = 'check_violation';
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
  -- Timestamp granularity, and the reason the whole trigger is restated. The
  -- date window above is deliberately generous; an hour needs no generosity
  -- because the city's zone makes the comparison exact.
  if new.intent_time is not null then
    v_intent_at := (new.intent_date + new.intent_time)
                     at time zone coalesce(v_city.timezone, 'UTC');
    if v_intent_at > new.expires_at then
      raise exception 'this plan''s time falls after the pin disappears'
        using errcode = 'check_violation', hint = 'intent_time_past_expiry';
    end if;
  end if;
  -- A pin may only name a business in its own city. businesses.city_id and
  -- pins.city_id both resolve to cities.id, so this is a straight compare.
  if new.business_id is not null
     and not exists (
       select 1 from public.businesses b
       where b.id = new.business_id and b.city_id = new.city_id
     ) then
    raise exception 'that business is not in this city' using errcode = 'check_violation';
  end if;
  -- THE LINK, MADE HERE RATHER THAN BY THE CLIENT. The pin form's write path
  -- takes a fixed column list, so a business chosen on a business page would
  -- have needed a second write to a table that is deliberately immutable
  -- (no UPDATE grant, 20260816210000). Matching instead on an EXACT name and
  -- sixty metres: when the spot came from place search, MapKit handed over
  -- the venue's real name, and a listed business of that name at that corner
  -- is that business. Anything vaguer would deep-link the wrong page, which
  -- is worse than no link.
  if new.business_id is null then
    select b.id into new.business_id
    from public.businesses b
    where b.city_id = new.city_id
      and b.active
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

-- =============================================================================
-- 4. BOTH MAP FEEDS RETURN THE HOUR AND THE BUSINESS
-- =============================================================================
--
-- DROP FIRST, both of them: Postgres refuses to add an OUT column to an
-- existing RETURNS TABLE through create or replace, and the deploy would die
-- AFTER the alter tables above had already applied. Grants go with the drops
-- and are restated. Bodies are the LIVE ones from 20260831170000 with the two
-- columns added and nothing else moved.

drop function if exists public.city_pins(int);

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
    p.business_id,
    p.seeded,
    p.seed_note,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.intent_time nulls last, p.created_at
$$;

revoke execute on function public.city_pins(int) from public, anon;
grant execute on function public.city_pins(int) to authenticated;

comment on function public.city_pins(int) is
  'Every open plan in a city, with the face behind each one. Empty for a '
  'business account: the business map shows businesses, and this is the '
  'traveler feed the founder said it is not for. Carries plan beside '
  'venue_name, the optional hour beside the date, and the listed business '
  'the plan is at when there is one.';

drop function if exists public.public_city_pins(int);

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
  join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.city_id = p_city_id
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
  'Pins with no person attached, for guests. Honours the owner''s audience: '
  'somebody who narrowed to verified is not on a signed-out visitor''s map '
  'either. Says whether a pin is open to join, how many are in, the optional '
  'hour, and the business the plan is at — that last one for everyone except '
  'a business account.';


-- =============================================================================
-- 5. THE CITY RAIL SAYS HOW BUSY EACH CITY IS
-- =============================================================================
--
-- Four chips that explain nothing: not that these are the only four cities,
-- not how much is happening in any of them. A count on the chip tells the
-- truth in one glance, and a traveler on a quiet Tuesday in Lisbon can see
-- that it is Lisbon today rather than the whole product.
--
-- TWO DOORS, the same split city_pins/public_city_pins already has and for
-- the same reason: a count computed under different visibility rules than
-- the map is a chip advertising pins the viewer cannot see, which is an
-- enumeration oracle wearing a friendly number.
--
-- The member door is SECURITY INVOKER on purpose. RLS is what decides which
-- pins a member may count, and restating those rules by hand inside a
-- definer is exactly how a feed and its own summary drift apart.

create function public.city_pin_counts()
returns table (
  city_id int,
  pin_count int
)
language sql
stable
as $$
  select
    lc.city_id,
    -- NULL, never a small number. The count is an aggregate and is already
    -- bounded by what this caller can see, so the k floor is belt and braces
    -- on the one feature whose entire value is that it is trustworthy: below
    -- the city's own heat_k the chip says nothing rather than "1".
    (case when c.n >= lc.heat_k then c.n else null end)::int
  from public.launch_cities lc
  cross join lateral (
    select count(*)::int as n
    from public.pins p -- caller's RLS applies here, exactly as in city_pins
    where p.city_id = lc.city_id
      and p.expires_at > now()
      and not public.viewer_is_business()
      and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  ) c
  where lc.active
  order by lc.city_id
$$;

revoke execute on function public.city_pin_counts() from public, anon;
grant execute on function public.city_pin_counts() to authenticated;

comment on function public.city_pin_counts() is
  'How many plans each active launch city is showing THIS caller. Counted '
  'under the same visibility rules city_pins applies, so a chip can never '
  'advertise a pin the map will not draw, and floored at the city''s own '
  'heat_k: below it the answer is null rather than a 1 or a 2.';

-- The guest twin, mirroring public_city_pins' WHERE the way public_heat_cells
-- mirrors heat_cells. A guest and a member must not read different numbers
-- off the same chip for any reason other than who can see whom.
create function public.public_city_pin_counts()
returns table (
  city_id int,
  pin_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lc.city_id,
    (case when c.n >= lc.heat_k then c.n else null end)::int
  from public.launch_cities lc
  cross join lateral (
    select count(*)::int as n
    from public.pins p
    where p.city_id = lc.city_id
      and p.expires_at > now()
      -- A definer runs no policies, so the visibility RLS gives the
      -- authenticated function has to be restated here by hand.
      and (
        p.seeded
        or (
          public.is_discoverable_owner(p.user_id)
          and public.discovery_pair_ok(auth.uid(), p.user_id)
        )
      )
  ) c
  where lc.active
  order by lc.city_id
$$;

revoke execute on function public.public_city_pin_counts() from public;
grant execute on function public.public_city_pin_counts() to anon, authenticated;

comment on function public.public_city_pin_counts() is
  'city_pin_counts for a guest or a business account: the same numbers over '
  'the same rows public_city_pins would return them, floored at heat_k.';

-- -----------------------------------------------------------------------------
-- The cities nobody has opened yet
-- -----------------------------------------------------------------------------
--
-- The demand map §2.6 asks for, at essentially no cost: a traveler in Chiang
-- Mai or Porto has had nowhere at all to register that they exist, and a
-- churned user becomes a data point instead of nothing.
--
-- The user id is NULLABLE and that is the privacy answer to the founder
-- question this package carries. A signed-out visitor's request stores a
-- city name and a timestamp and nothing else; only somebody who already has
-- an account is recorded next to their stated travel intention, and even
-- then the row is unreadable by every client.

create table public.city_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  city_name text not null check (char_length(btrim(city_name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create index city_requests_name_idx on public.city_requests (lower(btrim(city_name)));

alter table public.city_requests enable row level security;

-- Insert your own, read nothing. There is deliberately NO select policy for
-- anybody: this table is a founder-side tally, and a client that could read
-- it in bulk would be reading a list of who is going where.
create policy city_requests_insert_own
  on public.city_requests for insert to authenticated
  with check (user_id = auth.uid());

revoke all on public.city_requests from anon, authenticated;
grant insert (user_id, city_name) on public.city_requests to authenticated;

comment on table public.city_requests is
  'Cities travelers asked for that are not open yet — the liquidity signal '
  '§2.6 says to instrument. Insert-own, readable by nobody. user_id is '
  'nullable so a signed-out visitor can ask without being recorded.';

-- The app's door. A definer so a signed-out visitor can use it (they have no
-- row-level anything), and so the rate limit and the trim live in one place
-- rather than in whichever screen calls it next.
create function public.request_city(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_recent int;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'that does not look like a city name'
      using errcode = 'check_violation';
  end if;

  if v_user is not null then
    perform pg_advisory_xact_lock(hashtext('city_request:' || v_user::text));
    select count(*) into v_recent
      from public.city_requests
     where user_id = v_user
       and created_at > now() - interval '24 hours';
    if v_recent >= 10 then
      raise exception 'You have asked for a few cities today already. Try again tomorrow.'
        using errcode = 'check_violation';
    end if;
  else
    -- Nothing to key a per-person limit to, so the ceiling is global and
    -- deliberately far above real traffic: it stops a script, not a person.
    select count(*) into v_recent
      from public.city_requests
     where user_id is null
       and created_at > now() - interval '1 hour';
    if v_recent >= 500 then
      raise exception 'Too many requests right now. Try again later.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.city_requests (user_id, city_name) values (v_user, v_name);
end
$$;

revoke execute on function public.request_city(text) from public;
grant execute on function public.request_city(text) to anon, authenticated;

comment on function public.request_city(text) is
  'Records that somebody wants a city Samewhere has not opened. Returns '
  'nothing and reads nothing back: the answer to "is my city coming" is a '
  'founder decision, not a query.';

-- =============================================================================
-- 6. THE MAP REMEMBERS WHERE IT WAS BUSY
-- =============================================================================
--
-- Live heat only knows about pins that exist right now, and pins hard-expire
-- within 72 hours, so a quiet Tuesday in Lisbon shows nothing at all — which
-- is the layer failing the brief's own test for it. This is Popular Times:
-- a de-identified record of where a city was busy, drawn dim beneath the
-- live layer.
--
-- RULE 3 SURVIVES because a count is not a pin. There is no user reference
-- here of ANY kind — no user_id, no pin id, no free text, nothing that could
-- be joined back to a person — and pgTAP asserts the column list so a later
-- migration adding one fails the suite.
--
-- RULE 6 IS INHERITED, NOT RECOMPUTED, and this is the part that is easy to
-- get subtly wrong. Three thresholds, all of them the CITY'S OWN heat_k:
--
--   at write   count(distinct user_id) >= heat_k for that cell, that day,
--              that hour band. A bucket that never passed k live is never
--              stored, so the table cannot hold a 1 or a 2. Curated pins have
--              a null user_id and so count zero, exactly as in heat_cells.
--   at read    min(poster_count) >= heat_k, re-applied against the city's
--              CURRENT heat_k, so raising k retroactively hides old buckets.
--   at read    count(distinct observed_on) >= heat_k. THE HISTORICAL AXIS,
--              and the one a live threshold does not give you: a cell that
--              was dense on one single day is sparse over time, and "usually
--              busy" said from one observation is a claim about that day's
--              people. k separate days, each of which independently held k
--              distinct travelers, is the floor.
--
-- The stored CHECK poster_count >= 3 is the structural floor under all of
-- it: launch_cities.heat_k is itself CHECKed >= 3, so no city can lower it.

create table public.heat_history (
  city_id int not null references public.launch_cities (city_id),
  cell_lat double precision not null,
  cell_lng double precision not null,
  weekday smallint not null check (weekday between 0 and 6),
  hour_band text not null check (hour_band in ('night', 'morning', 'afternoon', 'evening', 'unsaid')),
  observed_on date not null,
  -- Never below the global heat_k floor, asserted by the table itself.
  poster_count int not null check (poster_count >= 3),
  primary key (city_id, cell_lat, cell_lng, weekday, hour_band, observed_on)
);

alter table public.heat_history enable row level security;

-- No policies, no grants, no client. The only way in is the reader below,
-- which is a definer and re-applies k.
revoke all on public.heat_history from anon, authenticated;

comment on table public.heat_history is
  'Where a city was busy, after the pins are gone. Holds no user reference '
  'of any kind: a cell, a weekday, an hour band, a date, and a count that '
  'was already at or above the city''s heat_k when it was written. Rows are '
  'kept 90 days and swept with the pins.';

/**
 * Which part of the day an hour falls in. Immutable and tiny, and shared by
 * the writer and the reader so the two can never disagree about what
 * "evening" means — which is the coarser-bucket mistake §7 rule 6 punishes.
 */
create function public.heat_hour_band(p_time time)
returns text
language sql
immutable
as $$
  select case
    when p_time is null then 'unsaid'
    when p_time < time '05:00' then 'night'
    when p_time < time '12:00' then 'morning'
    when p_time < time '17:00' then 'afternoon'
    when p_time < time '22:00' then 'evening'
    else 'night'
  end
$$;

revoke execute on function public.heat_hour_band(time) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The expiry sweep records before it deletes
-- -----------------------------------------------------------------------------
--
-- Restated from 20260816210000 (the only definition there has ever been) with
-- the record step in front of the delete and the retention sweep behind it.
-- Same signature and no OUT columns, so create-or-replace is legal; the
-- revoke is restated anyway.

create or replace function public.expire_pins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Before the hard delete, and only ever as an aggregate that already
  -- cleared the city's k. Grouped by the cell, the intent day, its weekday
  -- and its hour band; intent_date and intent_time are already the city's
  -- own wall calendar, so nothing here converts a timezone.
  --
  -- The sweep runs every fifteen minutes, so a bucket whose three posters
  -- set three different expiries is counted three times as a one and never
  -- written. That is the SAFE direction and it is deliberate: the conflict
  -- clause takes the greatest single observation rather than accumulating a
  -- set of posters, because accumulating one would mean keeping the posters
  -- to deduplicate them, and this table holds no user reference. The layer
  -- under-remembers; it can never over-remember.
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
  join public.launch_cities lc on lc.city_id = p.city_id
  where p.expires_at <= now()
  group by
    p.city_id, 2, 3,
    extract(dow from p.intent_date),
    public.heat_hour_band(p.intent_time),
    p.intent_date,
    lc.heat_k
  -- count(distinct) ignores nulls, so a curated pin contributes nothing and
  -- three of them can never make a bucket. Same rule as heat_cells.
  having count(distinct p.user_id) >= lc.heat_k
  on conflict (city_id, cell_lat, cell_lng, weekday, hour_band, observed_on)
  do update set poster_count = greatest(
    heat_history.poster_count, excluded.poster_count
  );

  delete from public.pins where expires_at <= now();
  get diagnostics v_count = row_count;

  -- Bounded, so the record does not outlive its usefulness. Ninety days is
  -- about thirteen of any given weekday, which is enough for the k-day floor
  -- below to mean something and short enough that the table stays a summary
  -- of the season rather than a permanent archive.
  delete from public.heat_history where observed_on < current_date - 90;

  return v_count;
end
$$;

revoke execute on function public.expire_pins() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reading it back
-- -----------------------------------------------------------------------------
--
-- Identical OUT columns to heat_cells, so this is a NEW function that needs
-- no drop, and the client renders it through the same row shape and the same
-- merge as the live layer.
--
-- No weekday or band parameter, deliberately. The server already knows the
-- city's IANA zone (launch_cities.timezone), so it answers for the city's
-- OWN right now — which is what "usually busy" means to somebody looking at
-- the map — and there is no argument for a caller to get wrong, and no
-- option defaulted off that nobody sets.
--
-- 'unsaid' buckets are admitted alongside the current band because most pins
-- carry no hour yet. That makes the evidence base a SUBSET of the claim the
-- layer makes on screen ("this area is usually busy"), never a superset: the
-- app must never print an hour it inferred from a pin that did not state one.

create function public.heat_history_cells(p_city_id int)
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
  v_zone text;
  v_now timestamp;
begin
  select heat_k, coalesce(timezone, 'UTC') into v_k, v_zone
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return; -- unknown or inactive city: no history
  end if;

  v_now := now() at time zone v_zone;

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

comment on function public.heat_history_cells(int) is
  'Where this city is usually busy at this time on this weekday, from '
  'de-identified history. Two k floors, both the city''s own heat_k: every '
  'stored bucket already cleared it live, and a cell needs at least k '
  'separate days before it is returned at all.';

-- =============================================================================
-- 7. ONE WRITE PATH, SO THE HOUR HAS SOMEWHERE TO GO
-- =============================================================================
--
-- THE SPEC IS WRONG ABOUT THE CURRENT CODE HERE, so this follows the code.
-- It lists pin-form-sheet and the two map feeds and stops, as if adding a
-- column were enough for the app to write one. It is not: pins are
-- IMMUTABLE to the client (no UPDATE grant, 20260816210000, and that is what
-- keeps the 72h CHECK from being outlived by an edit), so an hour has to
-- arrive at INSERT time or never. The app has two insert paths — a plain
-- column-listed insert for a message-me-first pin and this RPC for an open
-- one — and the first of them lives in src/features/pins/api.ts with a fixed
-- column list that is not this package's to edit.
--
-- So both shapes come through here now, and p_joinable says which. Nothing
-- is loosened by the move: the function already sets user_id from auth.uid()
-- and seeded to false, which is exactly what the pins_insert_own policy
-- checks, and it additionally runs assert_good_standing and
-- assert_not_business, which the plain insert never did. validate_pin fires
-- inside the transaction either way.
--
-- DROP FIRST, and for the reason 20260831170000 records rather than the
-- OUT-column one: create-or-replace with extra parameters CREATES AN
-- OVERLOAD, and two candidates make PostgREST refuse every call as
-- ambiguous. Both new parameters are trailing and defaulted, so a client
-- still running the previous over-the-air bundle keeps posting.

drop function if exists public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text
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
  p_joinable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pin uuid;
  v_chat uuid;
  v_recent int;
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('post a plan');

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
    category, lat, lng, intent_date, intent_time, expires_at, seeded
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    nullif(btrim(coalesce(p_plan, '')), ''),
    p_category, p_lat, p_lng, p_intent_date, p_intent_time, p_expires_at, false
  )
  returning id into v_pin;

  if not p_joinable then
    return jsonb_build_object('pin_id', v_pin, 'chat_id', null);
  end if;

  -- The group is called what the plan is called — the plan text first, the
  -- venue as fallback. groups.name allows 2 to 60 characters and both
  -- sources allow 1 to 80, so both ends need saying: a long name is cut,
  -- and a one-character one — which would fail the CHECK and roll the pin
  -- back with it — gets a name instead.
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

  return jsonb_build_object('pin_id', v_pin, 'chat_id', v_chat);
end
$$;

revoke execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean
) to authenticated;

comment on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean
) is
  'Posts a plan, in either of the two shapes the form offers. p_joinable '
  'opens the group chat that makes it joinable; false posts the same pin '
  'with nobody able to walk in. Both shapes come through here because pins '
  'are immutable, so the optional hour has to arrive with the insert.';

notify pgrst, 'reload schema';
