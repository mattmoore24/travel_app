-- A business goes where its door is
-- =============================================================================
--
-- Founder, 2026-09-05: "businesses shouldn't be limited on where they can put
-- their pin ... just a simple search bar ... or there can be an option in
-- smaller text below that allows them to just set their pin ... full
-- flexibility and scalability than forcing business users to pick from preset
-- cities set by me".
--
-- So the launch-city fence on the business path goes. A business types its
-- address anywhere on earth, or drops its marker by hand, and the SERVER files
-- the listing under the city its marker is in. The client never chooses a
-- city; what it sends in p_city_id is a hint, and a hint is only ever kept
-- when the marker is inside that city's orbit.
--
-- §7, restated as predicates this file has to keep true:
--
--   Rule 2 (no live location). p_lat / p_lng are a typed, picked or dragged
--   marker; nothing in this file reads a device. The only centres the client
--   ever computes are a marker the person placed, a featured city matched by
--   the device's Intl time zone, or the origin (0, 0).
--
--   Rule 5 (moderated text). screen_business_text still screens name,
--   description, place_label, hours_note and address on every write
--   (20260829160000:52-68, restated with the edit guard in 20260903060000).
--   Nothing here touches it.
--
--   Rule 8 (a business never reaches out). Untouched: register_business still
--   refuses a finished traveler, and my_business plus public_featured_cities
--   remain a business account's only doors. A Porto business does not put
--   Porto on the rail; featured_cities counts pins, not listings.
--
-- SUPERSEDED: 20260904120000:45-46 said "businesses still register in a
-- launch city; that is the business side's decision, not this one's". This is
-- that decision, and it goes the same way pins went the day before.
--
-- RETIRED: 20260829160000's geofence (added 2026-08-29), which joined
-- launch_cities and refused a marker outside a launch city's radius_km. Its
-- two refusals disappear with it; no new refusal replaces them, because a
-- listing in an unlaunched city is a listing, not an error.
--
-- NO FUNCTION SIGNATURE, OUT LIST OR RETURN TYPE CHANGES in this file:
-- register_business, update_business_location, city_businesses, city_whats_on
-- and city_rooms are restated with the same arguments and the same RETURNS,
-- bodies only. So `create or replace` is used deliberately, and the drop-first
-- rule (AGENTS.md, the traps skill) is not being skipped by accident. Grants
-- are restated anyway, so a reader of this file sees the whole contract.

-- ---------------------------------------------------------------------------
-- 1. Which city a marker is in
-- ---------------------------------------------------------------------------
--
-- Three tiers, and COALESCE stops at the first non-null:
--
--   Tier 1: the caller's hint stands when the marker is within 20 km of it.
--   This is validate_pin's rule verbatim (20260904120000:212-218), and it is
--   what keeps a sub-75 m nudge, or any move inside the city, from ever
--   changing city_id and so from tripping business_rename_resets' city
--   branch. A hint that is no cities row (a forged id, or null) simply finds
--   nothing and falls through.
--
--   Tier 2: nearest_city, distance over the fourth root of population inside
--   a half-degree box, null beyond roughly 55 km. Midtown answers New York,
--   not Hoboken; the Croisette answers Cannes, not Nice.
--
--   Tier 3: the nearest city on earth by plain distance. businesses.city_id
--   is NOT NULL and a business signing up has no browsed city to fall back
--   on (a pin keeps the city the traveler was browsing; a business has
--   nothing to keep). The full scan over every seeded city runs only when
--   tier 2 answered null, which is at sea or in the outback, and a
--   registration is a one-off.
--
-- Never null while cities has rows. Never a refusal.

create or replace function public.resolve_business_city(
  p_lat double precision,
  p_lng double precision,
  p_hint int default null
)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select h.id from public.cities h
      where h.id = p_hint
        and public.haversine_km(p_lat, p_lng, h.lat, h.lng) <= 20),
    public.nearest_city(p_lat, p_lng),
    (select c.id from public.cities c
      order by public.haversine_km(p_lat, p_lng, c.lat, c.lng), c.population desc, c.id
      limit 1))
$$;

revoke execute on function public.resolve_business_city(double precision, double precision, int)
  from public, anon;
grant execute on function public.resolve_business_city(double precision, double precision, int)
  to authenticated;

comment on function public.resolve_business_city(double precision, double precision, int) is
  'Which city a business is filed under: the caller''s hint when the marker is '
  'within 20 km of it (validate_pin''s rule), else the nearest seeded city '
  '(nearest_city), else the nearest city on earth by distance, because a '
  'listing always has one and a business signing up has no browsed city to '
  'fall back on. Never a refusal.';

-- ---------------------------------------------------------------------------
-- 2. The preview door: say where a marker will be filed before writing
-- ---------------------------------------------------------------------------
--
-- The same function with the same hint the write path uses (null on first
-- registration, the stored city on re-entry), so the sentence under the map,
-- the confirm card and the stored row cannot disagree. SECURITY DEFINER
-- because city_json is authenticated-only and this is called by the same
-- role; the definer keeps the two grants from having to be kept in step.

