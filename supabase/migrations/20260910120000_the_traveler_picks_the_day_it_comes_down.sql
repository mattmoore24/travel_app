-- The traveler picks the day it comes down
-- =============================================================================
--
-- Founder, 2026-09-05: "there should be no limit for how long people keep a
-- pin up for as this will help to keep the map more populated with pins."
--
-- Founder, 2026-09-10: "the pins can be up until the end of a traveler's
-- planned trip (no 72 hour limit). Make it simple, the traveler can select
-- the date that the pin will be active until, with a maximum of one year,
-- regardless of what trips they have planned."
--
-- And, the same day, overruling the floor that the first cut of this work
-- had put under it: "I think people should be able to have a pin active
-- until a date before the actual plans as sometimes people may be trying to
-- plan something in advance and not want people to be able to message about
-- it all the way up until the event."
--
-- So: a person states a DAY, and Postgres owns everything that follows from
-- it. take_down_on is the one thing anybody says; expires_at is derived from
-- it by validate_pin as the end of that day in the CITY's clock, and stops
-- being the client's business entirely.
--
-- WHAT THIS SUPERSEDES. 20260905200000_gone_when_your_plan_is_over.sql is on
-- disk, has applied in CI, and has NOT applied in production (confirmed
-- live: pins still has 19 columns, no plan_ends_at, and pg_constraint still
-- carries the 72:00:00 CHECK). Its un-capping is still wanted. Its MODEL is
-- not: it floored expiry at the plan's end and capped the hold at +31 days,
-- and the founder overruled both. That file is NOT edited - five pgTAP files
-- compile against it and the project rule against editing an applied
-- migration exists for exactly this temptation - so every statement below is
-- written to apply whether or not it has run first.
--
-- ONE TRANSACTION, and that is the point of the wrapper. AGENTS.md records
-- that this project's deploy path "fails after the migration's earlier
-- statements have already applied". Every statement here is transactional
-- DDL, so a halfway state is designed out rather than tested for.

begin;

-- -----------------------------------------------------------------------------
-- 1. THE TWO COLUMNS
-- -----------------------------------------------------------------------------

-- WHEN THE PLAN IS OVER. Server-owned: deliberately absent from the
-- per-column insert grant, so a client cannot claim a plan runs later than
-- the hours it typed. It is NO LONGER A FLOOR under expires_at - the founder
-- overruled that - it is what push_last_call speaks and what a room card
-- reads, so the app stops promising "closing at 23:00" about a night that
-- has already been and gone.
alter table public.pins add column if not exists plan_ends_at timestamptz;

comment on column public.pins.plan_ends_at is
  'When the plan itself is over, in the city''s own clock: the end time when '
  'one was named, otherwise the end of the intent day. Set by validate_pin on '
  'every write and never writable by a client. NOT a floor under expires_at: '
  'a pin may come down before its own plan, on purpose (founder, 2026-09-10).';

