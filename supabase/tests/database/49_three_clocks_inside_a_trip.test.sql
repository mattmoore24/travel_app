-- Three clocks inside a trip, and the two rules they are not allowed to bend.
--
-- These are the first pushes this app sends that nobody typed. That buys two
-- obligations, and most of this file is about them rather than about whether
-- the clocks fire.
--
--   THE HEAT-K RULE IS A RULE ABOUT DISCLOSURE, not about pixels. Hard rule 6
--   says a heat cell below the city's k-threshold is never drawn. "14
--   travelers are there on your dates" is the same disclosure written out, so
--   it is written as an ATTACK below: stand a city under its own threshold
--   and prove the number cannot get out. A push must never disclose a city
--   population the map itself would refuse to render.
--
--   AN OPT-OUT FROM A DIGEST MUST NEVER SILENCE A CONVERSATION. notification_
--   prefs.trip_clocks switches these three off. If a chat push ever learned to
--   consult it, somebody who turned off a reminder would stop hearing that a
--   person answered them, and would never find out. That is a much worse bug
--   than the one this package fixes, so it is asserted rather than reasoned
--   about.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'clock-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'clock-bob@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'clock-cara@example.com'),
  ('00000000-0000-0000-0000-0000000000f4', 'clock-dave@example.com'),
  ('00000000-0000-0000-0000-0000000000f5', 'clock-eve@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'clock-finn@example.com'),
  ('00000000-0000-0000-0000-0000000000f7', 'clock-gina@example.com');

update public.profiles set
  display_name = 'traveler', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now();

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

create function pg_temp.lng() returns double precision language sql as
  $$ select lng from public.cities where id = pg_temp.lisbon() $$;

-- A real instant at which the CITY's wall clock reads d at hour h.
--
-- Through launch_cities.timezone, the same IANA name the clocks themselves now
-- use. This helper used to mirror a round(lng/15) approximation on the
-- grounds that the test should speak whatever the code speaks; that stopped
-- being a virtue the moment the code started speaking the real zone, and a
-- test that reproduces an approximation is a test that cannot notice it is
-- wrong. Postgres does the daylight-saving arithmetic here, which is the
-- whole point of storing the zone.
create function pg_temp.city_zone() returns text language sql as
  $$ select timezone from public.launch_cities where city_id = pg_temp.lisbon() $$;

create function pg_temp.at_local(d date, h int) returns timestamptz language sql as $$
  select (d + make_interval(hours => h)) at time zone pg_temp.city_zone()
$$;

create function pg_temp.trip_pushes(uid uuid) returns int language sql as $$
  select count(*)::int from public.push_queue
   where user_id = uid and data ->> 'type' = 'trip'
$$;

-- Alice's trip starts in five days. Bob's is already running, so he overlaps
-- her without being eligible for a clock of his own: exactly the "one row per
-- eligible user and none for an ineligible one" shape.
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.lisbon(),
   current_date + 5, current_date + 15),
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.lisbon(),
   current_date + 1, current_date + 20);

-- ---------------------------------------------------------------------------
-- THE ATTACK ON THE K RULE
-- ---------------------------------------------------------------------------
--
-- One other traveler overlaps her, and Lisbon's heat_k is 3. The map would
-- refuse to draw that cell. The push must refuse to say the number.

select is(
  public.push_trip_starts_tomorrow(pg_temp.at_local(current_date + 4, 18)),
  1,
  'the evening before a trip, its owner gets exactly one push'
);
select is(
  pg_temp.trip_pushes('00000000-0000-0000-0000-0000000000f2'),
  0,
  'and a traveler whose trip is not starting tomorrow gets none'
);
-- Not "does not contain the count" - contains NO DIGIT AT ALL. A body that
-- said "1 traveler" or "a couple" would pass a narrower assertion and still
-- be the disclosure the k-threshold exists to refuse.
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'
      and data ->> 'type' = 'trip'
      and body ~ '[0-9]'),
  0,
  'below the city''s heat_k the push carries no population number at all'
);

-- Now clear the threshold: two more travelers overlapping her window makes
-- three, which is Lisbon's k.
delete from public.push_queue;
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.lisbon(),
   current_date + 2, current_date + 20),
  ('00000000-0000-0000-0000-0000000000f4', pg_temp.lisbon(),
   current_date + 3, current_date + 20);

select is(
  public.push_trip_starts_tomorrow(pg_temp.at_local(current_date + 4, 18)),
  1,
  'at the threshold the push still goes out once'
);
select is(
  (select body from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'
      and data ->> 'type' = 'trip'),
  '3 travelers are there on your dates.',
  'and only now does it carry the count'
);

-- A trip starting the day AFTER tomorrow is not tomorrow's business.
delete from public.push_queue;
select is(
  public.push_trip_starts_tomorrow(pg_temp.at_local(current_date + 3, 18)),
  0,
  'a trip starting the day after tomorrow queues nothing'
);

-- ---------------------------------------------------------------------------
-- THE OPT-OUT, AND THE CONVERSATION IT MUST NOT TOUCH
-- ---------------------------------------------------------------------------

