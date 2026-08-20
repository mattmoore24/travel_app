-- Corrections to 20260819210000_profile_first, found by review before the
-- client shipped against it. Three real problems:
--
--   1. trips_select_upcoming made every traveler's plans readable as a bulk
--      table scan. "Visible on a profile you are looking at" and "dump the
--      whole table" are not the same permission, and only the first is what
--      the product asked for.
--   2. get_matches returned the same trip once per overlapping trip of the
--      viewer's, so two of your own trips in one city duplicated everyone.
--   3. The 180-day matching horizon was inert: the RLS gate underneath it
--      (overlaps_own_trip) still cut off at 14 days, so get_matches could
--      not read the rows it was now willing to return.

-- 1. Profiles show trips through a gated call, not a readable table --------

drop policy if exists trips_select_upcoming on public.trips;

-- SECURITY DEFINER so a profile can list its own trips without opening the
-- table, and gated on exactly what the rest of the app gates on: a signed-in
-- viewer, a discoverable owner, no block either way. Past trips never leave.
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
    and t.end_date >= current_date
    and auth.uid() is not null
    and (
      p_user_id = auth.uid()
      or (public.is_discoverable_owner(p_user_id) and not public.is_blocked_pair(p_user_id))
    )
  order by t.start_date
$$;

revoke execute on function public.traveler_trips(uuid) from public, anon;

-- 2. One row per traveler trip -------------------------------------------

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
     and theirs.end_date >= current_date
    join public.profiles p on p.user_id = theirs.user_id
    join public.cities c on c.id = theirs.city_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date
      and greatest(mine.start_date, theirs.start_date) <= current_date + 180
    -- Earliest shared window wins when the viewer has two overlapping trips.
    order by theirs.id, greatest(mine.start_date, theirs.start_date)
  ) m
  order by m.overlap_start, m.their_start, m.trip_id
$$;

revoke execute on function public.get_matches() from public, anon;

-- 3. The gate underneath matching moves with it ---------------------------

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
      -- Same season-long horizon as get_matches and send_message_request,
      -- so all three agree about who is reachable.
      and greatest(start_date, p_start) <= current_date + 180
  )
$$;

revoke execute on function public.overlaps_own_trip(int, date, date) from public, anon;
