-- A pin anyone can join, and the people you already know.
--
-- Two features, one test file, because they share a question: what does it
-- take to end up in a chat with somebody, now that neither a token nor an
-- accept is always required? The rules under test are the ones a client could
-- otherwise talk its way past — who may join an open pin, whose audience
-- decides who sees it, what survives the pin's own expiry, who may be added
-- to a group, who may be messaged with no hello, and whether any of that
-- unlocks a social handle (hard rule 4 — it must not, until both have
-- spoken).
begin;
select plan(50);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'edie@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Alice'
  where user_id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set display_name = 'Bob'
  where user_id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set display_name = 'Cara'
  where user_id = '00000000-0000-0000-0000-00000000000c';
update public.profiles set display_name = 'Dave'
  where user_id = '00000000-0000-0000-0000-00000000000d';
update public.profiles set display_name = 'Edie'
  where user_id = '00000000-0000-0000-0000-00000000000e';

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

-- The pin ids are read back through this rather than held in a variable: a
-- pgTAP file is one long transaction with no client-side state, and reading
-- from `pins` needs an owner or a viewer the RLS policies admit.
create function pg_temp.pin_named(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.pins where venue_name = p_name $$;

create function pg_temp.chat_of(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select g.chat_id from public.groups g
     join public.pins p on p.id = g.pin_id where p.venue_name = p_name $$;

-- POSTING ONE ------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Pensão Amor', 'come along', null, 'bar',
       38.7071, -9.1458, current_date, now() + interval '24 hours') $$,
  'a pin can be posted open to join'
);

select is(
  (select count(*)::int from public.groups where pin_id = pg_temp.pin_named('Pensão Amor')),
  1,
  'and it arrives carrying a group'
);

select pg_temp.admin();
select is(
  (select name from public.groups where pin_id = pg_temp.pin_named('Pensão Amor')),
  'Pensão Amor',
  'the group is called what the plan is called'
);
select is(
  (select max_stay_until from public.groups where pin_id = pg_temp.pin_named('Pensão Amor')),
  null,
  'with no end date: the pin has 72 hours, the conversation does not'
);
select is(
  (select role from public.room_members
    where chat_id = pg_temp.chat_of('Pensão Amor')
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  'admin',
  'the pinner runs the group they opened'
);

-- Every guard the ordinary pin path has still fires, because they are
-- triggers on the table and a SECURITY DEFINER insert is still an insert.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Somewhere in Porto', null, null, 'bar',
       41.1496, -8.6109, current_date, now() + interval '24 hours') $$,
  '23514',
  null,
  'the geofence still refuses a pin in another city'
);
select throws_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Forever plan', null, null, 'bar',
       38.71, -9.14, current_date, now() + interval '80 hours') $$,
  '23514',
  null,
  'and the 72-hour ceiling is still a ceiling (hard rule 3)'
);

-- JOINING ----------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Pensão Amor')) $$,
  'anybody who can see the pin can join it, with no token and no hello'
);
select ok(
  public.is_room_member(pg_temp.chat_of('Pensão Amor')),
  'joining makes you a member of the chat, immediately'
);
select is(
  public.pin_chat_size(pg_temp.pin_named('Pensão Amor')),
  2,
  'and the pin counts two'
);

select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Pensão Amor')) $$,
  'joining twice is joining once'
);
select is(
  public.pin_chat_size(pg_temp.pin_named('Pensão Amor')),
  2,
  'and does not count you twice'
);

select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.chat_of('Pensão Amor'),
             '00000000-0000-0000-0000-00000000000b', 'on my way') $$,
  'a joiner can talk in it straight away'
);

-- The pin still belongs to the person who posted it.
select pg_temp.admin();
select is(
  (select user_id from public.pins where venue_name = 'Pensão Amor'),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'joining does not move the pin: the poster keeps it'
);
select is(
  (select created_by from public.groups where pin_id = pg_temp.pin_named('Pensão Amor')),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'and keeps the group'
);

