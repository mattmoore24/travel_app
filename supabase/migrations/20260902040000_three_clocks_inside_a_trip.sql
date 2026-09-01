-- Three clocks inside a trip
-- ===========================================================================
--
-- Nothing in this app has ever brought anybody back. All thirteen scheduled
-- jobs are janitorial or content jobs and not one writes push_queue; every
-- push-writing function is a reaction to another person typing, or to
-- moderation. A traveler lands in Bangkok with a trip already posted and the
-- app does not mention it. A pin dies at midnight with two people in it and
-- nobody is told.
--
-- These three fire INSIDE a trip window, which is the retention metric the
-- brief actually names (PRODUCT_BRIEF.md:230), and each arrives at a moment
-- the app is about to be useful rather than as a reminder that it exists.
--
-- WHAT MAKES THEM ALLOWED. The primer promised "replies, hellos, and
-- anything about your account, nothing else, ever", and these are none of
-- those, so the promise is rewritten in the same bundle to name a fourth
-- kind before anybody is asked (src/features/notifications/push-primer.tsx).
-- The fourth kind is narrow on purpose: every one of these is about the
-- reader's OWN trip or their OWN plan. A push reporting somebody else's
-- activity is not covered by it and must not be added under it.
--
-- THE HEAT-K RULE APPLIES TO A SENTENCE. Hard rule 6 says a heat cell below
-- the city's k-threshold is never drawn. A push that says "14 travelers are
-- there on your dates" is the same disclosure in words, so the number is
-- carried only when it is at least launch_cities.heat_k for that city.
-- Below it the same push goes out with no number in it at all. A push must
-- never disclose a city population the map itself would refuse to render.

-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------

