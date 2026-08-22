-- Pins: 72h hard expiry (rule 3), geofenced launch cities, immutability,
-- k-anonymous heatmap (rule 6), seeded pins, pin-source requests.
begin;
select plan(29);

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
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

select is(
  (select count(*)::int from public.launch_cities),
  4,
  'launch cities seeded (Lisbon, Mexico City, Bangkok, Denpasar)'
);

-- Create a pin near the Lisbon center (38.71667, -9.13333).
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
     values ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
             'Pensão Amor', 'bar', 38.7071, -9.1458, current_date,
             now() + interval '24 hours') $$,
  'pin creation works inside the geofence'
);

-- Geofence: Porto is ~270km from Lisbon.
select throws_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
     values ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
             'Somewhere in Porto', 'bar', 41.1496, -8.6109, current_date,
             now() + interval '24 hours') $$,
  '23514',
  null,
  'pins outside the city radius are rejected'
);

-- HARD RULE 3: the 72h ceiling is a CHECK, not a convention.
select throws_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
     values ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
             'Forever pin', 'bar', 38.71, -9.14, current_date,
             now() + interval '80 hours') $$,
  '23514',
  null,
  'pins cannot live past 72 hours'
);

-- Pins are immutable for clients.
select throws_ok(
  $$ update public.pins set expires_at = now() + interval '71 hours' $$,
  '42501',
  null,
  'pins cannot be updated (immutability keeps the expiry cap airtight)'
);

-- Visibility.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.pins),
  1,
  'other users see the live pin'
);
select is(
  (select display_name from public.city_pins(pg_temp.lisbon()) limit 1),
  'traveler',
  'city_pins returns the pinner profile card'
);

-- Blocks sever pin visibility.
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.pins),
  0,
  'blocked pair: pin hidden'
);
reset role;
delete from public.blocks;

-- HARD RULE 3: expiry hides the pin from EVERYONE, owner included.
reset role;
update public.pins set expires_at = now() - interval '1 minute';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.pins),
  0,
  'expired pin unreadable even by its owner'
);

-- The sweep hard-deletes.
reset role;
select is(public.expire_pins(), 1, 'expiry sweep hard-deletes the row');
select is((select count(*)::int from public.pins), 0, 'no residue after sweep');

-- Heatmap k-threshold (k=3 default): 2 distinct pinners -> nothing.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Spot A', 'bar',
   38.7101, -9.1401, current_date, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), 'Spot B', 'bar',
   38.7102, -9.1402, current_date, now() + interval '24 hours');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.heat_cells(pg_temp.lisbon())),
  0,
  'HARD RULE 6: a cell below k distinct pinners renders no heat'
);

-- Third distinct pinner in the same ~550m cell -> heat appears.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
values
  ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(), 'Spot C', 'bar',
   38.7103, -9.1403, current_date, now() + interval '24 hours');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select results_eq(
  $$ select pin_count from public.heat_cells(pg_temp.lisbon()) $$,
  $$ values (3) $$,
  'cell reaching k renders with its count'
);

-- Same-user pins never inflate a cell toward k.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
select '00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(),
       'Dup ' || i, 'club', 38.7301 + i * 0.0001, -9.1502, current_date,
       now() + interval '24 hours'
from generate_series(1, 3) i;

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.730 and 38.735),
  0,
  'k counts DISTINCT pinners, not pins'
);

-- Seeded pins: no user attached, visible, count toward heat, client can't create.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date,
                         expires_at, seeded, seed_note)
values
  (null, pg_temp.lisbon(), 'Hostel pub crawl', 'bar', 38.7104, -9.1404,
   current_date, now() + interval '24 hours', true, 'Meets 9pm at the LX hostel'),
  (null, pg_temp.lisbon(), 'Free walking tour', 'monument', 38.7105, -9.1405,
   current_date, now() + interval '24 hours', true, null);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.pins where seeded),
  2,
  'seeded pins are visible to everyone'
);
-- Five, not four: the three pinners, the seeded pub crawl AND the seeded
-- walking tour. The tour is a monument, and under the old per-category
-- threshold it sat in a bucket of one and never appeared at all.
select is(
  (select pin_count from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.710 and 38.715),
  5,
  'seeded pins count toward heat (cold-start strategy)'
);
select throws_ok(
  $$ insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                              intent_date, expires_at, seeded)
     values (null, pg_temp.lisbon(), 'Fake event', 'bar', 38.71, -9.14,
             current_date, now() + interval '24 hours', true) $$,
  '42501',
  null,
  'clients cannot create seeded pins'
);

