-- Trips: other users' travel plans are readable ONLY through a genuine
-- city+date overlap with one of the caller's own active trips.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com');

-- Everyone except Dave finishes onboarding (Dave stays undiscoverable).
update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now()
where user_id <> '00000000-0000-0000-0000-00000000000d';

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
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

select isnt(pg_temp.lisbon(), null, 'seeded city data includes Lisbon');

-- Alice: Lisbon in ~a month. Bob overlaps; Cara same city, later, no overlap.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date)
     values ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
             current_date + 3, current_date + 13) $$,
  'trip creation works'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
          current_date + 8, current_date + 18);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(),
          current_date + 60, current_date + 70);

-- Visibility.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'overlapping trip is visible'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'same city without date overlap stays invisible'
);

-- get_matches returns the overlap window.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select results_eq(
  $$ select user_id, overlap_start, overlap_end from public.get_matches() $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid,
             current_date + 8, current_date + 13) $$,
  'get_matches computes the shared window'
);

-- Undiscoverable owners never match: Dave (no onboarding) overlaps Alice.
reset role;
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(),
          current_date + 3, current_date + 13);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000d'),
  0,
  'trips of non-onboarded users are invisible'
);

-- Blocks sever visibility in both directions.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'blocker no longer sees the blocked user''s trips'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'blocked user no longer sees the blocker''s trips'
);
reset role;
delete from public.blocks;

-- Cancelling hides a trip from matches.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update public.trips set status = 'cancelled'
  where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.trips
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'cancelled trips leave the pool'
);
reset role;
update public.trips set status = 'active'
  where user_id = '00000000-0000-0000-0000-00000000000a';

-- Guardrails.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date)
     values ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
             current_date - 20, current_date - 10) $$,
  '23514',
  null,
  'fully past trips are rejected'
);
select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date)
     select '00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(),
            current_date + 1 + i, current_date + 3 + i
     from generate_series(1, 5) i $$,
  '23514',
  null,
  'active trip cap (5) enforced'
);
select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date)
     values ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
             current_date + 1, current_date + 2) $$,
  '42501',
  null,
  'cannot create trips for another user'
);

-- The cap survives the cancel -> insert -> reactivate cycle (the scrape
-- exploit from the Phase 2 adversarial review).
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.trips (user_id, city_id, start_date, end_date)
select '00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
       current_date + 100 + i * 5, current_date + 102 + i * 5
from generate_series(1, 4) i; -- bob now at 5 active
update public.trips set status = 'cancelled'
  where user_id = '00000000-0000-0000-0000-00000000000b'; -- 0 active
insert into public.trips (user_id, city_id, start_date, end_date)
select '00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
       current_date + 200 + i * 5, current_date + 202 + i * 5
from generate_series(1, 5) i; -- back to 5 active
select throws_ok(
  $$ update public.trips set status = 'active'
     where user_id = '00000000-0000-0000-0000-00000000000b'
       and status = 'cancelled' $$,
  '23514',
  null,
  'reactivating cancelled trips cannot exceed the cap'
);

-- City search: accent-folded, wildcard-safe.
select is(
  (select name from public.search_cities('sao paulo') limit 1),
  'São Paulo',
  'ASCII input finds accented city names'
);
select is(
  (select count(*)::int from public.search_cities('%%')),
  0,
  'LIKE wildcards in input are inert'
);

-- Signed-out clients get nothing.
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.trips $$,
  '42501',
  null,
  'anon cannot read trips'
);
select throws_ok(
  $$ select * from public.get_matches() $$,
  '42501',
  null,
  'anon cannot call get_matches'
);

select * from finish();
rollback;