-- THE DAY THE TRAVELER PICKED. A deliberate denormalisation of
-- (expires_at, the city's zone), and the reason is that city_pins does not
-- return a timezone: without this column every reader would convert a
-- timestamp in its OWN zone and print the wrong day for a pin one time zone
-- away. No grant is added, so post_joinable_pin - a definer - is the only
-- door a client reaches it through.
alter table public.pins add column if not exists take_down_on date;

comment on column public.pins.take_down_on is
  'The day the traveler said this comes down, on the CITY''s clock. '
  'expires_at is DERIVED from it by validate_pin (midnight at the end of it) '
  'and is never the client''s. Stored rather than computed because a reader '
  'has no timezone to convert in.';

-- -----------------------------------------------------------------------------
-- 2. THE 72-HOUR CEILING GOES (hard rule 3, changed by the founder)
-- -----------------------------------------------------------------------------
--
-- By DEFINITION and not by name: the constraint is unnamed at
-- 20260816210000:56, so Postgres named it positionally. A no-op when
-- 20260905200000 already dropped it.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pins'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%72:00:00%';
  if v_name is not null then
    execute format('alter table public.pins drop constraint %I', v_name);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. BACKFILL BOTH COLUMNS, THEN NOT NULL
-- -----------------------------------------------------------------------------
--
-- Safe immediately: pins_validate is BEFORE INSERT FOR EACH ROW and there is
-- no UPDATE grant on the table, so the trigger is the only way a row is ever
-- born and no row exists that did not pass through it.

update public.pins p
set plan_ends_at = case
  when p.intent_time is not null and p.intent_time_end is not null then
    ((p.intent_date + p.intent_time_end) at time zone public.city_clock_zone(p.city_id))
      + case when p.intent_time_end <= p.intent_time then interval '1 day' else interval '0' end
  else
    ((p.intent_date + 1)::timestamp) at time zone public.city_clock_zone(p.city_id)
end
where p.plan_ends_at is null;

alter table public.pins alter column plan_ends_at set not null;

-- The microsecond is what maps a midnight expiry back to the day BEFORE it.
-- NOTHING'S LIFETIME CHANGES HERE: expires_at is not rewritten, so every
-- live pin comes down exactly when it already would, and each simply learns
-- the name of the day it lands on.
update public.pins p
set take_down_on =
  ((p.expires_at at time zone public.city_clock_zone(p.city_id)) - interval '1 microsecond')::date
where p.take_down_on is null;

alter table public.pins alter column take_down_on set not null;

-- -----------------------------------------------------------------------------
-- 4. THE TRIGGER
-- -----------------------------------------------------------------------------
--
-- Same signature, so no drop is owed and the binding at 20260816210000:121
-- is untouched. The city resolution, the business rules and the
-- ten-live-pins cap are carried over verbatim; everything about time is new.
create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hint record;
  v_zone text;
  v_city_today date;
  v_plan_end timestamptz;
begin
  -- WHICH CITY. Unchanged. The client sends the city it was browsing, which
  -- is right whenever the spot is in that city's orbit (20 km: Nice to
  -- Monaco, Manhattan to Brooklyn) and wrong the moment somebody pans a
  -- continent. Then the spot decides for itself, and only when the spot is
  -- nowhere near any seeded city does the browsed city stand. Never a
  -- refusal: a pin is a plan, and a plan in the middle of nowhere is still a
  -- plan.
  select c.id, c.lat, c.lng into v_hint
  from public.cities c
  where c.id = new.city_id;
  if v_hint.id is null
     or public.haversine_km(new.lat, new.lng, v_hint.lat, v_hint.lng) > 20 then
    new.city_id := coalesce(public.nearest_city(new.lat, new.lng), new.city_id);
  end if;

  -- EVERY CLOCK IN THIS FUNCTION IS THE CITY'S. A pin is a plan somewhere,
  -- and "today" means today where the plan is, not where the phone is.
  v_zone := public.city_clock_zone(new.city_id);
  v_city_today := (now() at time zone v_zone)::date;

  -- WHEN THE PLAN IS OVER.
  if new.intent_time is not null and new.intent_time_end is not null then
    v_plan_end := (new.intent_date + new.intent_time_end) at time zone v_zone;
    -- "10 PM to 2 AM" ends tomorrow. An end at or before the start is the
    -- only way to say so with two times, so it is read that way.
    if new.intent_time_end <= new.intent_time then
      v_plan_end := v_plan_end + interval '1 day';
    end if;
  else
    -- No end named: a start with no finish, or no hour at all, or TBD. The
    -- plan is then the DAY, and a day is over when it is over where the plan
    -- is.
    v_plan_end := ((new.intent_date + 1)::timestamp) at time zone v_zone;
  end if;
  new.plan_ends_at := v_plan_end;

  -- THE DAY, in three cases.
  if new.take_down_on is null and new.expires_at is not null then
    -- LEGACY. An old bundle, or seed_launch_pins' literal
    -- `now() + interval '48 hours'` (20260831150000:110), still says when
    -- rather than which day. Read the day out of it rather than refusing,
    -- so the deploy gap between the migration and the over-the-air update
    -- costs nobody a pin.
    new.take_down_on := ((new.expires_at at time zone v_zone) - interval '1 microsecond')::date;
  elsif new.take_down_on is null then
    -- THE DEFAULT: the day of the plan itself.
    new.take_down_on := greatest(new.intent_date, v_city_today);
  end if;
  -- A floor at today, ASSIGNED rather than raised: a client whose arithmetic
  -- disagrees with the city's clock by an hour should post a pin that
  -- behaves, not see a refusal it cannot act on.
  --
  -- There is deliberately NO floor at intent_date. The founder overruled it
  -- on 2026-09-10: a pin that comes down before its own plan is somebody
  -- planning ahead who does not want to be written to for a month, and it is
  -- an ordinary choice, not an error.
  new.take_down_on := greatest(new.take_down_on, v_city_today);

  -- THE CEILING, after the branch so the legacy path is covered too. 366 in
  -- the trigger against the 365 the form offers: a client that offers
  -- exactly a year must never be refused by a daylight-saving shift or a
  -- clock a few hours apart.
  if new.take_down_on > v_city_today + 366 then
    raise exception 'a pin can stay up for a year at most'
      using errcode = 'check_violation', hint = 'pin_ceiling';
  end if;

  -- THE DERIVATION. This is the line that takes the instant away from the
  -- client: midnight at the END of the chosen day, in the city's zone.
  new.expires_at := ((new.take_down_on + 1)::timestamp) at time zone v_zone;

  -- Unreachable now that the day is floored at the city's today, and kept
  -- anyway: it costs nothing and it is the assertion the derivation above
  -- has to keep being true.
  if new.expires_at <= now() then
    raise exception 'pin would already be expired' using errcode = 'check_violation';
  end if;

  -- A DAY THAT HAS GONE, and a typo guard. The old upper bound was derived
  -- from expires_at; with no ceiling to derive from it is absolute and
  -- generous. The -1 absorbs client-local versus UTC date drift in both
  -- directions; 400 days is the trips rule's shape, a guard against a
  -- mistyped year rather than a limit on planning.
  if new.intent_date < current_date - 1 then
    raise exception 'that day has already gone'
      using errcode = 'check_violation', hint = 'intent_date_past';
  end if;
  if new.intent_date > current_date + 400 then
    raise exception 'that day is too far ahead'
      using errcode = 'check_violation', hint = 'intent_date_far';
  end if;

  -- THE TWO REFUSALS THAT ARE GONE. 20260904120000:232-250 refused a plan
  -- whose hour or whose end fell after the pin disappeared. Under the
  -- founder's overrule that is a legal pin, so both are deleted rather than
  -- inverted into a floor.

  -- A pin may only name a business NEAR it. Unchanged.
  if new.business_id is not null
     and not exists (
       select 1 from public.businesses b
       where b.id = new.business_id
         and public.haversine_km(new.lat, new.lng, b.lat, b.lng) <= 30
     ) then
    raise exception 'that business is not in this city' using errcode = 'check_violation';
  end if;
  -- THE LINK, MADE HERE RATHER THAN BY THE CLIENT. Unchanged: exact name,
  -- sixty metres.
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
  -- TEN LIVE PINS. Unchanged, and it still counts what is ON THE MAP
  -- (expires_at > now()) rather than what is planned: a pin a person is
  -- holding for a year is a pin other people are looking at.
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

