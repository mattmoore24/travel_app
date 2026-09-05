-- A trip can be roughly when, and the two things a guess is not allowed to buy.
--
-- The column itself is boring. What is not boring is that a rough window is
-- the widest range its owner will stand behind, so anything that reads
-- trips.start_date/end_date and STATES one of those days to another person is
-- now repeating a number nobody entered.
--
--   THE MIGRATION IS THE DANGEROUS HALF, twice over. `add column` on a table
--   with column-level grants is what broke the business photo grid for three
--   e2e runs (31_select_star_stays_readable), and `create or replace` cannot
--   add an OUT column to a RETURNS TABLE signature - it fails AFTER the
--   earlier statements applied, and the drop that fixes it takes the grants
--   with it. Assertions 2, 4, 5, 7, 8 and 9 are those two traps: the star
--   read, the column-level update, the insert a real client makes, and
--   traveler_trips still being callable by a traveler, still refusing an
--   undiscoverable owner, and still closed to anon.
--
--   A PUSH MAY NOT INVENT A TRAVEL DATE. "Lisbon tomorrow" the evening before
--   a rough window's first day is a fact its owner never entered. Assertions
--   10 and 11 are the exclusion with its control, because an exclusion
--   asserted alone passes just as well when the clock is broken. Assertions
--   12 and 13 are the same rule applied to the population number, which goes
--   out under the heat-k floor (hard rule 6): padding it with windows nobody
--   committed to would disclose a city population the map itself would
--   refuse to draw.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'rough-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'rough-bob@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'rough-cara@example.com'),
  ('00000000-0000-0000-0000-0000000000e4', 'rough-dave@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'rough-eve@example.com'),
  ('00000000-0000-0000-0000-0000000000e6', 'rough-finn@example.com');

-- Everybody but Finn finishes onboarding, so Finn is the undiscoverable owner
-- traveler_trips has to keep refusing after the drop-and-recreate.
update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id <> '00000000-0000-0000-0000-0000000000e6';

-- Created before the first login: a function created while the session is
-- `set role authenticated` is owned by that role. The helpers are functions
-- and not temp tables for the reason the traps skill gives - `pg_temp` has no
-- privileges at all once the suite switches roles.
create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.city_zone() returns text language sql as
  $$ select timezone from public.launch_cities where city_id = pg_temp.lisbon() $$;

-- A real instant at which Lisbon's wall clock reads d at hour h. The same
-- helper 49_three_clocks uses, and for its reason: the clocks read an IANA
-- zone now, so a test that reproduced a longitude approximation could not
-- notice it was wrong.
create function pg_temp.at_local(d date, h int) returns timestamptz language sql as $$
  select (d + make_interval(hours => h)) at time zone pg_temp.city_zone()
$$;

create function pg_temp.trip_pushes(uid uuid) returns int language sql as $$
  select count(*)::int from public.push_queue
   where user_id = uid and data ->> 'type' = 'trip'
$$;

-- Alice's plans, and Finn's. Written as postgres so the fixtures are not
-- themselves under test; the RLS write path has 04_trips_matching_rls.
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000e1', pg_temp.lisbon(),
   current_date + 20, current_date + 30),
  ('00000000-0000-0000-0000-0000000000e6', pg_temp.lisbon(),
   current_date + 20, current_date + 30);

-- ---------------------------------------------------------------------------
-- The column, and the two grant traps that come with adding one
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');

select is(
  (select approximate from public.trips
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  false,
  'a trip posted the way the shipped client posts one is not approximate'
);

-- The add-column trap. src/features/trips/api.ts reads trips with
-- `select('*, cities(*)')` and reads its insert back the same way, so a
-- column-listed SELECT grant here would have turned every trip list into an
-- empty state indistinguishable from having no trips.
select lives_ok(
  $$ select * from public.trips limit 1 $$,
  'select * still works on trips after the new column'
);

-- The check lives on the table, not in the client: the widest range a rough
-- month can produce still has to fit inside a year.
select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date, approximate)
     values ('00000000-0000-0000-0000-0000000000e1', 1,
             current_date + 10, current_date + 400, true) $$,
  '23514',
  null,
  'an approximate trip cannot outrun the 365-day check either'
);