-- The threshold is per CELL, not per (cell, category).
--
-- Three people planning three different things on the same corner is exactly
-- what "this corner is busy tonight" means, and it is the common case. Under
-- the old grouping each of them sat alone in a bucket of one and the corner
-- stayed dark, which is why no run in this project's history has ever
-- photographed heat. This assertion fails against the pre-20260823010000
-- functions.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Mixed A', 'bar',
   38.7601, -9.1601, current_date, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), 'Mixed B', 'museum',
   38.7602, -9.1602, current_date, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(), 'Mixed C', 'hike',
   38.7603, -9.1603, current_date, now() + interval '24 hours');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select pin_count from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.758 and 38.763),
  3,
  'three people, three different plans, one corner: that corner is busy'
);
reset role;
delete from public.pins where venue_name like 'Mixed %';

-- DIFFERENCING REGRESSION (Phase 3 adversarial review): heat is computed
-- under the caller's own pin RLS, so it can never contain more than the pins
-- the caller could already see — a blocked pinner drops out of the other
-- party's heat entirely, and k applies per-viewer.
reset role;
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
-- Four: alice, cara and the two seeded pins. Bob is blocked and drops out.
select is(
  (select pin_count from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.710 and 38.715),
  4,
  'blocked-pair pins never count toward the other party''s heat'
);

-- A 3-pinner cell renders only for viewers who can see all three.
reset role;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), 'Cell2 A', 'restaurant',
   38.7501, -9.1701, current_date, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), 'Cell2 B', 'restaurant',
   38.7502, -9.1702, current_date, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(), 'Cell2 D', 'restaurant',
   38.7503, -9.1703, current_date, now() + interval '24 hours');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.750 and 38.755),
  0,
  'cell stays dark for a viewer who cannot see one of its k pinners'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select pin_count from public.heat_cells(pg_temp.lisbon())
   where cell_lat between 38.750 and 38.755),
  3,
  'the same cell renders for a viewer who sees all its pinners'
);

reset role;
delete from public.blocks;

-- Pin cap.
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                              intent_date, expires_at)
     select '00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(),
            'Cap ' || i, 'bar', 38.7401, -9.1601, current_date,
            now() + interval '24 hours'
     from generate_series(1, 8) i $$,
  '23514',
  null,
  'active pin cap (10) enforced'
);

-- Pin-source message request: works against a live pin, refused without one.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'pin',
     'Pensão Amor is great — mind if I join for one?', 'pin')) ->> 'delivered',
  'true',
  'pin-source request delivered against a live pin'
);
reset role;
delete from public.pins where user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000c', 'pin', 'hi there', 'pin') $$,
  'recipient unavailable',
  'pin-source request requires a live pin'
);

-- A pin in a DEACTIVATED city must not satisfy the check — otherwise the
-- error difference becomes an oracle for pin existence off the visible map.
reset role;
create function pg_temp.bangkok() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Bangkok' $$;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
select '00000000-0000-0000-0000-00000000000c', pg_temp.bangkok(),
       'Khaosan bar', 'bar', c.lat, c.lng, current_date, now() + interval '24 hours'
from public.cities c where c.id = pg_temp.bangkok();
update public.launch_cities set active = false where city_id = pg_temp.bangkok();

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000c', 'pin', 'hi there', 'pin') $$,
  'recipient unavailable',
  'pins in deactivated cities are not an existence oracle'
);

-- Anon gets nothing.
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.heat_cells(pg_temp.lisbon()) $$,
  '42501',
  null,
  'anon cannot read heat'
);

-- The daily curated refresh re-dates a plan instead of letting it rot.
--
-- seed_launch_pins() skips a venue that still has a live seeded pin, and a
-- seeded pin lives 48h against a daily schedule, so on day two every venue
-- was skipped and the map kept advertising yesterday. Today and Tomorrow
-- match intent_date exactly, so those chips went empty while the pins were
-- still on screen.
reset role;
delete from public.pins;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date,
                         expires_at, seeded, seed_note)
values (null, pg_temp.lisbon(), 'LX Factory night market', 'other', 38.7025, -9.1782,
        current_date - 1, now() + interval '40 hours', true, 'yesterday');

select ok(
  public.seed_launch_pins() > 0,
  'the refresh re-seeds a venue whose only live pin is yesterday''s'
);
select is(
  (select count(*)::int from public.pins where seeded and intent_date < current_date),
  0,
  'no curated pin is left advertising a day that has gone'
);
select is(
  (select count(*)::int from public.pins
   where seeded and venue_name = 'LX Factory night market'),
  1,
  'and the sweep leaves one of each venue, not two'
);

select * from finish();
rollback;
