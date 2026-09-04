-- A pin goes where the traveler goes (20260904110000, 20260904110100,
-- 20260904120000).
--
-- The founder dropped a pin in Manhattan while the Bangkok chip was lit and
-- was told "Could not save". Every assertion below is that pin, or one of the
-- things that had to move so it could land: the city it resolves to, the
-- circle the map reads, the rail that names cities by their plans, the
-- optional time that can be a range or TBD, the clock every city now has,
-- and the Travelers radius that puts Cannes on a Nice traveler's queue.
--
-- Rule 2 is asserted directly: get_matches() takes no argument at all, so no
-- device coordinate can ever reach it.
begin;
select plan(56);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- pg_temp FUNCTIONS, not a fixture table (the traps skill: an authenticated
-- role has no privileges on pg_temp tables). Looked up by name and country,
-- never by a hardcoded GeoNames id.
create function pg_temp.city(p_name text, p_country text) returns int language sql as
  $$ select id from public.cities where name = p_name and country_code = p_country
     order by population desc limit 1 $$;
create function pg_temp.lisbon() returns int language sql as $$ select pg_temp.city('Lisbon', 'PT') $$;
create function pg_temp.bangkok() returns int language sql as $$ select pg_temp.city('Bangkok', 'TH') $$;
create function pg_temp.nyc() returns int language sql as $$ select pg_temp.city('New York City', 'US') $$;
create function pg_temp.hoboken() returns int language sql as $$ select pg_temp.city('Hoboken', 'US') $$;
create function pg_temp.nice() returns int language sql as $$ select pg_temp.city('Nice', 'FR') $$;
create function pg_temp.cannes() returns int language sql as $$ select pg_temp.city('Cannes', 'FR') $$;
create function pg_temp.antibes() returns int language sql as $$ select pg_temp.city('Antibes', 'FR') $$;

select isnt(pg_temp.nyc(), null, 'the seed carries New York City');
select isnt(pg_temp.hoboken(), null, 'and Hoboken, which the 50k seed did not');
select is(
  (select count(*)::int from public.cities where timezone is null),
  0,
  'every seeded city knows its clock'
);

-- =============================================================================
-- THE MANHATTAN PIN
-- =============================================================================

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- The exact failure: the Bangkok chip was lit, the spot is Midtown.
select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Midtown', p_note => null, p_place_label => null,
      p_category => 'bar', p_lat => 40.754, p_lng => -73.984,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Drinks', p_joinable => false)
  $$, pg_temp.bangkok()),
  'a pin dropped in Manhattan while browsing Bangkok is saved'
);

select is(
  (select city_id from public.pins where venue_name = 'Midtown'),
  pg_temp.nyc(),
  'and it belongs to New York, not to Bangkok and not to Hoboken'
);

-- The answer says where it went, so the map can follow.
select is(
  ((select public.post_joinable_pin(
      p_city_id => pg_temp.bangkok(), p_venue_name => 'Chelsea', p_note => null,
      p_place_label => null, p_category => 'restaurant', p_lat => 40.746, p_lng => -74.001,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Lunch', p_joinable => false)) -> 'city' ->> 'name'),
  'New York City',
  'the write path answers with the city the pin resolved to'
);

-- Within a city's orbit the browsed city stands: Monaco is 13 km from Nice.
select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Casino square', p_note => null, p_place_label => null,
      p_category => 'bar', p_lat => 43.7384, p_lng => 7.4246,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Sunset', p_joinable => false)
  $$, pg_temp.nice()),
  'a pin in Monaco while browsing Nice is saved'
);
select is(
  (select city_id from public.pins where venue_name = 'Casino square'),
  pg_temp.nice(),
  'and keeps Nice as its city: 13 km is the same orbit'
);

-- Past the orbit the spot decides: Cannes is 26 km from Nice.
select public.post_joinable_pin(
  p_city_id => pg_temp.nice(), p_venue_name => 'La Croisette', p_note => null,
  p_place_label => null, p_category => 'beach', p_lat => 43.5528, p_lng => 7.0174,
  p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
  p_plan => 'Beach', p_joinable => false);
select is(
  (select city_id from public.pins where venue_name = 'La Croisette'),
  pg_temp.cannes(),
  'a pin on the Croisette while browsing Nice is in Cannes'
);

-- Nowhere near anywhere: the browsed city stands rather than a refusal.
select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Mid-Atlantic', p_note => null, p_place_label => null,
      p_category => 'other', p_lat => 30, p_lng => -40,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Sailing', p_joinable => false)
  $$, pg_temp.lisbon()),
  'a pin in the middle of the Atlantic is still saved'
);
select is(
  (select city_id from public.pins where venue_name = 'Mid-Atlantic'),
  pg_temp.lisbon(),
  'under the city that was being browsed, there being nothing nearer'
);

