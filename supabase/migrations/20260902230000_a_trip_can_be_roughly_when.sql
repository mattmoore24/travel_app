-- A trip can be roughly when
-- ===========================================================================
--
-- The app asks for a precision it will not get. "Bangkok, probably most of
-- September" is how open-ended travel is actually planned, and today it is
-- not expressible: the calendar wants two taps on two specific days and Post
-- trip stays off until both land. A traveler who does not know either posts
-- nothing (and Travelers then says "Add a trip first" forever) or posts a
-- guess and never corrects it, which quietly corrupts the overlap query for
-- everybody matched against them.
--
-- So `trips.approximate` marks a window that is a guess. The DATES stay
-- exactly what they are today - a real start and a real end, the widest
-- plausible range the traveler stands behind, still under the 365-day check
-- on the table - and the flag is the fact that they are not a claim.
--
-- WHAT EACH READER OF start_date/end_date DOES WITH A ROUGH ONE.
--
-- Every one of these was read before this column was added, because a rough
-- trip must not become a way around anything the exact dates gate.
--
--   traveler_trips(uuid) - the plans on somebody's profile. CARRIES the flag,
--     which is the whole point: the profile is where a reader decides whether
--     to believe the dates, so the card says "Around Sep 1 - 30" rather than
--     printing a guess as a fact. That is the OUT column added below.
--
--   push_trip_starts_tomorrow() - "Lisbon tomorrow". EXCLUDED below. A rough
--     window whose first day happens to be tomorrow does not mean the person
--     lands tomorrow; the app would be stating a fact nobody entered. This is
--     not a ranking question with two defensible answers, it is a sentence
--     that would be false, so the honest move is to leave the trip out of the
--     answer rather than guess a date for it. Its population count excludes
--     rough trips for the same reason - that number goes out under the
--     heat-k rule (hard rule 6), and a disclosed population must not be
--     inflated by windows nobody committed to. Excluding can only make the
--     number smaller, which is the safe direction for a k-threshold.
--
--   get_matches(), overlaps_own_trip(), the trips_select_overlap policy and
--     featured_traveler() - UNTOUCHED, deliberately, and this is the open
--     question rather than an oversight. Whether a rough trip counts for
--     matching at full weight, is de-ranked, or is excluded from the overlap
--     query entirely is a recorded founder decision (docs/UX_PACKAGES.md,
--     prof-rough-trip-dates "Waits on"), and it decides how wide a rough
--     window's read access to other people's trips is. Until it is answered
--     nothing here changes: the column ships defaulted false, so every
--     existing row and every trip posted by today's client behaves exactly
--     as it does now.
--
--   admin_liquidity - untouched. An admin view, no user-facing claim.
--
-- THE ALTER GOES ABOVE THE DROP, and that is the opposite of
-- 20260902150000's ordering on purpose. Both files end in "drop X; create X",
-- and if the create fails X is missing either way. What the ordering decides
-- is what happens when the OTHER statement fails: with the alter first, a
-- refused alter leaves traveler_trips intact, and with the alter second a
-- refused alter leaves it dropped. There the object was a view whose own
-- rewrite was the risky half; here the risky half is a column added to a
-- table five triggers fire on.

alter table public.trips
  add column if not exists approximate boolean not null default false;

comment on column public.trips.approximate is
  'The window is a guess, not a claim: "roughly September" rather than Sep 8 '
  'to 15. The dates are still real dates and still bounded by the 365-day '
  'check - the client stores the widest range the traveler stands behind - '
  'so everything that arithmetic on them keeps working. Anything that would '
  'state one of those dates as a FACT to another person has to consult this '
  'first.';

-- trips carries COLUMN-level update grants (20260816200000:313) so a client
-- can move dates and cancel but not rewrite user_id. A new column is not in
-- that list, so without this line the editor could insert a rough trip and
-- never be able to correct it back to exact - the write half works and the
-- edit half dies with permission denied.
--
-- SELECT and INSERT on trips are table-level, so `select('*, cities(*)')`
-- (src/features/trips/api.ts:22) and the insert's read-back keep working; the
-- `add column` revokes `select *` only where the SELECT grant is itself
-- column-listed, which trips' is not.
grant update (approximate) on public.trips to authenticated;