-- A pin with no group is not joinable, and says so in the one sentence every
-- failure gets.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.admin();
insert into public.pins
  (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
values ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(),
        'Quiet pin', 'bar', 38.71, -9.14, current_date,
        now() + interval '24 hours');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Quiet pin')) $$,
  '42501',
  'That plan is not open to join any more.',
  'a message-me-first pin cannot be joined'
);

-- HARD RULE: THE AUDIENCE FILTER FOLLOWS THE PIN'S OWNER ------------------------
--
-- The founder's rule, and the thing most likely to be broken by a later
-- change: a pin is visible because of who POSTED it. Who has since joined
-- makes no difference in either direction.

select pg_temp.admin();
update public.profiles set verified = true, gender = 'woman'
  where user_id = '00000000-0000-0000-0000-00000000000d';
update public.profiles set verified = true, gender = 'woman'
  where user_id = '00000000-0000-0000-0000-00000000000e';

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select public.set_visibility('verified_women') $$,
  'a verified woman can narrow to verified women'
);
select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Ladies night', null, null, 'bar',
       38.7071, -9.1458, current_date, now() + interval '24 hours') $$,
  'and post a plan open to join'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Ladies night')) $$,
  'somebody her audience admits can join it'
);

-- Alice is unverified, so the narrowed owner's pin was never on her map.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Ladies night'),
  0,
  'a narrowed owner is invisible to somebody outside her audience'
);
select throws_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Ladies night')) $$,
  '42501',
  'That plan is not open to join any more.',
  'and a pin you cannot see is a pin you cannot join'
);

-- Now the reverse, which is the actual rule: a joiner OUTSIDE the audience
-- does not remove the pin from anybody's map, because the pin is not theirs.
select pg_temp.admin();
insert into public.room_members (chat_id, user_id, departure_date, expires_at)
values (pg_temp.chat_of('Pensão Amor'), '00000000-0000-0000-0000-00000000000d',
        null, 'infinity');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Pensão Amor'),
  1,
  'a narrowed traveler joining an open pin does not hide it from anybody'
);

-- WHAT THE MAP CARRIES ---------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select isnt(
  (select chat_id from public.city_pins(pg_temp.lisbon())
    where venue_name = 'Pensão Amor'),
  null,
  'the map says which pins are open to join'
);
select is(
  (select chat_id from public.city_pins(pg_temp.lisbon()) where venue_name = 'Quiet pin'),
  null,
  'and which are not'
);
select is(
  (select count(*)::int from public.pin_crew(pg_temp.pin_named('Pensão Amor'))),
  3,
  'and the pin can show who is already going, before you decide'
);
select ok(
  (select is_owner from public.pin_crew(pg_temp.pin_named('Pensão Amor')) limit 1),
  'with the person whose plan it is first'
);

-- THE CHAT OUTLIVES THE PIN ----------------------------------------------------

select pg_temp.admin();
delete from public.pins where venue_name = 'Pensão Amor';

select is(
  (select count(*)::int from public.groups
    where chat_id = (select chat_id from public.chats c
                      join public.groups g on g.chat_id = c.id
                     where g.name = 'Pensão Amor')),
  1,
  'the pin burns out and the conversation is still there'
);
select is(
  (select pin_id from public.groups where name = 'Pensão Amor'),
  null,
  'with nothing left pointing at a pin that no longer exists'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.is_room_member((select chat_id from public.groups where name = 'Pensão Amor')),
  'and the people in it are still in it'
);

-- PEOPLE YOU ALREADY KNOW ------------------------------------------------------

create function pg_temp.crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Pensão Amor' $$;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.shares_group_with('00000000-0000-0000-0000-00000000000a'),
  'the pinner and a joiner share a group'
);
select ok(
  not public.shares_group_with('00000000-0000-0000-0000-00000000000c'),
  'somebody who never joined is not somebody you know'
);
select is(
  (select count(*)::int from public.people_you_know(null)
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'so she is in your address book, with no phone number involved'
);
select is(
  (select count(*)::int from public.people_you_know('Cara')),
  0,
  'and a stranger is not, however you spell her name'
);
select is(
  (select count(*)::int from public.people_you_know('Ali')),
  1,
  'searching matches part of a name'
);

-- ADDING SOMEBODY, WITH NO LINK ------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.create_group('Second group', null) $$,
  'a second group, to add somebody to'
);
create function pg_temp.second() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Second group' $$;

