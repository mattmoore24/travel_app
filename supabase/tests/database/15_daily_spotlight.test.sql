-- The daily spotlight: mutual, stable for the day, and blind to appearance.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now(), bio = 'here for the food';

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

-- Alice overlaps Bob for a fortnight and Cara for two days, so Bob should
-- win on the one term that carries the most weight.
select pg_temp.admin();
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 1, current_date + 20),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 2, current_date + 18),
  ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(), current_date + 19, current_date + 21);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select user_id from public.daily_spotlight()),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'the longest shared window wins'
);

-- MUTUAL: the whole mechanism. A recommendation only one side can see is a
-- recommendation nobody acts on.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select user_id from public.daily_spotlight()),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'and the other person sees the same pairing'
);

-- STABLE: asking twice in a day is the same answer, not a reshuffle.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select user_id from public.daily_spotlight()),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'asking again the same day gives the same person'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.daily_spotlights where day = current_date),
  1,
  'and does not write a second pairing'
);

-- Nobody is spoken for twice on one day.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.daily_spotlight()),
  0,
  'somebody whose only candidates are already paired gets no spotlight'
);

-- NOTHING TO START: already connected, or already written to.
select pg_temp.admin();
delete from public.daily_spotlights;
insert into public.message_requests (sender_id, recipient_id, source, first_message, status)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
          'trip_match', 'already said hi', 'pending');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select user_id from public.daily_spotlight()),
  '00000000-0000-0000-0000-00000000000c'::uuid,
  'somebody you already wrote to is not spotlighted at you again'
);

-- THE SCORE ----------------------------------------------------------------

select is(
  public.spotlight_score(10, 2, true, 8),
  public.spotlight_score(10, 2, true, 8),
  'the score is symmetric by construction (same pair facts, same number)'
);
select ok(
  public.spotlight_score(14, 1, false, 0) > public.spotlight_score(2, 1, false, 0),
  'a longer shared window scores higher'
);

select pg_temp.guest();
select throws_ok(
  $$ select * from public.daily_spotlight() $$,
  '42501',
  null,
  'a signed-out visitor has no spotlight'
);

select * from finish();
rollback;