-- -----------------------------------------------------------------------------
-- 5. THE BACKSTOPS UNDERNEATH THE TRIGGER
-- -----------------------------------------------------------------------------
--
-- The 72-hour rule was a CHECK, and a CHECK binds every write path forever.
-- Replacing it with only a trigger would quietly downgrade the enforcement
-- class, so the ceiling keeps a declarative floor under it that survives a
-- future bug in the function above.
--
-- 369 and not 366, and the arithmetic matters: the trigger allows
-- take_down_on = city-today + 366 in ANY zone, and the widest instant that
-- can produce is a UTC+14 city whose today is a calendar day ahead of the
-- UTC creation date - created_at 2026-01-01T11:00Z yields expires_at
-- 2027-01-04T10:00Z, 367 days and 23 hours. 369 clears that plus a
-- daylight-saving shift. The layers are genuinely nested (form 365, trigger
-- 366, CHECK 369), so no legal tap can be refused by the layer beneath it
-- with a raw 23514 a person cannot act on.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pins'::regclass and conname = 'pins_take_down_within_a_year'
  ) then
    alter table public.pins
      add constraint pins_take_down_within_a_year
      check (expires_at <= created_at + interval '369 days');
  end if;
end
$$;

-- THERE IS DELIBERATELY NO `expires_at > created_at` CHECK to go with it, and
-- running the suite is what settled that. A pin born dead is already refused
-- by the trigger, and there is no UPDATE grant on this table at all, so such
-- a CHECK could only ever bind the OWNER - which is precisely who needs to
-- move a row's expiry: every sweep test ages a pin with
-- `update public.pins set expires_at = now() - interval '1 minute'`, and so
-- would any hand correction. It would have bought nothing and forbidden the
-- one caller it could reach.

