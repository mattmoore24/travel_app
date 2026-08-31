-- Top priorities: six is enforced by the schema, forty characters is enforced
-- by the schema, and the list is visible exactly where the profile is.
begin;
select plan(15);

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
  $$ insert into public.profile_priorities (user_id, slot, text) values
       ('00000000-0000-0000-0000-00000000000a', 0, 'day trip to Sintra'),
       ('00000000-0000-0000-0000-00000000000a', 1, 'learn to surf'),
       ('00000000-0000-0000-0000-00000000000a', 2, 'pastel de nata crawl'),
       ('00000000-0000-0000-0000-00000000000a', 3, 'find a record shop'),
       ('00000000-0000-0000-0000-00000000000a', 4, 'rooftop for the sunset'),
       ('00000000-0000-0000-0000-00000000000a', 5, 'hike the Seven Hanging Valleys') $$,
  'six priorities go in, including one of exactly thirty characters'
);

-- The cap is the primary key plus the check, not the client. Both routes to a
-- seventh row are refused, and they fail with different codes, so asserting
-- one would not have caught the other.
select throws_ok(
  $$ insert into public.profile_priorities (user_id, slot, text)
     values ('00000000-0000-0000-0000-00000000000a', 6, 'one too many') $$,
  '23514',
  null,
  'there is no seventh slot'
);
select throws_ok(
  $$ insert into public.profile_priorities (user_id, slot, text)
     values ('00000000-0000-0000-0000-00000000000a', 0, 'reusing slot zero') $$,
  '23505',
  null,
  'and a slot cannot be used twice, so six is six by two independent routes'
);

select lives_ok(
  $$ update public.profile_priorities set text = repeat('a', 40)
      where user_id = '00000000-0000-0000-0000-00000000000a' and slot = 0 $$,
  'forty characters is fine'
);
select throws_ok(
  $$ update public.profile_priorities set text = repeat('a', 41)
      where user_id = '00000000-0000-0000-0000-00000000000a' and slot = 0 $$,
  '23514',
  null,
  'forty-one is not'
);
select throws_ok(
  $$ update public.profile_priorities set text = ''
      where user_id = '00000000-0000-0000-0000-00000000000a' and slot = 0 $$,
  '23514',
  null,
  'and neither is nothing at all'
);

select throws_ok(
  $$ insert into public.profile_priorities (user_id, slot, text)
     values ('00000000-0000-0000-0000-00000000000b', 0, 'not mine to write') $$,
  '42501',
  null,
  'you can only write your own list'
);

-- SCREENED LIKE THE BIO ----------------------------------------------------

-- Forty characters is plenty of room for a handle or an invitation, so the
-- same filter the bio and the prompts pass runs here too. Without it this
-- would be a hole straight around profile screening, exactly as prompts
-- would have been.
select throws_ok(
  $$ update public.profile_priorities set text = 'you are so sexy'
      where user_id = '00000000-0000-0000-0000-00000000000a' and slot = 1 $$,
  'that text breaks our house rules',
  'the list is not a hole around profile screening'
);
-- On INSERT too, and on the caller's own row: writing blocked text into
-- somebody else's slot raises the SCREENING error rather than the RLS one,
-- because the BEFORE INSERT trigger fires ahead of the with-check. Asserting
-- a permission error there would have passed for the wrong reason.
delete from public.profile_priorities
  where user_id = '00000000-0000-0000-0000-00000000000a' and slot = 5;
select throws_ok(
  $$ insert into public.profile_priorities (user_id, slot, text)
     values ('00000000-0000-0000-0000-00000000000a', 5, 'you are so sexy') $$,
  'that text breaks our house rules',
  'and screening runs on insert as well as update'
);
select lives_ok(
  $$ insert into public.profile_priorities (user_id, slot, text)
     values ('00000000-0000-0000-0000-00000000000a', 5, 'hike the Seven Hanging Valleys') $$,
  'and the slot is still usable afterwards'
);

-- VISIBLE WHERE THE PROFILE IS ---------------------------------------------

reset role;
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 2, current_date + 12),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 3, current_date + 9);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.profile_priorities
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  6,
  'a traveler you can see is a traveler whose list you can read'
);

-- The invariant is AGREEMENT: the list is visible exactly where the profile
-- is, never more and never less. Asserting the two counts together is what
-- catches a future policy drifting apart from profiles' own, which is the
-- only way six plans could outlive the page they belong to.
reset role;
update public.users set status = 'suspended'
  where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.profile_priorities
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  (select count(*)::int from public.profiles
    where user_id = '00000000-0000-0000-0000-00000000000a') * 6,
  'a suspended account hides its list exactly as it hides its profile'
);
reset role;
update public.users set status = 'active'
  where id = '00000000-0000-0000-0000-00000000000a';

select pg_temp.guest();
select throws_ok(
  $$ select * from public.profile_priorities $$,
  '42501',
  null,
  'and a signed-out visitor sees none of it'
);

-- DELETION -----------------------------------------------------------------

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from public.profile_priorities
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'deleting an account takes its list with it'
);
select is(
  (select count(*)::int from public.profile_priorities),
  0,
  'and leaves nothing orphaned'
);

select * from finish();
rollback;
