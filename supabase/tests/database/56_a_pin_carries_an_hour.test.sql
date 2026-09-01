-- 20260902190000, all four halves of it:
--
--   * a pin's optional hour, and the §7 rule 3 attack it opens — an hour late
--     on the last valid day, which the date-only check could not see;
--   * a pin naming a business, including the one that was deleted and the one
--     in the wrong city;
--   * the city rail's counts, written as the enumeration attack: a narrowed
--     viewer's chip must agree with that viewer's own map, exactly;
--   * the de-identified "usually busy" layer, where the whole test is rule 6.
--     A bucket that never cleared k live is never stored, a cell that was
--     busy on one day never becomes "usually", and the table itself is
--     asserted column by column so a later migration adding a user reference
--     fails here rather than in production.
begin;
select plan(45);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cass@example.com'),
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

-- A pg_temp FUNCTION rather than a fixture table: `set local role
-- authenticated` has no privileges on anything in pg_temp, so a temp table
-- dies on the first assertion that matters. See the traps skill.
create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

create function pg_temp.bangkok() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Bangkok' $$;

-- The CITY's calendar day, which is what intent_date means and what the
-- history reader asks about. Derived rather than assumed: Lisbon is an hour
-- ahead of UTC for half the year, and a test that used current_date would
-- flake for one hour a night all summer.
create function pg_temp.city_today() returns date language sql as
  $$ select (now() at time zone (
       select timezone from public.launch_cities where city_id = pg_temp.lisbon()
     ))::date $$;

-- =============================================================================
-- THE HOUR
-- =============================================================================

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, intent_time, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', %s, 'Time Out Market',
            'Sunset drinks', 'bar', 38.7067, -9.1459,
            current_date + 1, time '09:00', now() + interval '48 hours')
  $$, pg_temp.lisbon()),
  'a plan can carry an hour'
);

select lives_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', %s, 'Pensão Amor',
            'Fado, sometime', 'bar', 38.7071, -9.1458,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  'and a plan with no hour is still a plan'
);

-- THE RULE 3 ATTACK. The date check has a deliberately generous +2 day
-- window to absorb client-vs-UTC drift, so an 11pm plan on the last day it
-- admits sails through it while sitting hours past the pin's own expiry. The
-- hour is compared in the CITY's zone against expires_at exactly, so it does
-- not.
select throws_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, intent_time, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', %s, 'Musicbox Lisboa',
            'Late one', 'club', 38.7069, -9.1454,
            current_date + 2, time '23:00', now() + interval '30 hours')
  $$, pg_temp.lisbon()),
  '23514',
  null,
  'an hour that falls after the pin disappears is refused, however the date check reads'
);

select is(
  (select intent_time from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Time Out Market'),
  time '09:00',
  'city_pins returns the hour, grant intact after the drop'
);

select is(
  (select intent_time from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Pensão Amor'),
  null,
  'and null for a plan that never named one'
);

select pg_temp.guest();
select is(
  (select intent_time from public.public_city_pins(pg_temp.lisbon())
    where venue_name = 'Time Out Market'),
  time '09:00',
  'public_city_pins returns the hour to a guest, anon grant intact after the drop'
);

-- =============================================================================
-- THE BUSINESS
-- =============================================================================
--
-- Inserted directly rather than through register_business: that function
-- lists a business as 'unconfirmed', and the link is deliberately only ever
-- made to a listed one.

select pg_temp.admin();
insert into public.businesses (city_id, name, category, lat, lng, owner_user_id, state)
values
  (pg_temp.lisbon(), 'Park Rooftop Bar', 'bar', 38.7112, -9.1442,
   '00000000-0000-0000-0000-00000000000d', 'listed'),
  (pg_temp.bangkok(), 'Brick Bar', 'club', 13.7589, 100.4986, null, 'listed');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');

select lives_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000b', %s, 'Park Rooftop Bar',
            'Sunset', 'bar', 38.7112, -9.1442,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  'a plan can be dropped on a listed business'
);

select is(
  (select business_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Park Rooftop Bar'),
  (select id from public.businesses where name = 'Park Rooftop Bar'),
  'and the map feed says which business it is, so the venue line can open it'
);

select lives_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000b', %s, 'The bench outside',
            'Waiting there', 'other', 38.7112, -9.1442,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  'a plan at the same corner under another name is still a plan'
);

select is(
  (select business_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'The bench outside'),
  null,
  'and it names no business: the same coordinate is not the same place'
);

select throws_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, business_id, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000b', %s, 'Somewhere',
            'Nope', (select id from public.businesses where name = 'Brick Bar'),
            'bar', 38.7067, -9.1459,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  '23514',
  null,
  'a pin cannot name a business in another city'
);

