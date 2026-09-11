-- TWENTY PINS AT ONCE.
--
-- Founder, 2026-09-11: "raise it to 20 (that should be plenty)." The cap used
-- to be ten, set when a pin lived three days at most; with a year-long pin
-- ten recycled a year at a time. This file proves the new number from both
-- sides: the twentieth pin goes up, the twenty-first is refused with the
-- hint the app has copy for, and taking one down frees the slot.
begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'cap@example.com');
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

-- One post, as the app makes it: through post_joinable_pin, not joinable
-- (a joinable pin opens a group, and groups have a daily cap of their own),
-- with no expiry stated, so the take-down day is the plan's day.
create function pg_temp.post(n int) returns void language plpgsql as $$
begin
  perform public.post_joinable_pin(
    pg_temp.lisbon(), 'Cap probe ' || n, null, null, 'bar',
    38.7071 + n * 0.0005, -9.1458, current_date + 1, null,
    'Counting to twenty', null, false);
end
$$;

-- The refusal's hint, which is what the app keys its sentence on.
create function pg_temp.hint_of_post(n int) returns text language plpgsql as $$
declare h text;
begin
  perform pg_temp.post(n);
  return 'no error';
exception when check_violation then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- 1. Twenty go up. Under the old cap the eleventh would have been refused.
select lives_ok(
  $$ select pg_temp.post(n) from generate_series(1, 20) as n $$,
  'twenty pins post, one after another'
);
select is(
  (select count(*)::int from public.pins
    where user_id = '00000000-0000-0000-0000-0000000000a1' and expires_at > now()),
  20,
  'all twenty are on the map'
);

-- 2. The twenty-first is refused, by the number the app's copy names.
select throws_ok(
  $$ select pg_temp.post(21) $$,
  '23514',
  'active pin limit reached (20)',
  'the twenty-first is refused, naming twenty'
);
select is(
  pg_temp.hint_of_post(21),
  'pin_cap',
  'the refusal carries the pin_cap hint'
);

-- 3. Taking one down frees the slot: the cap counts what is on the map.
delete from public.pins
  where id = (select id from public.pins
               where user_id = '00000000-0000-0000-0000-0000000000a1'
               order by created_at limit 1);
select lives_ok(
  $$ select pg_temp.post(22) $$,
  'after taking one down, the next pin goes up'
);

select * from finish();
rollback;
