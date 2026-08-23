-- Who can see you: verified-only and by-gender audiences.
--
-- The three things worth proving are the three things a reviewer would doubt:
-- that it hides in BOTH directions, that it hides on BOTH surfaces, and that
-- it leaves chat completely alone.
begin;
select plan(22);

insert into auth.users (id, email) values
  -- ann: verified woman, wants verified men only
  ('00000000-0000-0000-0000-0000000000a1', 'ann@example.com'),
  -- ben: verified man, open to everyone
  ('00000000-0000-0000-0000-0000000000b1', 'ben@example.com'),
  -- cal: UNVERIFIED man, open to everyone
  ('00000000-0000-0000-0000-0000000000c1', 'cal@example.com'),
  -- dot: verified woman, open to everyone
  ('00000000-0000-0000-0000-0000000000d1', 'dot@example.com'),
  -- eli: verified, nonbinary, open to everyone
  ('00000000-0000-0000-0000-0000000000e1', 'eli@example.com');

update public.profiles set
  display_name = 'traveler', age = 30, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now(), bio = 'here for the food';

update public.profiles set verified = true, gender = 'woman'
  where user_id in ('00000000-0000-0000-0000-0000000000a1',
                    '00000000-0000-0000-0000-0000000000d1');
update public.profiles set verified = true, gender = 'man'
  where user_id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set verified = false, gender = 'man'
  where user_id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set verified = true, gender = 'nonbinary'
  where user_id = '00000000-0000-0000-0000-0000000000e1';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
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

-- Everybody is in Lisbon at the same time, so nothing below is ever a
-- date-overlap result in disguise.
select pg_temp.admin();
insert into public.trips (user_id, city_id, start_date, end_date)
select id, pg_temp.lisbon(), current_date, current_date + 20 from auth.users;


-- 1. The gate on choosing at all ------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.my_visibility(), 'everyone'::public.profile_audience,
  'everybody starts open to everyone');
select throws_ok(
  $$ select public.set_visibility('verified') $$,
  'get verified before choosing who can see you',
  'an unverified traveler cannot narrow their audience');
select is(public.my_visibility(), 'everyone'::public.profile_audience,
  'and the refused write changed nothing');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.set_visibility('verified_men') $$,
  'a verified traveler can');
select is(public.my_visibility(), 'verified_men'::public.profile_audience,
  'and it sticks');

-- The column itself is off limits: the rule above would be worth nothing if
-- the client could write the column directly.
select throws_ok(
  $$ update public.profiles set visible_to = 'verified'
     where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null,
  'and nobody can write the column around the RPC');


-- 2. Travelers, in both directions ----------------------------------------------

-- Ann asked for verified men. Ben is one; Cal is a man but unverified; Dot
-- and Eli are verified but not men.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select bag_eq(
  $$ select user_id from public.get_matches() $$,
  $$ values ('00000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'she is shown only the audience she asked for');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' in (select user_id from public.get_matches()),
  'the verified man she wanted still sees her');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' not in (select user_id from public.get_matches()),
  'an unverified traveler does not');

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' not in (select user_id from public.get_matches()),
  'nor does a verified woman');

-- Stated plainly because it is a real consequence, not an oversight: a
-- gendered audience is a gendered audience.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' not in (select user_id from public.get_matches()),
  'nor does a verified nonbinary traveler');

-- Everyone else still sees everyone else. One person narrowing their
-- audience must not thin out the queue for the rest of the app.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select bag_eq(
  $$ select user_id from public.get_matches() $$,
  $$ values ('00000000-0000-0000-0000-0000000000b1'::uuid),
            ('00000000-0000-0000-0000-0000000000d1'::uuid),
            ('00000000-0000-0000-0000-0000000000e1'::uuid) $$,
  'and everybody open to everyone still sees everybody else');


-- 3. The map, same rule ----------------------------------------------------------

select pg_temp.admin();
insert into public.launch_cities (city_id, active) values (pg_temp.lisbon(), true)
  on conflict (city_id) do update set active = true;
insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                         intent_date, expires_at)
select id, pg_temp.lisbon(), 'a bar', 'bar', 38.72, -9.14,
       current_date, now() + interval '20 hours'
from auth.users;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select bag_eq(
  $$ select user_id from public.city_pins(pg_temp.lisbon()) where user_id is not null $$,
  $$ values ('00000000-0000-0000-0000-0000000000a1'::uuid),
            ('00000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'the map shows her the same audience, plus her own pin');

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' not in
    (select user_id from public.city_pins(pg_temp.lisbon()) where user_id is not null),
  'and hides her pin from everybody outside it');

-- A curated pin has no owner and belongs to nobody's audience.
select pg_temp.admin();
insert into public.pins (city_id, venue_name, category, lat, lng, intent_date,
                         seeded, seed_note, expires_at)
values (pg_temp.lisbon(), 'free walking tour', 'other', 38.71, -9.13,
        current_date, true, 'meet at the arch', now() + interval '20 hours');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select ok(
  exists (select 1 from public.city_pins(pg_temp.lisbon()) where seeded),
  'curated pins are nobody''s audience and stay on the map');


-- 4. The heatmap is aggregate and deliberately untouched ---------------------------

-- All five travelers dropped a pin in the same 0.005 degree cell, and
-- heat_k is 3, so the cell clears the threshold. Dot cannot see Ann's PIN,
-- but Ann still counts toward the cell: filtering the aggregate per viewer
-- would push counts DOWN, which is the direction that breaks rule 6.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (select pin_count from public.heat_cells(pg_temp.lisbon())
    where cell_lat between 38.71 and 38.73),
  5,
  'a hidden traveler still counts toward the anonymous heat, so the k-threshold does not weaken');


-- 5. Chat is exempt, which is the point --------------------------------------------

-- Ann is hidden from Dot in both discovery surfaces. Dot can still write to
-- her, still read her profile, and still see her trips.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select lives_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-0000000000a1', 'trip_match',
       'hello, we are in Lisbon the same week') $$,
  'somebody outside her audience can still say hi');
select ok(
  exists (select 1 from public.profiles
          where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'and can still read her profile');
select ok(
  exists (select 1 from public.traveler_trips('00000000-0000-0000-0000-0000000000a1')),
  'and can still see her trips on it');


-- 6. Guests, and losing the badge ---------------------------------------------------

-- featured_traveler is granted to anon, so a guest is the viewer. Somebody
-- who narrowed their audience is not eligible for a slot shown to nobody in
-- particular.
-- Ann is the only one with an approved position-0 photo, so she is the only
-- candidate for the slot at all. If the audience filter were missing she
-- would be the traveler a logged-out guest is shown.
select pg_temp.admin();
insert into public.profile_photos (user_id, storage_path, position, moderation_status)
values ('00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a1/1.jpg', 0, 'approved');
select pg_temp.guest();
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  0,
  'a narrowed audience is never the traveler a guest is shown');

-- Losing the badge drops the setting with it, so the rule cannot be enforced
-- only at write time.
select pg_temp.admin();
update public.profiles set verified = false
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select is(
  (select visible_to from public.profiles
    where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'everyone'::public.profile_audience,
  'and taking the badge away puts them back to open');

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select ok(
  '00000000-0000-0000-0000-0000000000a1' in (select user_id from public.get_matches()),
  'which puts them back in the queue too');

select * from finish();
rollback;