-- =============================================================================
-- THE MAP IS A CIRCLE
-- =============================================================================

select is(
  (select count(*)::int from public.city_pins(pg_temp.nyc()) where venue_name = 'Midtown'),
  1, 'the Manhattan pin is on the New York map'
);
select is(
  (select count(*)::int from public.city_pins(pg_temp.hoboken()) where venue_name = 'Midtown'),
  1, 'and on the Hoboken map: the map is a circle, the city_id a label'
);
select is(
  (select count(*)::int from public.city_pins(pg_temp.bangkok()) where venue_name = 'Midtown'),
  0, 'and not on the Bangkok map it was posted from'
);
select is(
  (select count(*)::int from public.city_pins(pg_temp.nice()) where venue_name = 'La Croisette'),
  1, 'the Cannes pin is on the Nice map, 26 km being inside the circle'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.city_pins(pg_temp.nyc()) where venue_name = 'Midtown'),
  1, 'another member sees it: the policy no longer asks whether the city is open'
);

select pg_temp.guest();
select is(
  (select count(*)::int from public.public_city_pins(pg_temp.nyc()) where venue_name = 'Midtown'),
  1, 'and so does a signed-out visitor, with no person attached'
);

-- =============================================================================
-- EVERY CITY HAS A CLOCK
-- =============================================================================

select is(public.city_clock_zone(pg_temp.nyc()), 'America/New_York',
  'New York reads its seeded zone');
select is(public.city_clock_zone(pg_temp.lisbon()), 'Europe/Lisbon',
  'Lisbon reads the launch row''s zone');

select pg_temp.admin();
select throws_ok(
  format($$ update public.cities set timezone = 'Mars/Olympus' where id = %s $$, pg_temp.nyc()),
  '23514', null,
  'a zone Postgres does not know is refused at the table'
);

-- =============================================================================
-- A TIME IS OPTIONAL, A RANGE, OR TBD
-- =============================================================================

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- A range that runs past midnight, inside a generous lifetime.
select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Late bar', p_note => null, p_place_label => null,
      p_category => 'bar', p_lat => 40.73, p_lng => -73.99,
      p_intent_date => (now() at time zone 'America/New_York')::date,
      p_expires_at => now() + interval '60 hours',
      p_plan => 'Late one', p_intent_time => '22:00', p_intent_time_end => '02:00',
      p_joinable => false)
  $$, pg_temp.nyc()),
  'a plan from 22:00 to 02:00 is saved'
);
select is(
  (select intent_time_end::text from public.city_pins(pg_temp.nyc()) where venue_name = 'Late bar'),
  '02:00:00',
  'and the map feed carries the end of the window'
);

select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Whenever', p_note => null, p_place_label => null,
      p_category => 'other', p_lat => 40.73, p_lng => -73.98,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Ask me', p_time_tbd => true, p_joinable => false)
  $$, pg_temp.nyc()),
  'a plan whose time is TBD is saved'
);
select is(
  (select time_tbd from public.city_pins(pg_temp.nyc()) where venue_name = 'Whenever'),
  true,
  'and says so on the map'
);

select throws_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Both', p_note => null, p_place_label => null,
      p_category => 'other', p_lat => 40.73, p_lng => -73.98,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'Contradiction', p_intent_time => '19:00', p_time_tbd => true,
      p_joinable => false)
  $$, pg_temp.nyc()),
  '23514', null,
  'TBD and an hour together is refused: it is one answer or the other'
);

select throws_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Endless', p_note => null, p_place_label => null,
      p_category => 'other', p_lat => 40.73, p_lng => -73.98,
      p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
      p_plan => 'No start', p_intent_time_end => '23:00', p_joinable => false)
  $$, pg_temp.nyc()),
  '23514', null,
  'an end with no start is refused'
);