-- ---------------------------------------------------------------------------
-- The flag reaches the profile
-- ---------------------------------------------------------------------------
--
-- Adding an OUT column to a `RETURNS TABLE` function needs `drop function`
-- first: `create or replace` is refused, and refused AFTER the statements
-- above have already applied (AGENTS.md, and the traps skill). The drop takes
-- the grants with it, so both lines are restated below.
--
-- Body otherwise VERBATIM from its current definition,
-- 20260830000000_a_business_is_served_no_travelers.sql:142 - the date
-- arithmetic, the day of slack, the business predicate and the block/
-- discoverability pair are all untouched. The only change is the last
-- selected column.
drop function if exists public.traveler_trips(uuid);

create function public.traveler_trips(p_user_id uuid)
returns table (
  trip_id uuid,
  city_id int,
  city_name text,
  city_country text,
  start_date date,
  end_date date,
  approximate boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, c.id, c.name, c.country_name, t.start_date, t.end_date, t.approximate
  from public.trips t
  join public.cities c on c.id = t.city_id
  where t.user_id = p_user_id
    and t.status = 'active'
    and t.end_date >= current_date - 1
    and auth.uid() is not null
    and not public.viewer_is_business()
    and (
      p_user_id = auth.uid()
      or (public.is_discoverable_owner(p_user_id) and not public.is_blocked_pair(p_user_id))
    )
  order by t.start_date
$$;

-- Both lines, not just the revoke the earlier migrations carried. The revoke
-- is what has always been written here; the grant makes explicit what the
-- schema's default privileges have been supplying silently, so a re-create
-- can never be the thing that quietly takes the profile's travel plans away.
revoke execute on function public.traveler_trips(uuid) from public, anon;
grant execute on function public.traveler_trips(uuid) to authenticated;

comment on function public.traveler_trips(uuid) is
  'Every upcoming trip on one traveler''s profile, with the city and whether '
  'the window is a guess. Gated the same way it was before the column: '
  'signed in, not a business account, and either your own plans or a '
  'discoverable, unblocked traveler''s.';

-- ---------------------------------------------------------------------------
-- "Lisbon tomorrow" stops claiming a day nobody entered
-- ---------------------------------------------------------------------------
--
-- Restated VERBATIM from 20260902040000_three_clocks_inside_a_trip.sql:110
-- with two predicates added and nothing else touched: the recipient's own
-- trip must not be approximate, and the overlap count skips approximate
-- trips. Same signature, so `create or replace` is correct here and no grant
-- is disturbed (the function is executable by nobody but the cron owner).

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
    -- least this city's heat_k; below that the push is identical minus the
    -- disclosure. Never a smaller number, never "a few": either the count
    -- clears the floor or the sentence does not mention population at all.
    case
      when overlap.n >= lc.heat_k
        then overlap.n || ' travelers are there on your dates.'
      else 'Your trip starts tomorrow. See who else has the same dates.'
    end,
    jsonb_build_object('type', 'trip', 'city_id', c.id)
  from public.trips t
  join public.cities c on c.id = t.city_id
  join public.launch_cities lc on lc.city_id = c.id and lc.active
  left join public.notification_prefs np on np.user_id = t.user_id
  cross join lateral (
    select count(distinct th.user_id)::int as n
    from public.trips th
    where th.city_id = t.city_id
      and th.user_id <> t.user_id
      and th.status = 'active'
      -- A rough window is not a person on your dates. The count goes out
      -- under the heat-k floor, and a population disclosed to somebody is
      -- not allowed to be padded with windows nobody committed to.
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
    -- The city's REAL clock, not a guess from its longitude. launch_cities
    -- carries an IANA timezone with a validating check
    -- (20260831160000_launch_cities_know_their_clock.sql), added for exactly
    -- this job: round(lng/15) puts Bangkok an hour out and ignores daylight
    -- saving entirely, so "18:00 the night before" drifted by an hour twice a
    -- year in Lisbon and Mexico City. A push aimed at the evening is allowed
    -- to be approximate; one aimed at a date boundary is not.
    and extract(hour from (p_now at time zone lc.timezone)) = 18
    and t.start_date = (p_now at time zone lc.timezone)::date + 1
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