-- Rule 8, on the one door a business account reads the map through. The
-- owner-facing "four travelers plan to come" is a §10 question with its own
-- threshold argument, and this package ships only the traveler half.
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (select business_id from public.public_city_pins(pg_temp.lisbon())
    where venue_name = 'Park Rooftop Bar'),
  null,
  'a business account is never handed the join between plans and its own listing'
);

select pg_temp.guest();
select is(
  (select business_id from public.public_city_pins(pg_temp.lisbon())
    where venue_name = 'Park Rooftop Bar'),
  (select id from public.businesses where name = 'Park Rooftop Bar'),
  'a guest is, because that is the tap into the business page'
);

-- ON DELETE SET NULL: a business that leaves takes its page, not the plans.
select pg_temp.admin();
delete from public.businesses where name = 'Park Rooftop Bar';
select is(
  (select count(*)::int from public.pins where venue_name = 'Park Rooftop Bar'),
  1,
  'deleting a business leaves the plans that named it standing'
);
select is(
  (select business_id from public.pins where venue_name = 'Park Rooftop Bar'),
  null,
  'with a null link rather than a dangling one'
);

-- =============================================================================
-- THE CITY RAIL
-- =============================================================================

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- A third plan of Alice's own, so the narrowed case below still clears k:
-- two nulls agreeing would prove nothing about whether the count follows
-- discovery_pair_ok. And one lonely plan in Bangkok, so the k floor has a 1
-- to refuse rather than a 0.
insert into public.pins
  (user_id, city_id, venue_name, plan, category, lat, lng, intent_date, expires_at)
values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Mercado da Ribeira',
   'Lunch', 'restaurant', 38.7067, -9.1455, current_date, now() + interval '20 hours'),
  ('00000000-0000-0000-0000-00000000000a', pg_temp.bangkok(), 'Yaowarat walk',
   'Street food', 'restaurant', 13.7398, 100.5091, current_date, now() + interval '20 hours');

select is(
  (select pin_count from public.city_pin_counts() where city_id = pg_temp.lisbon()),
  (select count(*)::int from public.city_pins(pg_temp.lisbon())),
  'the chip count is exactly what the map shows this caller'
);

select is(
  (select count(*)::int from public.city_pins(pg_temp.bangkok())),
  1,
  'Bangkok has exactly one plan on it for her'
);

select is(
  (select pin_count from public.city_pin_counts() where city_id = pg_temp.bangkok()),
  null,
  'and its chip says nothing rather than a 1: below k there is no number'
);

-- THE ENUMERATION ATTACK. Alice narrows to verified and nobody here is
-- verified, so her map empties of everybody else's plans. If the count were
-- computed by a definer that skipped discovery_pair_ok, the chip would keep
-- advertising them and anybody with the anon key could measure a city.
select pg_temp.admin();
update public.profiles set visible_to = 'verified'
  where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select is(
  (select pin_count from public.city_pin_counts() where city_id = pg_temp.lisbon()),
  (select count(*)::int from public.city_pins(pg_temp.lisbon())),
  'a narrowed viewer''s chip still agrees with a narrowed viewer''s map'
);

select is(
  (select pin_count from public.city_pin_counts() where city_id = pg_temp.lisbon()),
  3,
  'and that is her own three plans: the other two dropped off the chip with the map'
);