-- Rule 3, for a range: the START is inside the lifetime and the END is not.
-- Built from one instant so the assertion holds at every hour of the day,
-- midnight in New York included (an end past midnight reads as tomorrow).
create function pg_temp.start_ts() returns timestamptz language sql as
  $$ select date_trunc('hour', now()) + interval '2 hours' $$;
select throws_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Overrun', p_note => null, p_place_label => null,
      p_category => 'bar', p_lat => 40.73, p_lng => -73.98,
      p_intent_date => %L, p_expires_at => %L,
      p_plan => 'Too long', p_intent_time => %L, p_intent_time_end => %L,
      p_joinable => false)
  $$,
    pg_temp.nyc(),
    (pg_temp.start_ts() at time zone 'America/New_York')::date,
    pg_temp.start_ts() + interval '1 hour',
    (pg_temp.start_ts() at time zone 'America/New_York')::time,
    ((pg_temp.start_ts() + interval '3 hours') at time zone 'America/New_York')::time),
  '23514', null,
  'a window that runs past the pin''s expiry is refused like a single hour is'
);
select lives_ok(
  format($$
    select public.post_joinable_pin(
      p_city_id => %s, p_venue_name => 'Fits', p_note => null, p_place_label => null,
      p_category => 'bar', p_lat => 40.73, p_lng => -73.98,
      p_intent_date => %L, p_expires_at => %L,
      p_plan => 'Just fits', p_intent_time => %L, p_intent_time_end => %L,
      p_joinable => false)
  $$,
    pg_temp.nyc(),
    (pg_temp.start_ts() at time zone 'America/New_York')::date,
    pg_temp.start_ts() + interval '1 hour',
    (pg_temp.start_ts() at time zone 'America/New_York')::time,
    ((pg_temp.start_ts() + interval '30 minutes') at time zone 'America/New_York')::time),
  'and the same window ending inside the lifetime is saved'
);

-- =============================================================================
-- THE RAIL NAMES CITIES BY THEIR PLANS, NEVER BELOW K
-- =============================================================================

select is(
  (select count(*)::int from public.featured_cities() where featured),
  4,
  'the four launch cities are on the rail whatever their count'
);
-- Bob and Cara each put a plan on the same Midtown corner as Alice's.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.post_joinable_pin(
  p_city_id => pg_temp.nyc(), p_venue_name => 'Midtown too', p_note => null,
  p_place_label => null, p_category => 'bar', p_lat => 40.754, p_lng => -73.984,
  p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
  p_plan => 'Same corner', p_joinable => false);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select public.post_joinable_pin(
  p_city_id => pg_temp.nyc(), p_venue_name => 'Midtown three', p_note => null,
  p_place_label => null, p_category => 'bar', p_lat => 40.754, p_lng => -73.984,
  p_intent_date => current_date, p_expires_at => now() + interval '20 hours',
  p_plan => 'Same corner', p_joinable => false);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select city_id from public.featured_cities() limit 1),
  pg_temp.nyc(),
  'New York, with the most plans, leads the rail'
);
select is(
  (select featured from public.featured_cities() where city_id = pg_temp.nyc()),
  false,
  'as a city the plans put there, not one the founder did'
);
select is(
  (select pin_count from public.featured_cities() where city_id = pg_temp.nyc()),
  (select count(*)::int from public.city_pins(pg_temp.nyc())),
  'and its chip count is exactly what the map shows this caller'
);
select is(
  (select count(*)::int from public.featured_cities() where city_id = pg_temp.cannes()),
  0,
  'Cannes, with one plan, is not named: below k the rail says nothing'
);

select pg_temp.guest();
select is(
  (select city_id from public.public_featured_cities() limit 1),
  pg_temp.nyc(),
  'a signed-out visitor reads the same rail'
);

-- =============================================================================
-- HEAT FOR A CITY NOBODY OPENED
-- =============================================================================

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select pin_count from public.heat_cells(pg_temp.nyc())
    where cell_lat = floor(40.754 / 0.005) * 0.005 + 0.0025),
  3,
  'three people on one Midtown corner make a heat cell at the global k'
);
select pg_temp.guest();
select is(
  (select pin_count from public.public_heat_cells(pg_temp.nyc())
    where cell_lat = floor(40.754 / 0.005) * 0.005 + 0.0025),
  3,
  'which the guest map draws too'
);

