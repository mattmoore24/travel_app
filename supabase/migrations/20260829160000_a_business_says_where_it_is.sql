-- A business says where it is, and the city it claims has to be true
-- =============================================================================
--
-- Founder: "the business should be able to enter an address and confirm the
-- pin location, or have the option to drag and drop a pin without entering an
-- address. Address should be the default option... The business should also be
-- able to keep their address the same as whatever they entered while adjusting
-- the pin location if needed."
--
-- Today the "Where is it?" step asks two things: a city chip and a tap on a
-- map. No address is ever typed, and `businesses.place_label` — which looks
-- like the place to put one — is not it. place_label is the finding-the-door
-- note ("Two minutes from the station, blue door"), the thing business-edit
-- calls "The bit the map can't tell anyone", and an address written into it
-- would delete the more useful of the two. So the address gets its own column
-- and they live side by side, which is also the only way "keep the address I
-- typed while I move the marker" can be true: two pieces of state, neither
-- derived from the other.
--
-- AND THE GEOFENCE, which is the part nobody asked for and which matters more.
-- There is none. `haversine_km` has exactly one caller in the whole schema
-- (validate_pin), `register_business` validates the caller and nothing about
-- geography, and `businesses.city_id` references `cities` rather than
-- `launch_cities` — so a marker can sit anywhere on earth inside the plain
-- -90..90 / -180..180 CHECKs while the listing claims Bangkok. business-signup
-- even carries a comment saying the server refuses "a marker outside the
-- city's radius". It does not; that sentence is about pins. A traveler
-- filtering the map to a city is entitled to the city being true, so the
-- business path gets the check pins have had since August.

-- ---------------------------------------------------------------------------
-- 1. The address, beside the door note rather than instead of it
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column address text check (address is null or char_length(address) <= 160);

comment on column public.businesses.address is
  'The street address as the business typed or picked it. Never derived from '
  'the marker: moving the marker must leave this exactly as it was, which is '
  'the founder''s rule and the reason it is not the same column as the '
  'coordinates. place_label stays what it always was, the human directions a '
  'latitude cannot give.';

-- Readable by everybody who can read the business at all, and editable by its
-- owner, which the coordinates deliberately are not.
grant select (address) on public.businesses to anon, authenticated;
grant update (address) on public.businesses to authenticated;

-- Screened like every other free-text field on the row. Restated whole: a
-- create-or-replace replaces, and a reader needs the function, not a diff.
create or replace function public.screen_business_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(
        concat_ws(' ', new.name, new.description, new.place_label, new.hours_note, new.address)
      ) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.screen_business_text() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Registering, with an address and inside the city it claims
-- ---------------------------------------------------------------------------
--
-- DROP FIRST. Adding a defaulted parameter to a Postgres function creates a
-- second OVERLOAD rather than replacing the original, and PostgREST calling by
-- named argument does not save you — a five-argument call would match both and
-- fail with "function is not unique". The grant goes with the drop, so it is
-- restated.

drop function if exists public.register_business(
  text, public.business_category, int, double precision, double precision
);

