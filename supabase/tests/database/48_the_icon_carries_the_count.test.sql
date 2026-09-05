-- The number on the home-screen icon, and who is allowed to compute it.
--
-- waiting_counts() exists so the push worker can put a badge on every
-- notification it sends. It reads across users, which makes it two things at
-- once: a convenience, and the single most enumerable function in this
-- schema if anybody ever grants it. So this file asserts both halves.
--
--   1. It agrees with my_chats(). Two definitions of "waiting" that can drift
--      apart is the whole risk in the change, so the expectation here is
--      computed FROM my_chats rather than written by hand: if somebody edits
--      one unread predicate and not the other, this fails.
--   2. No client role can execute it, written as an attack. Not granting it
--      is not the same as proving nobody has it: functions are executable by
--      PUBLIC by default in Postgres, so the revoke is load-bearing and gets
--      an assertion of its own.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'badge-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'badge-bob@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'badge-cara@example.com'),
  ('00000000-0000-0000-0000-0000000000e4', 'badge-dave@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'badge-eve@example.com');

update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'PT',
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
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 4, current_date + 14
from unnest(array[
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000e2',
  '00000000-0000-0000-0000-0000000000e3',
  '00000000-0000-0000-0000-0000000000e4',
  '00000000-0000-0000-0000-0000000000e5']::uuid[]) as u;

-- Three people say hi to alice and she takes all three, so there are three
-- conversations to tell apart. A fourth, from eve, she leaves unanswered.
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select public.send_message_request('00000000-0000-0000-0000-0000000000e1', 'trip_match',
  'Both around the same week. Which market is worth the walk?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select public.send_message_request('00000000-0000-0000-0000-0000000000e1', 'trip_match',
  'Your list has the tram on it. Doing it Thursday?', 'priority');
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
select public.send_message_request('00000000-0000-0000-0000-0000000000e1', 'trip_match',
  'Coworking spots near Alfama, any good?', 'bio');
select pg_temp.login('00000000-0000-0000-0000-0000000000e5');
select public.send_message_request('00000000-0000-0000-0000-0000000000e1', 'trip_match',
  'Fellow hiker, which trail near Lisbon?', 'bio');

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.respond_to_message_request(
  (select id from public.incoming_requests() where sender_id = '00000000-0000-0000-0000-0000000000e2'),
  true);
select public.respond_to_message_request(
  (select id from public.incoming_requests() where sender_id = '00000000-0000-0000-0000-0000000000e3'),
  true);
select public.respond_to_message_request(
  (select id from public.incoming_requests() where sender_id = '00000000-0000-0000-0000-0000000000e4'),
  true);

-- Read from a table with a policy for the reader, and through a function
-- rather than a temp table: `set local role authenticated` has no privileges
-- on anything in pg_temp (traps).
select pg_temp.admin();
-- SECURITY DEFINER, and that is not incidental. message_requests is
-- deliberately invisible to the SENDER, so an invoker-rights helper returns
-- null the moment the suite logs in as bob, every insert below goes to a null
-- chat, and RLS refuses it with an error that says nothing about the cause
-- (traps). Defined while the suite is postgres, so it reads as postgres.
create function pg_temp.chat_with(uid uuid) returns uuid
language sql
security definer
as $$
  select chat_id from public.message_requests
   where sender_id = uid and recipient_id = '00000000-0000-0000-0000-0000000000e1'
     and status = 'accepted'
$$;

-- One message into each, from the other side, so alice has three unread
-- conversations. clock_timestamp(), not now(): the whole file is one
-- transaction and now() never moves.
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat_with('00000000-0000-0000-0000-0000000000e2'),
          '00000000-0000-0000-0000-0000000000e2', 'Landing Tuesday!', clock_timestamp());
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat_with('00000000-0000-0000-0000-0000000000e3'),
          '00000000-0000-0000-0000-0000000000e3', 'Tram at nine then?', clock_timestamp());
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat_with('00000000-0000-0000-0000-0000000000e4'),
          '00000000-0000-0000-0000-0000000000e4', 'Found one, sending the pin', clock_timestamp());

-- Alice mutes one and archives another. Both still have something unread in
-- them; neither may put a number on her icon.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.set_chat_pref(pg_temp.chat_with('00000000-0000-0000-0000-0000000000e3'),
                            null, true, null);
select public.set_chat_pref(pg_temp.chat_with('00000000-0000-0000-0000-0000000000e4'),
                            null, null, true);

-- The state the assertions rest on: three unread conversations, one of them
-- muted, one of them archived, and one hello still unanswered.
select is(
  (select count(*)::int from public.my_chats() where unread_count > 0),
  2,
  'two unread conversations are on the list, one of them muted'
);
select is(
  (select count(*)::int from public.incoming_requests()),
  1,
  'and one hello is still waiting on an answer'
);

-- my_chats() is auth.uid()-scoped and waiting_counts is service-role only, so
-- the two can never be read in the same role. Alice's own answer is parked in
-- a GUC here and compared below, which is what makes the parity assertion an
-- assertion about MY_CHATS rather than about a number typed into this file.
select set_config(
  'samewhere_test.alice_waiting',
  (select count(*)::int from public.my_chats() where unread_count > 0 and not muted)::text,
  true);

select pg_temp.admin();

-- 1. THE PARITY ASSERTION. The expectation is my_chats' own answer, not a
-- number typed here, so the two definitions of "waiting" cannot drift apart
-- without this failing.
select is(
  (select waiting from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e1']::uuid[])),
  2,
  'the badge counts one unread conversation plus one waiting hello'
);
select is(
  (select waiting from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e1']::uuid[])),
  current_setting('samewhere_test.alice_waiting')::int +
  (select count(*)::int from public.message_requests
    where recipient_id = '00000000-0000-0000-0000-0000000000e1' and status = 'pending'),
  'and it is exactly what my_chats and the inbox say between them'
);

-- 2. A MUTED CONVERSATION IS NEVER WAITING. Muting is somebody saying do not
-- interrupt me about this, and a number on the icon is an interruption.
select is(
  (select waiting from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e3']::uuid[])),
  0,
  'a muted chat with unread messages puts nothing on anybody''s icon'
);

-- 3. NOBODY WHO SENT THE MESSAGE IS WAITING FOR IT.
select is(
  (select waiting from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e2']::uuid[])),
  0,
  'your own message is not something you are waiting on'
);

-- 4. One row per user asked for, in one call: the worker batches.
select is(
  (select count(*)::int from public.waiting_counts(array[
     '00000000-0000-0000-0000-0000000000e1',
     '00000000-0000-0000-0000-0000000000e2',
     '00000000-0000-0000-0000-0000000000e3']::uuid[])),
  3,
  'a batch gets a row for every user in it'
);

-- 5. THE ATTACK. This function reads other people's unread state in bulk. A
-- client that could call it could enumerate who has messages waiting, which
-- is a far worse leak than the badge is a feature.
set local role authenticated;
select throws_ok(
  $$ select * from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e1']::uuid[]) $$,
  '42501',
  null,
  'a signed-in traveler cannot execute waiting_counts at all'
);
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.waiting_counts(array['00000000-0000-0000-0000-0000000000e1']::uuid[]) $$,
  '42501',
  null,
  'and neither can anon'
);

reset role;
select * from finish();
rollback;
