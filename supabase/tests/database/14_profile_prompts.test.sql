-- Travel prompts: visible where the profile is, screened like the bio, and
-- capped at three.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

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
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- WRITING ------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.profile_prompts (user_id, slot, prompt_key, answer)
     values ('00000000-0000-0000-0000-00000000000a', 0, 'this_trip',
             'Eat my way through every market in Lisbon') $$,
  'you can answer a prompt'
);
select throws_ok(
  $$ insert into public.profile_prompts (user_id, slot, prompt_key, answer)
     values ('00000000-0000-0000-0000-00000000000a', 3, 'extra', 'a fourth one') $$,
  '23514',
  null,
  'three slots, and the cap is enforced by the schema'
);
select throws_ok(
  $$ insert into public.profile_prompts (user_id, slot, prompt_key, answer)
     values ('00000000-0000-0000-0000-00000000000b', 0, 'this_trip', 'not mine to write') $$,
  '42501',
  null,
  'and you can only answer your own'
);

-- SCREENED LIKE THE BIO ----------------------------------------------------

select throws_ok(
  $$ insert into public.profile_prompts (user_id, slot, prompt_key, answer)
     values ('00000000-0000-0000-0000-00000000000a', 1, 'perfect_day',
             'you are so sexy') $$,
  'that text breaks our community guidelines',
  'a prompt is not a hole around profile screening'
);

-- VISIBLE WHERE THE PROFILE IS ---------------------------------------------

-- Trips written with RLS out of the way: each of these belongs to a
-- different user, and the point of the fixture is the overlap, not the
-- insert path (which 04_trips_matching covers).
reset role;
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 2, current_date + 12),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 3, current_date + 9);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.profile_prompts
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'a traveler you can see is a traveler whose prompts you can read'
);

-- The invariant that matters is AGREEMENT: prompts are visible exactly where
-- the profile is, never more and never less. Asserting the two counts
-- together is what would catch a future policy drifting apart from
-- profiles' own — which is the only way three sentences could outlive the
-- page they belong to.
reset role;
update public.users set status = 'suspended'
  where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.profile_prompts
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  (select count(*)::int from public.profiles
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  'a suspended account hides its prompts exactly as it hides its profile'
);
reset role;
update public.users set status = 'active'
  where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');

select pg_temp.guest();
select throws_ok(
  $$ select * from public.profile_prompts $$,
  '42501',
  null,
  'and a signed-out visitor sees none of it'
);

-- DELETION -----------------------------------------------------------------

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from public.profile_prompts
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'deleting an account takes its prompts with it'
);
select is(
  (select count(*)::int from public.profile_prompts),
  0,
  'and leaves nothing orphaned'
);

select * from finish();
rollback;
