-- A room remembers its plan.
--
-- pin_for_group hands a pin-born group the plan it came from: venue, day,
-- expiry, coordinates. The rules under test are the ones a client could talk
-- its way past: membership is the gate (a non-member's call answers nothing);
-- the function is SECURITY DEFINER on purpose, so a joiner keeps reading the
-- plan even when the pin's owner has since narrowed an audience that hides
-- the pin from their map (the whole reason it is definer); an expired pin is
-- unreadable in the room too, even before the sweep deletes the row (hard
-- rule 3); and a deleted pin answers with no rows rather than an error.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

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

create function pg_temp.pin_named(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.pins where venue_name = p_name $$;

-- The chat handle survives the pin: groups.pin_id goes null on delete, so a
-- helper joining through the pin would go null with it — read by the group's
-- name instead, which post_joinable_pin takes from the plan text.
create function pg_temp.the_room() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Sunset drinks' $$;

-- THE CARD, FOR THE PEOPLE IN THE ROOM ------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Pensão Amor', null, 'Rua Nova do Carvalho 45', 'bar',
       38.7071, -9.1458, current_date, now() + interval '24 hours',
       'Sunset drinks') $$,
  'a plan open to join, with a venue and a plan'
);

select is(
  (select venue_name from public.pin_for_group(pg_temp.the_room())),
  'Pensão Amor',
  'the admin reads the plan card: the venue'
);
select ok(
  (select expires_at > now() from public.pin_for_group(pg_temp.the_room())),
  'and the clock it burns down on'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.pin_for_group(pg_temp.the_room())),
  0,
  'a non-member calling pin_for_group on somebody else''s room gets nothing'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Pensão Amor')) $$,
  'a joiner is in with one tap'
);
select is(
  (select venue_name from public.pin_for_group(pg_temp.the_room())),
  'Pensão Amor',
  'and reads the same card'
);

-- WHY IT IS DEFINER: MEMBERSHIP, NOT AUDIENCE, IS THE GATE ----------------------
--
-- The owner narrows her audience; the pin leaves Bob's map. He is already in
-- the room with her, so the room must not forget its own plan.

select pg_temp.admin();
update public.profiles set verified = true, gender = 'woman'
  where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.set_visibility('verified_women') $$,
  'the owner narrows to verified women'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Pensão Amor'),
  0,
  'the pin has left the joiner''s map'
);
select is(
  (select venue_name from public.pin_for_group(pg_temp.the_room())),
  'Pensão Amor',
  'and the room still shows him the plan'
);

-- HARD RULE 3: EXPIRED IS UNREADABLE, EVEN BEFORE THE SWEEP ---------------------

select pg_temp.admin();
update public.pins set expires_at = now() - interval '1 second'
  where venue_name = 'Pensão Amor';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.pin_for_group(pg_temp.the_room())),
  0,
  'an expired pin is unreadable in the room too (hard rule 3)'
);

-- AND A SWEPT PIN IS NO ROWS, NOT AN ERROR --------------------------------------

select pg_temp.admin();
delete from public.pins where venue_name = 'Pensão Amor';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select * from public.pin_for_group(pg_temp.the_room()) $$,
  'a deleted pin answers with no rows rather than an error'
);
select is(
  (select count(*)::int from public.pin_for_group(pg_temp.the_room())),
  0,
  'the group is an ordinary group now, and the card has nothing to say'
);

-- AND THE ENDING SURVIVES THE SWEEP ---------------------------------------------
-- expire_pins hard-deletes and pin_id goes null with it, so without the
-- delete-trigger stamp the room's "burned out" line would vanish within
-- fifteen minutes of the pin expiring.

select pg_temp.admin();
select is(
  (select (plan_ended_at is not null and pin_id is null)
     from public.groups where chat_id = pg_temp.the_room()),
  true,
  'deleting the pin stamps the group: pin_id null, plan_ended_at set'
);
select is(
  (select count(*)::int from public.groups
    where plan_ended_at is not null and chat_id <> pg_temp.the_room()),
  0,
  'a group that never had a pin is never stamped'
);

select * from finish();
rollback;