select pg_temp.admin();
update public.profiles set visible_to = 'everyone'
  where user_id = '00000000-0000-0000-0000-00000000000a';

-- The cities nobody has opened yet ------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$ select public.request_city('Chiang Mai') $$,
  'a traveler can ask for a city that is not open'
);

select throws_ok(
  $$ select public.request_city('X') $$,
  '23514',
  null,
  'and a name that is not a name is refused'
);

select throws_ok(
  $$ select city_name from public.city_requests $$,
  '42501',
  null,
  'nobody can read the requests back: this is a tally, not a list of who is going where'
);

select throws_ok(
  format($$
    insert into public.city_requests (user_id, city_name)
    values ('00000000-0000-0000-0000-00000000000b', 'Porto')
  $$),
  '42501',
  null,
  'and nobody can file one in somebody else''s name'
);

select pg_temp.guest();
select lives_ok(
  $$ select public.request_city('Porto') $$,
  'a signed-out visitor can ask too, which is the one most likely to leave'
);

select pg_temp.admin();
select is(
  (select user_id from public.city_requests where city_name = 'Porto'),
  null,
  'and is recorded as a city name and a timestamp, with no account attached'
);

-- =============================================================================
-- USUALLY BUSY
-- =============================================================================
--
-- Three cells: one with three distinct travelers, one with two, one with
-- three curated pins. Only the first has ever been a heat cell, and only the
-- first may ever become a history bucket.

select pg_temp.admin();
insert into public.pins
  (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at, seeded)
values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Cell A one', 'bar',
   38.7367, -9.1459, pg_temp.city_today(), now() + interval '1 hour', false),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), 'Cell A two', 'bar',
   38.7368, -9.1458, pg_temp.city_today(), now() + interval '1 hour', false),
  ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(), 'Cell A three', 'bar',
   38.7369, -9.1457, pg_temp.city_today(), now() + interval '1 hour', false),
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Cell B one', 'bar',
   38.7467, -9.1459, pg_temp.city_today(), now() + interval '1 hour', false),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), 'Cell B two', 'bar',
   38.7468, -9.1458, pg_temp.city_today(), now() + interval '1 hour', false),
  (null, pg_temp.lisbon(), 'Cell C one', 'bar',
   38.7567, -9.1459, pg_temp.city_today(), now() + interval '1 hour', true),
  (null, pg_temp.lisbon(), 'Cell C two', 'bar',
   38.7568, -9.1458, pg_temp.city_today(), now() + interval '1 hour', true),
  (null, pg_temp.lisbon(), 'Cell C three', 'bar',
   38.7569, -9.1457, pg_temp.city_today(), now() + interval '1 hour', true);

-- Pins are immutable to the app on purpose, so only the suite can age one.
update public.pins set expires_at = now() - interval '1 minute'
  where venue_name like 'Cell %';

select is(
  (select public.expire_pins()),
  8,
  'the sweep still deletes the pins it always deleted'
);

select is(
  (select poster_count from public.heat_history
    where cell_lat between 38.735 and 38.740),
  3,
  'a cell that cleared k live is remembered, as a count and nothing else'
);

select is_empty(
  $$ select 1 from public.heat_history where cell_lat between 38.745 and 38.750 $$,
  'a cell that never cleared k live is never written: the table cannot hold a 1 or a 2'
);

select is_empty(
  $$ select 1 from public.heat_history where cell_lat between 38.755 and 38.760 $$,
  'and three curated pins are three admin rows, not three people'
);

-- ONE BUSY DAY IS NOT A HABIT. The live threshold is inherited by every
-- stored bucket; this is the second, historical one, and it is the reason a
-- cell that was dense on a single evening cannot re-identify the people who
-- were on it.
select is_empty(
  format($$ select 1 from public.heat_history_cells(%s) $$, pg_temp.lisbon()),
  'one observation is not "usually busy", however dense that one day was'
);

insert into public.heat_history
  (city_id, cell_lat, cell_lng, weekday, hour_band, observed_on, poster_count)