select lives_ok(
  $$ select public.add_to_group(pg_temp.second(), '00000000-0000-0000-0000-00000000000b') $$,
  'somebody you share a group with can be added to another one'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.is_room_member(pg_temp.second()),
  'and they are in it'
);

select throws_ok(
  $$ select public.add_to_group(pg_temp.second(), '00000000-0000-0000-0000-00000000000c') $$,
  '42501',
  'You can only add people you have chatted with.',
  'a member cannot add a stranger: that would be a way past the say-hi gate'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select public.add_to_group(pg_temp.second(), '00000000-0000-0000-0000-00000000000d') $$,
  '42501',
  'That group is not open.',
  'and somebody outside the group cannot add anybody to it'
);

-- MESSAGING SOMEBODY YOU SHARE A GROUP WITH ------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.open_direct_chat(
       '00000000-0000-0000-0000-00000000000a', 'hey, good to meet you earlier') $$,
  'you can message somebody you are in a group with, with no hello to wait on'
);

create function pg_temp.dm() returns uuid language sql
security definer set search_path = public as $$
  select c.id from public.chats c
  join public.chat_participants a
    on a.chat_id = c.id and a.user_id = '00000000-0000-0000-0000-00000000000a'
  join public.chat_participants b
    on b.chat_id = c.id and b.user_id = '00000000-0000-0000-0000-00000000000b'
  where c.kind = 'direct'
$$;

select is(
  (select count(*)::int from public.messages where chat_id = pg_temp.dm()),
  1,
  'and the message you wrote is the first thing in it'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select public.open_direct_chat(
       '00000000-0000-0000-0000-00000000000a', 'hello there') $$,
  '42501',
  'You two are not in a group together yet.',
  'a stranger still has to say hi and be accepted'
);

-- HARD RULE 5: the first message is screened before anything exists.
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (select public.open_direct_chat(
     '00000000-0000-0000-0000-00000000000b', 'wanna fuck') ->> 'blocked'),
  'true',
  'a first message that fails moderation opens nothing at all (hard rule 5)'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.chats c
    join public.chat_participants a
      on a.chat_id = c.id and a.user_id = '00000000-0000-0000-0000-00000000000d'
    join public.chat_participants b
      on b.chat_id = c.id and b.user_id = '00000000-0000-0000-0000-00000000000b'
   where c.kind = 'direct'),
  0,
  'no chat, no participants, nothing to release later'
);

-- HARD RULE 4: handles wait for a real exchange -------------------------------
--
-- There was no accept here, so the accept-shaped unlock does not apply. What
-- replaces it is stricter than the tap it stands in for: both people have to
-- have actually said something.

select pg_temp.admin();
insert into public.social_handles (user_id, platform, handle)
values ('00000000-0000-0000-0000-00000000000a', 'instagram', 'alice');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  not public.handles_unlocked_for('00000000-0000-0000-0000-00000000000a'),
  'one message into a chat opened from a group does not unlock a handle'
);
select is(
  (select count(*)::int from public.social_handles
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'and the policy agrees: the handle is not readable (hard rule 4)'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.dm(), '00000000-0000-0000-0000-00000000000a', 'you too') $$,
  'she writes back'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.handles_unlocked_for('00000000-0000-0000-0000-00000000000a'),
  'now both have spoken, which is what an accept stood for'
);
select is(
  (select count(*)::int from public.social_handles
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'and the handle is readable'
);

-- A shared group on its own is still not a connection: hard rule 4 says an
-- accept, and being in the same room was never one.
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (select count(*)::int from public.social_handles
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'sharing a group with somebody does not unlock their handle'
);

select * from finish();
rollback;