-- -----------------------------------------------------------------------------
-- 6. THE BYPASS, CLOSED
-- -----------------------------------------------------------------------------
--
-- The column-level INSERT grant (20260828150000:26-37) has always included
-- expires_at, so a direct PostgREST insert could set a pin's lifetime
-- without going through post_joinable_pin at all. That is why the ceiling
-- could never honestly live in the form.
--
-- Nothing shipped writes pins directly: src/features/pins/api.ts's createPin
-- and postJoinablePin are exported and imported by no file (hooks.ts pulls
-- only deletePin, fetchCity, fetchCityPins, fetchFeaturedCities,
-- fetchHeatCells, fetchLaunchCities, fetchPinCrew and joinPinChat, and
-- useCreatePin calls the post_joinable_pin RPC directly). Every server
-- writer is SECURITY DEFINER and unaffected by column grants. After this,
-- expires_at is one hundred percent the server's.
revoke insert (expires_at) on public.pins from authenticated;

comment on table public.pins is
  'Traveler pins. INSERT is granted per column, and neither expires_at nor '
  'take_down_on is among them: the day is stated through post_joinable_pin '
  'and the instant is derived by validate_pin, so a pin''s lifetime is the '
  'server''s alone. Hard rule 3 is now "a traveler picks the day, up to a '
  'year", not "72 hours".';

-- -----------------------------------------------------------------------------
-- 7. THE LAST-CALL PUSH SPEAKS THE PLAN, NOT THE PIN
-- -----------------------------------------------------------------------------
--
-- It printed 'Closing at 23:00' from expires_at and fired three to four
-- hours before it, which was safe only because a pin could not outlive its
-- plan by more than 72 hours. That construction is gone: without this, the
-- hourly cron (jobid 16, '15 * * * *') would tell every member of a room
-- that a night is closing, months after it happened. Re-keyed onto
-- plan_ends_at the sentence is true again, and the clock fires when the plan
-- is nearly over, which is what it was always for.
--
-- This is the one breakage in the whole change that would have been silent,
-- unbounded and user-visible.
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
    'Closing at ' || to_char(p.plan_ends_at at time zone public.city_clock_zone(c.id), 'HH24:MI')
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
  where p.plan_ends_at > p_now + interval '3 hours'
    and p.plan_ends_at <= p_now + interval '4 hours'
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

-- -----------------------------------------------------------------------------
-- 8. THE TWO PIN FEEDS TAKE A DATE RANGE
-- -----------------------------------------------------------------------------
--
-- The founder's filter: "This should be a filter for travelers so that they
-- can quickly only show pins with plans that are occurring during whatever
-- date range they select." Both arguments DEFAULT TO NULL, and null means
-- every day - the same shape heat_cells' p_date has always had. That is also
-- what makes an over-the-air update that somehow leads this migration
-- degrade to the old behaviour instead of failing.
--
-- DROP FIRST, twice over: the OUT list gains two columns and the argument
-- list changes, and Postgres refuses both through create-or-replace. Grants
-- and comments are restated after every drop.

drop function public.city_pins(int);
create function public.city_pins(
  p_city_id int,
  p_from date default null,
  p_to date default null
)
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
  take_down_on date,
  plan_ends_at timestamptz,
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
    p.take_down_on,
    p.plan_ends_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p -- caller's RLS applies here: expiry and who may see whom
  join public.cities c on c.id = p_city_id
  left join public.profiles pr on pr.user_id = p.user_id
  where public.haversine_km(p.lat, p.lng, c.lat, c.lng) <= public.map_radius_km()
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
    and (p_from is null or p.intent_date >= p_from)
    and (p_to is null or p.intent_date <= p_to)
  order by p.intent_date, p.intent_time nulls last, p.created_at
$$;
revoke execute on function public.city_pins(int, date, date) from public, anon;
grant execute on function public.city_pins(int, date, date) to authenticated;

comment on function public.city_pins(int, date, date) is
  'Every live plan within map_radius_km() of the named city, as this member '
  'may see it. The pin''s own city_id is a label; the map is a circle. '
  'p_from and p_to narrow by the PLAN''s day; null means any day.';

drop function public.public_city_pins(int);
create function public.public_city_pins(
  p_city_id int,
  p_from date default null,
  p_to date default null
)
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
  take_down_on date,
  plan_ends_at timestamptz,
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
    -- through, and handing it the join between plans and its own listing is
    -- the owner-facing aggregate the package deliberately left out.
    case when public.viewer_is_business() then null else p.business_id end,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at,
    p.take_down_on,
    p.plan_ends_at,
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
    and (p_from is null or p.intent_date >= p_from)
    and (p_to is null or p.intent_date <= p_to)
  order by p.intent_date, p.intent_time nulls last, p.created_at