select
  city_id, cell_lat, cell_lng, weekday, hour_band, observed_on - offset_days, poster_count
from public.heat_history, (values (7), (14)) as back(offset_days)
where cell_lat between 38.735 and 38.740;

select is(
  (select count(*)::int from public.heat_history_cells(pg_temp.lisbon())),
  1,
  'three separate days, each of which independently held k travelers, is'
);

-- Re-applied against the city's CURRENT k, not the one in force when the
-- bucket was written: raising the threshold has to hide the history too.
update public.launch_cities set heat_k = 4 where city_id = pg_temp.lisbon();
select is_empty(
  format($$ select 1 from public.heat_history_cells(%s) $$, pg_temp.lisbon()),
  'raising the city''s k retroactively hides every bucket that no longer clears it'
);
update public.launch_cities set heat_k = 3 where city_id = pg_temp.lisbon();

-- THE PRIVACY INVARIANT, written so a later migration fails here. Named
-- rather than counted: a count says the number is wrong, a name says which
-- column somebody added.
select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'heat_history'
        and column_name not in
          ('city_id', 'cell_lat', 'cell_lng', 'weekday', 'hour_band',
           'observed_on', 'poster_count')
      order by 1 $$,
  'heat_history holds a cell, a clock and a count, and nothing that is a person'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select poster_count from public.heat_history $$,
  '42501',
  null,
  'and no client reads the table directly: the k floors live in the function'
);

select lives_ok(
  format($$ select * from public.heat_history_cells(%s) $$, pg_temp.lisbon()),
  'the reader is the one door, and a member may use it'
);

select pg_temp.guest();
select lives_ok(
  format($$ select * from public.heat_history_cells(%s) $$, pg_temp.lisbon()),
  'so may a guest, or a quiet Tuesday says nothing to the people it is for'
);

-- =============================================================================
-- THE WRITE PATH
-- =============================================================================
--
-- The column is only worth having if the app can fill it, and pins are
-- immutable, so the hour has to ride the insert. Both shapes of pin go
-- through post_joinable_pin now (see the migration's section 7); these are
-- the assertions that say so.

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Park rooftop bar', null, null, 'bar',
      38.7112, -9.1442, current_date + 1, now() + interval '40 hours',
      'Sunset drinks', time '19:00', true)
  $$, pg_temp.lisbon()),
  'an open plan can be posted with an hour on it'
);

select is(
  (select intent_time from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Park rooftop bar'),
  time '19:00',
  'and the hour lands on the pin'
);

select isnt(
  (select chat_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Park rooftop bar'),
  null,
  'and it still opens the group that makes it joinable'
);

select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'A Tasca do Chico', null, null, 'other',
      38.7107, -9.1447, current_date + 1, now() + interval '40 hours',
      'Fado', time '21:30', false)
  $$, pg_temp.lisbon()),
  'and so can a message-me-first plan, which used to be a plain insert'
);

select is(
  (select chat_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'A Tasca do Chico'),
  null,
  'that one opens no group at all: p_joinable is the whole difference'
);

select is(
  (select intent_time from public.city_pins(pg_temp.lisbon())
    where venue_name = 'A Tasca do Chico'),
  time '21:30',
  'and it carries its hour too'
);

-- The same rule 3 refusal, through the other door. A validation that only
-- guards one of two write paths is not a validation.
select throws_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Musicbox Lisboa', null, null, 'club',
      38.7069, -9.1454, current_date + 2, now() + interval '30 hours',
      'Late one', time '23:00', true)
  $$, pg_temp.lisbon()),
  '23514',
  null,
  'an hour past the pin''s own expiry is refused here as well'
);

-- An over-the-air bundle lags a deploy, so the previous signature has to keep
-- working: both new parameters are trailing and defaulted.
select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Rambuttri Alley', null, null, 'restaurant',
      13.7599, 100.4972, current_date, now() + interval '24 hours', 'Dinner')
  $$, pg_temp.bangkok()),
  'the ten-argument call still works for a client on the previous bundle'
);

select * from finish();
rollback;
