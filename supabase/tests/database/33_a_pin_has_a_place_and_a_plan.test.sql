-- The venue/plan split (20260831170000): pins.plan exists, both map feeds
-- return it WITH THEIR GRANTS INTACT — the drop-function-first rule takes
-- the grants with it, and a lost grant after a drop is the exact failure
-- this repo has already documented — and the per-column INSERT grant grew
-- the new column, or the app's write path dies while reads look fine.
begin;
select plan(10);

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

create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

-- THE COLUMN AND ITS WRITE PATH ------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, note, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', %s, 'Time Out Market',
            'Sunset drinks', 'by the door at 7', 'bar', 38.7067, -9.1459,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  'the app can insert a pin with both the place and the plan'
);

select throws_ok(
  format($$
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng,
       intent_date, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', %s, 'Time Out Market',
            repeat('x', 81), 'bar', 38.7067, -9.1459,
            current_date, now() + interval '20 hours')
  $$, pg_temp.lisbon()),
  '23514',
  null,
  'a plan longer than 80 characters is refused, like the venue before it'
);

-- The star-read that the column-granted INSERT must not have broken (test 31
-- pins the full list; this is the local assertion for the new column).
select lives_ok(
  $$ select * from public.pins limit 1 $$,
  'select * still works on pins with the new column'
);

-- THE MEMBER FEED --------------------------------------------------------------

select is(
  (select plan from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Time Out Market'),
  'Sunset drinks',
  'city_pins returns the plan to a member, grant intact after the drop'
);

-- THE OPEN-PIN PATH ------------------------------------------------------------

select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Pensão Amor', null, null, 'bar',
      38.7071, -9.1458, current_date, now() + interval '24 hours',
      'Fado then drinks')
  $$, pg_temp.lisbon()),
  'post_joinable_pin accepts the plan, grant intact after the drop'
);

select pg_temp.admin();
select is(
  (select p.plan from public.pins p where p.venue_name = 'Pensão Amor'),
  'Fado then drinks',
  'and writes it onto the pin'
);
select is(
  (select g.name from public.groups g
    join public.pins p on p.id = g.pin_id
    where p.venue_name = 'Pensão Amor'),
  'Fado then drinks',
  'the group is still called what the plan is called - the plan moved, the rule moved with it'
);

-- An old client that does not send p_plan keeps posting (the parameter has a
-- default: an over-the-air lag must not break pinning).
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format($$
    select public.post_joinable_pin(
      %s, 'Musicbox Lisboa', null, null, 'club',
      38.7069, -9.1454, current_date, now() + interval '24 hours')
  $$, pg_temp.lisbon()),
  'the nine-argument call still works for a client on the previous bundle'
);

-- THE GUEST FEED ---------------------------------------------------------------

select pg_temp.guest();
select is(
  (select plan from public.public_city_pins(pg_temp.lisbon())
    where venue_name = 'Time Out Market'),
  'Sunset drinks',
  'public_city_pins returns the plan to a guest, anon grant intact after the drop'
);
select is(
  (select count(*)::int from public.public_city_pins(pg_temp.lisbon())
    where venue_name = 'Pensão Amor'),
  1,
  'and the open pin is on the guest map too'
);

select * from finish();
rollback;