-- Eve says hi to Alice and Alice accepts, so there is a real conversation to
-- interrupt later.
select pg_temp.login('00000000-0000-0000-0000-0000000000f5');
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f5', pg_temp.lisbon(),
   current_date + 5, current_date + 15);
select public.send_message_request('00000000-0000-0000-0000-0000000000f1', 'trip_match',
  'Both in Lisbon the same week. Which market is worth the walk?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.respond_to_message_request(
  (select id from public.incoming_requests()
    where sender_id = '00000000-0000-0000-0000-0000000000f5'),
  true);

-- Alice switches the clocks off.
insert into public.notification_prefs (user_id, trip_clocks)
  values ('00000000-0000-0000-0000-0000000000f1', false);

select pg_temp.admin();
delete from public.push_queue;
select is(
  pg_temp.trip_pushes('00000000-0000-0000-0000-0000000000f1'),
  0,
  'nothing queued yet'
);
-- Eve's trip starts the same day and she has left the clocks on, which is
-- what makes this two assertions rather than one: the switch has to be hers
-- alone, not a global kill switch that happens to be off for everybody.
select public.push_trip_starts_tomorrow(pg_temp.at_local(current_date + 4, 18));
select is(
  pg_temp.trip_pushes('00000000-0000-0000-0000-0000000000f1'),
  0,
  'with trip_clocks off, the clock says nothing to her'
);
select is(
  pg_temp.trip_pushes('00000000-0000-0000-0000-0000000000f5'),
  1,
  'while the traveler who left them on still hears her own'
);

-- THE INVARIANT. The same person, the same instant, an ordinary message.
create function pg_temp.alice_chat() returns uuid
language sql
security definer
as $$
  select chat_id from public.message_requests
   where recipient_id = '00000000-0000-0000-0000-0000000000f1'
     and sender_id = '00000000-0000-0000-0000-0000000000f5'
     and status = 'accepted'
$$;
select pg_temp.login('00000000-0000-0000-0000-0000000000f5');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.alice_chat(), '00000000-0000-0000-0000-0000000000f5',
          'Found the market, sending the spot', clock_timestamp());
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'
      and data ->> 'type' = 'message'),
  1,
  'and the reply she was actually waiting for still reaches her phone'
);

-- ---------------------------------------------------------------------------
-- THE PLAN CLOCKS
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f6');
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f6', pg_temp.lisbon(),
   current_date - 1, current_date + 5);
-- Two plans tonight: one somebody joins, one nobody does.
-- intent_date is today in the CITY's clock, which at 15:00 local is simply
-- current_date; city_local itself is service-role only, so the test cannot
-- call it while it is somebody.
select public.post_joinable_pin(
  pg_temp.lisbon(), 'Park Bar', null, 'Rua Nova 1', 'bar', 38.71, -9.14,
  current_date,
  pg_temp.at_local(current_date, 15) + interval '20 hours', 'Sunset drinks');
select public.post_joinable_pin(
  pg_temp.lisbon(), 'Quiet Cafe', null, 'Rua Velha 2', 'restaurant',
  38.72, -9.15,
  current_date,
  pg_temp.at_local(current_date, 15) + interval '20 hours', 'Coffee and a book');

select pg_temp.admin();
create function pg_temp.pin_of(venue text) returns uuid
language sql
security definer
as $$ select id from public.pins where venue_name = venue $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000f7');
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f7', pg_temp.lisbon(),
   current_date - 1, current_date + 5);
select public.join_pin_chat(pg_temp.pin_of('Park Bar'));

select pg_temp.admin();
delete from public.push_queue;
select is(
  public.push_plan_is_soon(pg_temp.at_local(current_date, 15)),
  2,
  'the plan that somebody joined pings everybody in it, and only them'
);
select is(
  (select distinct body from public.push_queue
    where data ->> 'clock' = 'plan_soon'),
  'Happening today. 2 people are in.',
  'and it says how many are in, without inventing an hour the pin never had'
);

-- ---------------------------------------------------------------------------
-- LAST CALL
-- ---------------------------------------------------------------------------

delete from public.push_queue;
select is(
  public.push_last_call(
    (select expires_at from public.pins where venue_name = 'Park Bar')
      - interval '3 hours 30 minutes'),
  2,
  'four hours out, last call reaches everybody in the plan'
);
select is(
  (select count(*)::int from public.push_queue
    where data ->> 'clock' = 'last_call'
      and data ->> 'chat_id' = (select chat_id::text from public.groups
                                 where pin_id = pg_temp.pin_of('Quiet Cafe'))),
  0,
  'and never for a plan nobody joined: a push whose content is that you failed'
);

-- Inside the 72 hour ceiling BY CONSTRUCTION, asserted rather than assumed:
-- the clock reads pins.expires_at, which carries the hard-rule-3 CHECK, so
-- there is no instant at which it can ping about a pin that has outlived it.
delete from public.push_queue;
select is(
  public.push_last_call(
    (select expires_at from public.pins where venue_name = 'Park Bar')
      + interval '1 hour'),
  0,
  'and nothing at all once the pin it is about has expired'
);

select * from finish();
rollback;
