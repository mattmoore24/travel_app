-- A plan posted from a business page names that business, explicitly.
--
-- The attack on 20260903110000. Before it, the only way a pin could link to
-- a business was validate_pin's fallback (exact name, sixty metres), so a
-- traveler who came from the page and called the spot anything else lost
-- the link. Now p_business_id rides the insert, and the three things that
-- have to hold are: the explicit id wins over the name, a business that is
-- not on the map is refused before a page can deep-link to nothing, and the
-- previous signature keeps working for a phone on the previous bundle.
--
-- Measured (2026-09-02) against the migration with `business_id` and
-- `p_business_id` deleted from the insert: assertions 2, 3 and 7 fail and
-- nothing else does - 3 because validate_pin's city check never sees a
-- business it was not handed. With the listed-and-active guard deleted:
-- assertion 4 alone.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d4a1', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000d4b1', 'owner@example.com');

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

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

create function pg_temp.bangkok() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Bangkok' $$;

-- Definer, because it is read while logged in as a traveler and the
-- businesses SELECT policy hides a removed one: the id the removed page still
-- holds is exactly what the fourth assertion needs to hand over.
create function pg_temp.biz(p_name text) returns uuid
language sql security definer set search_path = public as
  $$ select id from public.businesses where name = p_name $$;

-- Inserted directly rather than through register_business, which lists a
-- business as 'unconfirmed'.
insert into public.businesses (city_id, name, category, lat, lng, owner_user_id, state)
values
  (pg_temp.lisbon(), 'Park Rooftop Bar', 'bar', 38.7112, -9.1442,
   '00000000-0000-0000-0000-00000000d4b1', 'listed'),
  (pg_temp.lisbon(), 'Gone Bar', 'bar', 38.7120, -9.1450, null, 'removed'),
  (pg_temp.bangkok(), 'Brick Bar', 'club', 13.7589, 100.4986, null, 'listed');

select pg_temp.login('00000000-0000-0000-0000-00000000d4a1');

-- EXPLICIT BEATS INFERRED -----------------------------------------------------
select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'The bench outside', null, null, 'bar',
      38.7112, -9.1442, current_date + 1, now() + interval '20 hours',
      'Sunset drinks', null, true, %L)
  $$, pg_temp.lisbon(), pg_temp.biz('Park Rooftop Bar')),
  'a plan opened from a business page posts with the business named'
);
select is(
  (select business_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'The bench outside'),
  pg_temp.biz('Park Rooftop Bar'),
  'and the map feed links it to that business, whatever the spot was called'
);

-- A BUSINESS IN ANOTHER CITY, OR OFF THE MAP, IS REFUSED ---------------------
select throws_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Brick Bar', null, null, 'club',
      38.7112, -9.1442, current_date + 1, now() + interval '20 hours',
      'Late one', null, true, %L)
  $$, pg_temp.lisbon(), pg_temp.biz('Brick Bar')),
  '23514',
  null,
  'a Lisbon plan cannot name a Bangkok business (validate_pin, unchanged)'
);
select throws_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Gone Bar', null, null, 'bar',
      38.7120, -9.1450, current_date + 1, now() + interval '20 hours',
      'One for the road', null, true, %L)
  $$, pg_temp.lisbon(), pg_temp.biz('Gone Bar')),
  'That business is not on the map any more.',
  'a business that has left the map cannot be named, so no pin deep-links to nothing'
);

-- THE PREVIOUS SIGNATURE STILL WORKS ------------------------------------------
select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Miradouro da Graca', null, null, 'other',
      38.7160, -9.1310, current_date + 1, now() + interval '20 hours',
      'Sunset', null, false)
  $$, pg_temp.lisbon()),
  'the twelve-argument call a phone on the previous bundle makes still posts'
);

-- AND A MESSAGE-ME-FIRST PLAN CARRIES THE BUSINESS TOO -------------------------
select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Rooftop, ask for Rui', null, null, 'bar',
      38.7112, -9.1442, current_date + 2, now() + interval '40 hours',
      'Quiet drink', null, false, %L)
  $$, pg_temp.lisbon(), pg_temp.biz('Park Rooftop Bar')),
  'both shapes of pin go through the one write path'
);
select is(
  (select business_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Rooftop, ask for Rui'),
  pg_temp.biz('Park Rooftop Bar'),
  'and the message-me-first shape links to the business as well'
);

-- THE GRANTS SURVIVED THE DROP ------------------------------------------------
select ok(
  has_function_privilege('authenticated',
    'public.post_joinable_pin(int, text, text, text, public.pin_category, double precision, double precision, date, timestamptz, text, time, boolean, uuid)',
    'execute'),
  'a traveler can call the new signature'
);
select ok(
  not has_function_privilege('anon',
    'public.post_joinable_pin(int, text, text, text, public.pin_category, double precision, double precision, date, timestamptz, text, time, boolean, uuid)',
    'execute'),
  'and a signed-out device cannot'
);

select * from finish();
rollback;