-- The sweep remembers it. Expired by hand as postgres, which is the only
-- role that can write expires_at.
select pg_temp.admin();
update public.pins set expires_at = now() - interval '1 second'
  where lat = 40.754 and lng = -73.984;
select public.expire_pins();
select is(
  (select poster_count from public.heat_history where city_id = pg_temp.nyc() limit 1),
  3,
  'and expire_pins records a bucket for a city that is not a launch city'
);

-- =============================================================================
-- WHAT IS GONE
-- =============================================================================

select hasnt_function('public', 'request_city', array['text'],
  'nobody has to ask for a city any more');
select hasnt_function('public', 'city_pin_counts', array[]::text[],
  'the launch-only chip count is gone');
select is(
  (select pronargs::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_matches'),
  0,
  'get_matches takes no argument: no coordinate can reach it (rule 2)'
);

-- =============================================================================
-- TRAVELERS WITHIN A RADIUS
-- =============================================================================
--
-- Alice in Nice. Bob in Cannes (26 km), Cara in Antibes (18 km), Dave in
-- Lisbon. All four on overlapping dates.

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000a', pg_temp.nice(), current_date + 3, current_date + 13);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000b', pg_temp.cannes(), current_date + 8, current_date + 18);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000c', pg_temp.antibes(), current_date + 5, current_date + 9);
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(), current_date + 3, current_date + 13);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select travelers_radius_km from public.profiles where user_id = auth.uid()),
  32,
  'the default reach is 32 km, about twenty miles'
);
select bag_eq(
  $$ select user_id from public.get_matches() $$,
  $$ values ('00000000-0000-0000-0000-00000000000b'::uuid),
            ('00000000-0000-0000-0000-00000000000c'::uuid) $$,
  'from Nice the queue reaches Cannes and Antibes, and not Lisbon'
);
select ok(
  (select distance_km between 20 and 32 from public.get_matches()
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  'and says how far Cannes is from Nice, centre to centre'
);
select is(
  (select my_city_name from public.get_matches()
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  'Nice',
  'and which of her own cities the overlap is measured from'
);
select is(
  (select count(*)::int from public.trips where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'the trip row itself is readable: the policy reaches as far as the queue'
);

-- Her own dial.
select lives_ok(
  $$ update public.profiles set travelers_radius_km = 0 where user_id = auth.uid() $$,
  'she can set it to this city only'
);
select is(
  (select count(*)::int from public.get_matches()), 0,
  'and then Cannes and Antibes are out of reach'
);
select is(
  (select count(*)::int from public.trips where user_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'the trip row with them'
);
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000b', 'trip_match', 'Hello from Nice, fancy a drink in Cannes?') $$,
  null, 'recipient unavailable',
  'and a hello to Cannes is refused with the same words as any other unreachable person'
);

update public.profiles set travelers_radius_km = 20 where user_id = auth.uid();
select bag_eq(
  $$ select user_id from public.get_matches() $$,
  $$ values ('00000000-0000-0000-0000-00000000000c'::uuid) $$,
  'at 20 km the queue reaches Antibes and not Cannes'
);

update public.profiles set travelers_radius_km = 32 where user_id = auth.uid();
select lives_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000b', 'trip_match', 'Hello from Nice, fancy a drink in Cannes?') $$,
  'back at 32 km the hello to Cannes goes through'
);

select throws_ok(
  $$ update public.profiles set travelers_radius_km = 501 where user_id = auth.uid() $$,
  '23514', null,
  'five hundred kilometres is the ceiling'
);

-- The card on Bob's side names both cities, within HIS reach.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select overlap_city || ' / ' || overlap_my_city from public.incoming_requests()),
  'Nice / Cannes',
  'the hello''s card says her city and his'
);
select is(
  (select overlap_start from public.incoming_requests()),
  current_date + 8,
  'over the window the two trips share'
);
update public.profiles set travelers_radius_km = 0 where user_id = auth.uid();
select is(
  (select overlap_city from public.incoming_requests()),
  null,
  'and with his reach at this city only the chip is simply absent'
);

-- Not hers to turn.
update public.profiles set travelers_radius_km = 500
  where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.admin();
select is(
  (select travelers_radius_km from public.profiles
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  32,
  'Bob turning Alice''s dial changes nothing'
);

select * from finish();
rollback;