create table public.notification_prefs (
  user_id uuid primary key references public.users (id) on delete cascade,
  -- RESERVED, AND NOTHING READS IT. No screen offers this, and no push
  -- consults it: replies and account notices are not opt-out here, they are
  -- muted per conversation (chat_prefs.muted) or switched off at the OS. It
  -- exists so the table has room for the day that changes; until then,
  -- anybody wiring a toggle to it has to wire the push side too.
  chat boolean not null default true,
  -- The three clocks below, and only they. Default true: a person who
  -- turned notifications ON has said yes to the promise the primer makes,
  -- and the primer names these.
  trip_clocks boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- Scoped `to authenticated`, the way chat_prefs' are (20260817200000:112).
-- A policy with no role scope is evaluated for anon too, and the revoke below
-- is what actually stops it rather than the policy.
create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated using (user_id = auth.uid());
create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated with check (user_id = auth.uid());
create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- REVOKE FIRST. Supabase's hosted project grants default privileges on new
-- public tables to anon and authenticated, so a table that only ever GRANTS
-- is relying on RLS alone for a role that should not reach it at all. Every
-- other table in this schema does this on purpose: chat_prefs, app_config,
-- moderation_blocklist, apple_refresh_tokens.
revoke all on public.notification_prefs from public, anon;
revoke delete, truncate, references, trigger on public.notification_prefs from authenticated;
grant select, insert, update on public.notification_prefs to authenticated;

comment on table public.notification_prefs is
  'Per-account notification switches. Only trip_clocks is read by anything: '
  'the three within-trip clocks consult it and nothing else does. A chat '
  'push and an account notice must NEVER consult it, or an opt-out from a '
  'digest would silence a conversation.';

-- ---------------------------------------------------------------------------
-- The city's own clock, approximated from longitude
-- ---------------------------------------------------------------------------
--
-- The same approximation src/features/business/vocabulary.ts:cityNow already
-- ships for opening hours: local hour is UTC hour plus round(lng / 15).
-- It can be an hour out either side of a real timezone, which is acceptable
-- for an evening notification and would not be for a morning one - so every
-- clock below fires in the evening or on a relative offset, never at 08:00.

create or replace function public.city_local(p_at timestamptz, p_lng double precision)
returns timestamp
language sql
immutable
as $$
  select (p_at at time zone 'UTC') + make_interval(hours => round(p_lng / 15)::int)
$$;

revoke execute on function public.city_local(timestamptz, double precision)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Your trip starts tomorrow
-- ---------------------------------------------------------------------------
--
-- Fires at 18:00 in the CITY's evening, the day before the trip starts, so
-- it lands while somebody is still deciding what to do with the first day.
-- Hourly cron; the hour test is what makes it once, and the twenty-hour
-- dedupe below is what keeps a re-run or a manual invocation from making it
-- twice.
--
-- p_now is a parameter so the tests can stand at a chosen hour in a chosen
-- city. Nothing but a test ever passes it.

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

-- ---------------------------------------------------------------------------
-- 3. Your plan is soon
-- ---------------------------------------------------------------------------
--
-- A joinable pin whose day is today, about three hours before the city's
-- evening, and only when somebody else actually joined. It goes to everybody
-- in the plan, not only the host: a person who joined has a plan of their
-- own tonight, which is exactly what makes this notification about them.
--
-- No hour is claimed. pins carry a DATE and not a time (an optional hour is
-- its own package), so a body saying "at 8" would be an invention. It says
-- today, which is true, and the count, which is true.

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
  -- The same real clock the trip clock uses. A plan is a time of day in a
  -- city, so it is the one fact here that must not be approximated.
  join public.launch_cities lc on lc.city_id = c.id and lc.active
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
    and p.intent_date = (p_now at time zone lc.timezone)::date
    -- Three hours before an 18:00 evening, on the city's own clock.
    and extract(hour from (p_now at time zone lc.timezone)) = 15
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

-- ---------------------------------------------------------------------------
-- 4. Last call
-- ---------------------------------------------------------------------------
--
-- Four hours before the pin expires, and only when somebody joined. Never an
-- expiry ping for a plan nobody is in: that is a notification whose content
-- is that you failed.
--
-- It reads pins.expires_at, which carries a CHECK of created_at + 72 hours
-- (hard rule 3), so this is inside the ceiling by construction rather than
-- by a second number that could drift. The pgTAP asserts that rather than
-- assuming it.
--
-- This is also where the digest for a busy plan lives. notif-plan-join-is-felt
-- caps the host's join pushes at five so a popular plan cannot machine-gun a
-- phone; the count in this body is the CURRENT total, so the sixth and
-- fifteenth joiners are accounted for here rather than by a second timer
-- inside the join trigger.

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
    'Closing at ' || to_char(p.expires_at at time zone lc.timezone, 'HH24:MI')
      || '. ' || going.n || case when going.n = 1
      then ' person is in.' else ' people are in.' end,
    jsonb_build_object(
      'type', 'message', 'kind', 'room', 'chat_id', g.chat_id, 'clock', 'last_call')
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.cities c on c.id = p.city_id
  -- The same real clock the trip clock uses. A plan is a time of day in a
  -- city, so it is the one fact here that must not be approximated.
  join public.launch_cities lc on lc.city_id = c.id and lc.active
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

-- ---------------------------------------------------------------------------
-- 5. The schedules
-- ---------------------------------------------------------------------------
--
-- Hourly, all three, behind the same pg_cron availability guard every other
-- scheduler here uses (20260816210000:279): the local test cluster has no
-- pg_cron, and a migration that assumes one fails the suite rather than the
-- deploy. Hourly is not a frequency of sending - each function's own hour
-- test is what decides that; it is how often the clock is READ.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('trip-starts-tomorrow', '5 * * * *',
                          'select public.push_trip_starts_tomorrow()');
    perform cron.schedule('plan-is-soon', '10 * * * *',
                          'select public.push_plan_is_soon()');
    perform cron.schedule('last-call', '15 * * * *',
                          'select public.push_last_call()');
  end if;
end
$$;
