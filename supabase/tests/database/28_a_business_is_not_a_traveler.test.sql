-- A business account cannot do traveler things, and the database is what says so.
--
-- Founder, after testing as a business: "under no circumstances should a
-- business account ever have the option to join a chat of any other business
-- or other pin of any kind... It also doesn't make any sense for a business
-- account to ever be able to join its own chat, and it also doesn't make
-- sense for the business account to ever have to set a date for when it is
-- leaving."
--
-- "Under no circumstances" is a database rule. Before 20260829190000 every
-- one of these calls succeeded: the client hid some of the buttons, and the
-- anon key is in the app bundle, so hiding a button is not a rule.
begin;
select plan(9);

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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b8', 'traveler@example.com');

-- A traveler, so there is a plan to try to join and a control to compare to.
update public.profiles set
  display_name = 'Bea', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000b8';

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select public.post_joinable_pin(
  pg_temp.lisbon(), 'The rooftop', 'Rooftop at 9', 'By the door',
  'bar'::public.pin_category, 38.7108, -9.1400, current_date, now() + interval '6 hours'
);
create function pg_temp.plan() returns uuid language sql as
  $$ select id from public.pins where note = 'Rooftop at 9' $$;

-- The business.
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select public.register_business('Casa Verde', 'cafe', pg_temp.lisbon(), 38.7108, -9.1400);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
 where owner_user_id = '00000000-0000-0000-0000-0000000000a8';
-- SECURITY DEFINER: owner_user_id is withheld from the client on purpose, so
-- a plain subquery here would be refused by RLS before the guard under test
-- was ever reached, and the assertion would pass for the wrong reason.
create function pg_temp.room_of(p_owner uuid) returns uuid
  language sql security definer as
  $$ select chat_id from public.businesses where owner_user_id = p_owner $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a8');

-- ITS OWN ROOM. The founder's second sentence, and the one that reads
-- strangest of all: an owner queueing up as a guest of their own bar.
select throws_ok(
  $$ select public.join_room(pg_temp.room_of('00000000-0000-0000-0000-0000000000a8'), null) $$,
  '42501',
  'a business account cannot join a room',
  'a business cannot join its own room'
);

-- SOMEBODY ELSE'S ROOM.
select pg_temp.admin();
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c8', 'other@example.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000c8');
select public.register_business('Casa Roxa', 'bar', pg_temp.lisbon(), 38.7108, -9.1400);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
 where owner_user_id = '00000000-0000-0000-0000-0000000000c8';

select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select throws_ok(
  $$ select public.join_room(pg_temp.room_of('00000000-0000-0000-0000-0000000000c8'), null) $$,
  '42501',
  'a business account cannot join a room',
  'nor another business''s room'
);

-- A TRAVELER'S PLAN, which is the "or other pin of any kind" half.
select throws_ok(
  $$ select public.join_pin_chat(pg_temp.plan()) $$,
  '42501',
  'a business account cannot join a plan',
  'a business cannot join a plan'
);

-- POSTING one.
select throws_ok(
  $$ select public.post_joinable_pin(pg_temp.lisbon(), 'Ours', 'Come to ours',
       null, 'bar'::public.pin_category, 38.7108, -9.1400, current_date,
       now() + interval '6 hours') $$,
  '42501',
  'a business account cannot post a plan',
  'nor post one'
);

-- Straight at the table, with the anon key, which is what makes the client's
-- hidden button not a rule.
select throws_ok(
  $$ insert into public.pins (user_id, city_id, lat, lng, note, expires_at)
     values ('00000000-0000-0000-0000-0000000000a8', pg_temp.lisbon(),
             38.7108, -9.1400, 'Sneaking one in', now() + interval '1 hour') $$,
  '42501',
  'a business account cannot drop a pin',
  'and cannot reach around the RPC to the pins table'
);

-- A GROUP, which carries an expiry date — the thing the founder says a
-- business should never be asked for.
select throws_ok(
  $$ select public.create_group('Our regulars', null) $$,
  '42501',
  'a business account cannot start a group',
  'a business cannot start a group, so is never asked when it ends'
);

-- A DISCOVERY SETTING for an account nothing discovers.
select throws_ok(
  $$ select public.set_visibility('verified') $$,
  '42501',
  'a business account cannot set who sees it',
  'and cannot set an audience'
);

-- The traveler is untouched by all of it: these guards must not cost the
-- people the app is for anything.
select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select lives_ok(
  $$ select public.set_visibility('everyone') $$,
  'a traveler still sets their own audience'
);
select lives_ok(
  $$ select public.create_group('Lisbon crew', null) $$,
  'and still starts a group'
);

select * from finish();
rollback;