$$;
revoke execute on function public.public_city_pins(int, date, date) from public;
grant execute on function public.public_city_pins(int, date, date) to anon, authenticated;

comment on function public.public_city_pins(int, date, date) is
  'Pins with no person attached, for guests, within map_radius_km() of the '
  'named city. Honours the owner''s audience. p_from and p_to narrow by the '
  'PLAN''s day; null means any day.';

-- -----------------------------------------------------------------------------
-- 9. HEAT TAKES THE SAME RANGE, AND k STAYS THE SERVER'S
-- -----------------------------------------------------------------------------
--
-- DROP FIRST, and here the reason is not the OUT list (unchanged) but the
-- ARGUMENT list: a create-or-replace with different arguments makes an
-- OVERLOAD, and two functions of one name make every PostgREST call to it
-- ambiguous. p_date keeps its name and position so a bundle that has not
-- updated yet keeps its heat layer working through the deploy gap.
--
-- §7 rule 6 is untouched: k is read inside the function and is never a
-- parameter.

drop function public.heat_cells(int, date);
create function public.heat_cells(
  p_city_id int,
  p_date date default null,
  p_from date default null,
  p_to date default null
)
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
    and (p_from is null or p.intent_date >= p_from)
    and (p_to is null or p.intent_date <= p_to)
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;
revoke execute on function public.heat_cells(int, date, date, date) from public, anon;
grant execute on function public.heat_cells(int, date, date, date) to authenticated;

drop function public.public_heat_cells(int, date);
create function public.public_heat_cells(
  p_city_id int,
  p_date date default null,
  p_from date default null,
  p_to date default null
)
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
    and (p_from is null or p.intent_date >= p_from)
    and (p_to is null or p.intent_date <= p_to)
    -- A definer runs no policies, so the visibility rules the authenticated
    -- function gets from RLS have to be restated here by hand.
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;
revoke execute on function public.public_heat_cells(int, date, date, date) from public;
grant execute on function public.public_heat_cells(int, date, date, date) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. THE WRITE PATH STATES A DAY
-- -----------------------------------------------------------------------------
--
-- p_take_down_on is APPENDED rather than inserted, so any positional caller
-- keeps working, and p_expires_at loses its NOT NULL-ness to become the
-- legacy hint the trigger reads. PostgREST resolves by argument NAME, so a
-- bundle sending p_expires_at and a bundle sending p_take_down_on both
-- resolve against this one function - which is what makes the deploy gap
-- survivable in both directions.

drop function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid, time, boolean
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
  p_expires_at timestamptz default null,
  p_plan text default null,
  p_intent_time time default null,
  p_joinable boolean default true,
  p_business_id uuid default null,
  p_intent_time_end time default null,
  p_time_tbd boolean default false,
  p_take_down_on date default null
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
    expires_at, take_down_on, seeded, business_id
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    nullif(btrim(coalesce(p_plan, '')), ''),
    p_category, p_lat, p_lng, p_intent_date, p_intent_time, p_intent_time_end,
    coalesce(p_time_tbd, false),
    -- Both may be null: validate_pin derives the instant from the day, and
    -- falls back to reading the day out of a legacy instant.
    p_expires_at, p_take_down_on, false, p_business_id
  )
  returning id, city_id into v_pin, v_city;

  if not p_joinable then
    return jsonb_build_object(
      'pin_id', v_pin, 'chat_id', null, 'city', public.city_json(v_city));
  end if;

  -- The group is called what the plan is called - the plan text first, the
  -- venue as fallback. groups.name allows 2 to 60 characters and both
  -- sources allow 1 to 80, so both ends need saying.
  v_name := left(btrim(coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p_venue_name)), 60);
  if char_length(v_name) < 2 then
    v_name := 'Meet up';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  -- No end date, deliberately. The pin's day is the pin's; the conversation
  -- that came out of it is not on a timer, and the founder confirmed on
  -- 2026-09-10 that it stays usable long after the plan.
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
  timestamptz, text, time, boolean, uuid, time, boolean, date
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid, time, boolean, date
) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. THE INDEX THE FILTER NARROWS ON
-- -----------------------------------------------------------------------------
--
-- intent_date is what the founder's date filter tests and nothing indexed
-- it, which mattered little against three days of pins and matters against a
-- year of them. pins_city_expiry_idx is left alone: its leading column has
-- been dead weight for the feeds since they moved to haversine, and dropping
-- it is a separate call.
create index if not exists pins_intent_date_idx on public.pins (intent_date);

notify pgrst, 'reload schema';

commit;