create function public.register_business(
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
  v_city record;
  v_km double precision;
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

  -- THE GEOFENCE, in the same shape validate_pin has used since August: the
  -- city must be one we have launched in and be switched on, and the marker
  -- must be inside its radius. Without this the city chip was decoration.
  select lc.radius_km, c.lat, c.lng, c.name
    into v_city
    from public.launch_cities lc
    join public.cities c on c.id = lc.city_id
   where lc.city_id = p_city_id and lc.active;
  if not found then
    raise exception 'we have not launched in that city yet'
      using errcode = 'check_violation';
  end if;

  v_km := public.haversine_km(p_lat, p_lng, v_city.lat, v_city.lng);
  if v_km > v_city.radius_km then
    raise exception 'that marker is not in %. Drag it onto your door, or pick the right city.',
      v_city.name
      using errcode = 'check_violation';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  insert into public.businesses
    (city_id, name, category, lat, lng, address, chat_id, owner_user_id, state, claimed_at)
  values
    (p_city_id, p_name, p_category, p_lat, p_lng, nullif(btrim(coalesce(p_address, '')), ''),
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

-- ---------------------------------------------------------------------------
-- 3. Moving the marker, which is not an ordinary edit
-- ---------------------------------------------------------------------------
--
-- lat, lng and city_id are withheld from the client's UPDATE grant on purpose:
-- "a business that could move its own marker could verify a surf shack and
-- then become the Marriott". So moving one goes through a function that
-- re-runs the geofence — and the move still costs the badge and the listing,
-- because businesses_rename_resets fires on exactly this change. That is not a
-- side effect to work around; it is the rule that makes the badge mean
-- something, and the screen has to say so before it calls this.

create function public.update_business_location(
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
  v_city record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_business from public.businesses where owner_user_id = auth.uid();
  if not found then
    raise exception 'this account does not run a business' using errcode = '42501';
  end if;

  v_city_id := coalesce(p_city_id, v_business.city_id);

  select lc.radius_km, c.lat, c.lng, c.name
    into v_city
    from public.launch_cities lc
    join public.cities c on c.id = lc.city_id
   where lc.city_id = v_city_id and lc.active;
  if not found then
    raise exception 'we have not launched in that city yet'
      using errcode = 'check_violation';
  end if;
  if public.haversine_km(p_lat, p_lng, v_city.lat, v_city.lng) > v_city.radius_km then
    raise exception 'that marker is not in %. Drag it onto your door, or pick the right city.',
      v_city.name
      using errcode = 'check_violation';
  end if;

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
  'Move the marker. Re-runs the city geofence, and knocks the listing back to '
  'unconfirmed and clears the badge through businesses_rename_resets, which '
  'is the point rather than the cost.';

-- ---------------------------------------------------------------------------
-- 4. The page carries the address
-- ---------------------------------------------------------------------------
--
-- DROP FIRST: Postgres will not add an OUT column to an existing RETURNS
-- TABLE, and finding that out mid-deploy means finding it out after everything
-- above has applied. Grant restated with the drop.

drop function if exists public.business_detail(uuid);

create function public.business_detail(p_business_id uuid)
returns table (
  id uuid,
  chat_id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  address text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  verified boolean,
  -- Whether anybody runs it here. NOT the owner's id, and not their name:
  -- the question a traveler's screen has to answer is "is there somebody on
  -- the other end of a message", and that is a boolean. Anything more would
  -- put a person on a public endpoint.
  claimed boolean,
  member_count int,
  photos jsonb,
  links jsonb,
  hours jsonb,
  posts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.chat_id,
    b.city_id,
    b.name,
    b.category,
    b.description,
    b.place_label,
    b.address,
    b.hours_note,
    b.website_url,
    b.lat,
    b.lng,
    b.verified,
    b.owner_user_id is not null,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now()),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'storage_path', p.storage_path)
                       order by p.position)
      from public.business_photos p
      where p.business_id = b.id and p.moderation_status = 'approved'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'label', l.label,
                                          'value', l.value) order by l.position, l.created_at)
      from public.business_links l where l.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens,
                                          'closes', h.closes) order by h.weekday, h.position)
      from public.business_hours h where h.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'title', po.title, 'body', po.body,
                                          'photo_path', po.photo_path,
                                          'happens_at', po.happens_at, 'ends_at', po.ends_at)
                       order by po.happens_at nulls last, po.created_at desc)
      from public.business_posts po
      where po.business_id = b.id and po.archived_at is null
    ), '[]'::jsonb)
  from public.businesses b
  where b.id = p_business_id
    and (public.is_visible_business(b.id) or public.owns_business(b.id))
$$;

grant execute on function public.business_detail(uuid) to anon, authenticated;

comment on function public.business_detail(uuid) is
  'One place''s page in a single call. `claimed` says whether anybody runs it '
  'here, so a traveler is not offered Message on a venue where '
  'message_business would refuse them after they had typed.';