-- The column-level update grant. Without `grant update (approximate)` a
-- traveler could post a rough trip and never correct it: the insert lands and
-- the edit dies with permission denied.
select lives_ok(
  $$ update public.trips set approximate = true
      where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'the owner can mark their own trip approximate'
);
-- Both directions, because only one of them was ever asserted and the
-- description claimed both. Going back to exact is the whole point of the
-- nudge on the profile: somebody who guessed September and then booked flights
-- has to be able to say so.
select lives_ok(
  $$ update public.trips set approximate = false
      where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'and can take it off again once the dates are real'
);
select is(
  (select approximate from public.trips
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  false,
  'and the row says so afterwards, so the grant covered the write'
);
-- Put it back: every assertion below reads e1 as the rough trip.
update public.trips set approximate = true
 where user_id = '00000000-0000-0000-0000-0000000000e1';

-- The WRITE half, as the client makes it. src/features/trips/api.ts names its
-- insert columns, so a column-level INSERT grant on trips would refuse this
-- one and only this one: the rough tab in add-trip.tsx and the TripEditor
-- sheet would be a control that cannot save, while every exact trip carried
-- on working. INSERT on trips is table-level today and this is the assertion
-- that notices if that ever stops being true.
select lives_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date, approximate)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.lisbon(),
             current_date + 60, current_date + 89, true) $$,
  'a traveler can post a rough trip, not only edit one into being rough'
);
-- Straight back out, so every count and date below is arithmetic on the same
-- fixtures it was written against.
delete from public.trips
  where user_id = '00000000-0000-0000-0000-0000000000e1'
    and start_date = current_date + 60;

-- ---------------------------------------------------------------------------
-- The flag reaches the profile, and the gate is still the gate
-- ---------------------------------------------------------------------------

select is(
  (select approximate from public.traveler_trips('00000000-0000-0000-0000-0000000000e1')),
  true,
  'traveler_trips carries the flag, so a profile can say around instead of a date'
);

-- Bob has no relationship with Alice and needs none: she is discoverable and
-- unblocked, which is all this function has ever asked.
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is(
  (select count(*)::int from public.traveler_trips('00000000-0000-0000-0000-0000000000e1')),
  1,
  'another signed-in traveler still reads a discoverable traveler''s plans'
);

-- Finn never finished onboarding. This is the assertion that catches a lost
-- re-grant or a definer flag dropped in the re-create: it can only pass if
-- the function is both callable and still refusing.
select is(
  (select count(*)::int from public.traveler_trips('00000000-0000-0000-0000-0000000000e6')),
  0,
  'and still refuses an owner who is not discoverable'
);

set local role anon;
select throws_ok(
  $$ select * from public.traveler_trips('00000000-0000-0000-0000-0000000000e1') $$,
  '42501',
  null,
  'anon still cannot execute traveler_trips after the drop'
);
select pg_temp.admin();

-- ---------------------------------------------------------------------------
-- "Lisbon tomorrow" stops claiming a day nobody entered
-- ---------------------------------------------------------------------------
--
-- Alice's window is rough and opens tomorrow. Bob's is exact and opens
-- tomorrow. One push goes out, and it is Bob's.

update public.trips set start_date = current_date + 1, end_date = current_date + 11
  where user_id = '00000000-0000-0000-0000-0000000000e1';
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000e2', pg_temp.lisbon(),
   current_date + 1, current_date + 11);

select is(
  public.push_trip_starts_tomorrow(pg_temp.at_local(current_date, 18)),
  1,
  'the evening before, exactly one of the two travelers is told'
);
select is(
  pg_temp.trip_pushes('00000000-0000-0000-0000-0000000000e1'),
  0,
  'and it is not the one whose window is a guess'
);

-- ---------------------------------------------------------------------------
-- The population number is a disclosure, so a guess cannot pad it
-- ---------------------------------------------------------------------------
--
-- Lisbon's heat_k is 3. Bob gets two exact overlappers and one rough one. If
-- the rough window counted, the sentence would clear the floor and name a
-- number the map would refuse to draw.

delete from public.push_queue;
update public.trips set start_date = current_date + 40, end_date = current_date + 50
  where user_id = '00000000-0000-0000-0000-0000000000e1';
insert into public.trips (user_id, city_id, start_date, end_date, approximate) values
  ('00000000-0000-0000-0000-0000000000e3', pg_temp.lisbon(),
   current_date + 2, current_date + 9, false),
  ('00000000-0000-0000-0000-0000000000e4', pg_temp.lisbon(),
   current_date + 2, current_date + 9, false),
  ('00000000-0000-0000-0000-0000000000e5', pg_temp.lisbon(),
   current_date + 2, current_date + 9, true);

select is(
  public.push_trip_starts_tomorrow(pg_temp.at_local(current_date, 18)),
  1,
  'the push still goes out for the exact trip'
);
-- Not "does not say 3" - contains NO DIGIT AT ALL, the shape 49_three_clocks
-- asserts, because "a couple" would pass a narrower test and still be the
-- disclosure the threshold exists to refuse.
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000e2'
      and data ->> 'type' = 'trip'
      and body ~ '[0-9]'),
  0,
  'two exact overlappers and a rough one is two, so no number gets out'
);

select * from finish();
rollback;