create or replace function public.city_for_spot(
  p_lat double precision,
  p_lng double precision,
  p_hint int default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.city_json(public.resolve_business_city(p_lat, p_lng, p_hint))
$$;

revoke execute on function public.city_for_spot(double precision, double precision, int)
  from public, anon;
grant execute on function public.city_for_spot(double precision, double precision, int)
  to authenticated;

comment on function public.city_for_spot(double precision, double precision, int) is
  'resolve_business_city as the client''s CityRow with its clock, so Where is '
  'it can say where a marker will be filed before anything is written.';

-- ---------------------------------------------------------------------------
-- 3. Registering, anywhere
-- ---------------------------------------------------------------------------
--
-- Same signature and return as 20260829160000:86-101. The three refusals that
-- are about the ACCOUNT stay word for word; the two that were about
-- geography are gone, and the launch_cities lookup with them. The insert
-- writes the resolved city, not the hint.

create or replace function public.register_business(
  p_name text,
  p_category public.business_category,
  p_city_id int,
  p_lat double precision,
  p_lng double precision,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_id uuid;
  v_city_id int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.businesses where owner_user_id = v_user) then
    raise exception 'this account already runs a business';
  end if;
  -- A traveler who has finished onboarding is a person, and a person is not
  -- a business. Catching it here keeps the two account kinds from ever
  -- overlapping on one auth row, which is what makes every guard above a
  -- simple question with one answer.
  if exists (
    select 1 from public.profiles
    where user_id = v_user and onboarding_completed_at is not null
  ) then
    raise exception 'this account is already a traveler';
  end if;

  -- WHICH CITY. The marker decides; p_city_id is a hint that stands only
  -- while the marker is inside its orbit. Never a refusal on geography.
  v_city_id := public.resolve_business_city(p_lat, p_lng, p_city_id);

  insert into public.chats (kind) values ('room') returning id into v_chat;

  insert into public.businesses
    (city_id, name, category, lat, lng, address, chat_id, owner_user_id, state, claimed_at)
  values
    (v_city_id, p_name, p_category, p_lat, p_lng, nullif(btrim(coalesce(p_address, '')), ''),
     v_chat, v_user, 'unconfirmed', now())
  returning id into v_id;

  -- The place's name IS its display name. Nothing else ever gets typed into
  -- this account's profile, and every author line in every room reads it.
  update public.profiles set display_name = p_name where user_id = v_user;

  return v_id;
end
$$;

revoke execute on function public.register_business(
  text, public.business_category, int, double precision, double precision, text
) from public, anon;
-- Until now implied by default privileges only; said out loud here.
grant execute on function public.register_business(
  text, public.business_category, int, double precision, double precision, text
) to authenticated;

comment on function public.register_business(
  text, public.business_category, int, double precision, double precision, text
) is
  'Create the caller''s one business. p_city_id is a hint, not a fence: the '
  'listing is filed under the city its marker is in (resolve_business_city), '
  'any of the seeded cities, never refused on geography.';

-- ---------------------------------------------------------------------------
-- 4. Moving the marker, anywhere
-- ---------------------------------------------------------------------------
--
-- Same signature. The stored city is the hint, so a nudge keeps it and a
-- move past 20 km re-files the listing. A re-filing is always a move of more
-- than 75 m, which business_rename_resets was going to reset anyway; the
-- trigger is untouched and its city_id branch stays.

create or replace function public.update_business_location(
  p_lat double precision,
  p_lng double precision,
  p_city_id int default null,
  p_address text default null,
  p_clear_address boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_city_id int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_business from public.businesses where owner_user_id = auth.uid();
  if not found then
    raise exception 'this account does not run a business' using errcode = '42501';
  end if;

  v_city_id := public.resolve_business_city(p_lat, p_lng, coalesce(p_city_id, v_business.city_id));

  update public.businesses
     set lat = p_lat,
         lng = p_lng,
         city_id = v_city_id,
         address = case
           when p_clear_address then null
           when p_address is not null then nullif(btrim(p_address), '')
           else address
         end
   where id = v_business.id;
end
$$;

revoke execute on function public.update_business_location(
  double precision, double precision, int, text, boolean
) from public, anon;
grant execute on function public.update_business_location(
  double precision, double precision, int, text, boolean
) to authenticated;

comment on function public.update_business_location(
  double precision, double precision, int, text, boolean
) is
  'Move the marker. The stored city stands while the marker stays within 20 km '
  'of it, otherwise the listing is re-filed under the city the marker is in; a '
  'city change or a move over 75 m still costs the badge and the listing '
  'through businesses_rename_resets, which is the point rather than the cost.';

-- ---------------------------------------------------------------------------
-- 5. The three city feeds read the label OR the circle
-- ---------------------------------------------------------------------------
--
-- `b.city_id = p_city_id` alone would hide a Cascais door from somebody
-- browsing Lisbon, which a Cascais pin is not hidden from. The circle alone
-- (map_radius_km() from the browsed city's centre) would drop a tier-3
-- listing whose nearest city is 300 km away from its own city's map. So both:
-- the label keeps a business on at least one map, and the circle draws it
-- for the neighbours, exactly as city_pins does.
--
-- Select lists are IDENTICAL to the latest definitions (city_businesses and
-- city_whats_on: 20260827110000 and 20260902170000; city_rooms:
-- 20260827100000). Only FROM and WHERE change. city_rooms' `order by 7` is
-- positional and still points at last_message_at because the column order
-- is untouched.
--
-- No (lat, lng) index on businesses yet: the table is hundreds of rows and
-- the haversine runs only over rows that survive the state and active
-- filters. Add a bounding-box prefilter in the shape of cities_within_km
-- (20260904120000:91-108) when city_businesses shows in the slow logs.

create or replace function public.city_businesses(p_city_id int)
returns table (
  id uuid,
  chat_id uuid,
  name text,
  category public.business_category,
  lat double precision,
  lng double precision,
  verified boolean,
  cover_path text,
  has_live_post boolean,
  member_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.chat_id,
    b.name,
    b.category,
    b.lat,
    b.lng,
    b.verified,
    (select bp.storage_path from public.business_photos bp
      where bp.business_id = b.id and bp.moderation_status = 'approved'
      order by bp.position limit 1),
    exists (
      select 1 from public.business_posts po
      where po.business_id = b.id and po.archived_at is null
    ),
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now())
  from public.businesses b
  join public.cities c on c.id = p_city_id
  where (b.city_id = p_city_id
         or public.haversine_km(b.lat, b.lng, c.lat, c.lng) <= public.map_radius_km())
    and b.active
    and b.state = 'listed'
  order by b.name
$$;

grant execute on function public.city_businesses(int) to anon, authenticated;

comment on function public.city_businesses(int) is
  'Every listed business filed under the named city or within map_radius_km() '
  'of its centre. The label or the circle, so a business is on at least one '
  'map and a Cascais door draws for somebody browsing Lisbon, as a pin does. '
  'city_whats_on and city_rooms use the same predicate on purpose.';

create or replace function public.city_whats_on(p_city_id int)
returns table (
  business_id uuid,
  post_id uuid,
  title text,
  happens_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (po.business_id)
    po.business_id,
    po.id,
    po.title,
    po.happens_at
  from public.business_posts po
  join public.businesses b on b.id = po.business_id
  join public.cities c on c.id = p_city_id
  where (b.city_id = p_city_id
         or public.haversine_km(b.lat, b.lng, c.lat, c.lng) <= public.map_radius_km())
    and b.active
    and b.state = 'listed'
    and po.archived_at is null
  order by po.business_id, po.happens_at nulls last, po.created_at desc
$$;

grant execute on function public.city_whats_on(int) to anon, authenticated;

comment on function public.city_whats_on(int) is
  'What is on at each listed business in one city: the soonest live post per '
  'business. The twin of city_businesses.has_live_post, carrying the words '
  'instead of the boolean. The filters are city_businesses''s own, '
  'deliberately, label or circle included, so the two lists cannot come to '
  'disagree about which listings exist.';

create or replace function public.city_rooms(p_city_id int)
returns table (
  chat_id uuid,
  business_id uuid,
  name text,
  kind text,
  lat double precision,
  lng double precision,
  member_count int,
  last_message_at timestamptz,
  public_preview boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.chat_id,
    b.id,
    b.name,
    b.category::text,
    b.lat,
    b.lng,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now()),
    (select max(msg.created_at) from public.messages msg where msg.chat_id = b.chat_id),
    b.public_preview
  from public.businesses b
  join public.cities c on c.id = p_city_id
  where (b.city_id = p_city_id
         or public.haversine_km(b.lat, b.lng, c.lat, c.lng) <= public.map_radius_km())
    and b.active
    and b.state = 'listed'
    and b.chat_id is not null
  order by 7 desc nulls last
$$;

grant execute on function public.city_rooms(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the columns mean now
-- ---------------------------------------------------------------------------
--
-- No column is dropped: the live bundle still selects launch_cities.radius_km
-- and an OTA update cannot arrive before this migration does.

comment on column public.launch_cities.radius_km is
  'Unused since 2026-09-05: pins stopped reading it on 2026-09-04 and '
  'businesses resolve their city from the marker. Kept because the live '
  'bundle still selects it; drop in a later migration.';

comment on column public.businesses.city_id is
  'Resolved from the marker by resolve_business_city on every write '
  '(register_business, update_business_location); the client''s city is only '
  'a hint. References cities, any of them, since 2026-09-05.';
