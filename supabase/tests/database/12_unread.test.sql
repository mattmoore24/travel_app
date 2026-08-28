-- Unread state: what my_chats() counts, and what it must never count.
--
-- The badge on the Chat tab is the app's loudest claim, so it gets the
-- strictest rules: it may only ever mean "a human wrote to you and it has
-- cleared moderation". Everything below is one of the ways that could
-- quietly stop being true.
begin;
select plan(27);

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

create function pg_temp.unread(p_chat uuid) returns int language sql as
  $$ select unread_count from public.my_chats() where chat_id = p_chat $$;

insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 3, current_date + 13),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 8, current_date + 18);

-- Bob says hi, Alice accepts: now there is a chat.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.send_message_request(
  '00000000-0000-0000-0000-00000000000a', 'trip_match',
  'Your bio mentions street food, best pastel de nata in Lisbon?', 'bio');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.respond_to_message_request(
  (select id from public.message_requests where status = 'pending' limit 1), true);

-- Captured with RLS out of the way: message_requests is deliberately
-- invisible to the sender, so a plain lookup would return null the moment the
-- test logs in as Bob.
select pg_temp.admin();
create temp table t_chat as
  select chat_id as id from public.message_requests where status = 'accepted' limit 1;
grant select on pg_temp.t_chat to public;

create function pg_temp.chat() returns uuid language sql as
  $$ select id from pg_temp.t_chat $$;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- A brand new chat has nothing unread: the one message in it is the request
-- the recipient just read in order to accept it.
select is(pg_temp.unread(pg_temp.chat()), 0, 'a freshly accepted chat is not unread');

-- THE ANCHOR ---------------------------------------------------------------
--
-- The first message is a reply to something specific on the profile, and the
-- accepted chat has to be able to say what.

select is(
  (select first_message_element from public.my_chats() where chat_id = pg_temp.chat()),
  'bio',
  'the accepted chat remembers what the hello answered'
);
select is(
  (select first_message from public.my_chats() where chat_id = pg_temp.chat()),
  'Your bio mentions street food, best pastel de nata in Lisbon?',
  'along with the hello itself'
);

-- COUNTING -----------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
-- clock_timestamp() throughout: pgTAP runs the whole file in one
-- transaction, so every now() is the same instant and nothing would ever be
-- "after" anything else.
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000b',
          'Landing Tuesday!', clock_timestamp());

select is(pg_temp.unread(pg_temp.chat()), 0, 'your own message is never unread to you');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 1, 'the recipient sees one unread');

select is(
  (select last_message from public.my_chats() where chat_id = pg_temp.chat()),
  'Landing Tuesday!',
  'and the row previews it'
);

-- READING ------------------------------------------------------------------

select isnt(public.mark_chat_read(pg_temp.chat()), null, 'a member can mark a chat read');
select is(pg_temp.unread(pg_temp.chat()), 0, 'reading clears the count');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000b',
          'Where are you staying?', clock_timestamp());
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 1, 'a later message is unread again');

-- The mark never moves backwards, so a stale call from a screen that has
-- since been left cannot resurrect messages the user has already seen.
select pg_temp.admin();
update public.chat_prefs set last_read_at = clock_timestamp() + interval '1 hour'
  where chat_id = pg_temp.chat() and user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.mark_chat_read(pg_temp.chat());
select ok(
  (select last_read_at from public.chat_prefs
    where chat_id = pg_temp.chat()
      and user_id = '00000000-0000-0000-0000-00000000000a') > clock_timestamp(),
  'mark_chat_read never moves the mark backwards'
);

-- WHAT MUST NOT COUNT ------------------------------------------------------

select pg_temp.admin();
update public.chat_prefs set last_read_at = clock_timestamp() - interval '1 day'
  where chat_id = pg_temp.chat() and user_id = '00000000-0000-0000-0000-00000000000a';

-- A message the sender withdrew.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.unsend_message(
  (select id from public.messages where body = 'Where are you staying?'));
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 1, 'an unsent message stops being unread');
select is(
  (select last_message from public.my_chats() where chat_id = pg_temp.chat()),
  'Landing Tuesday!',
  'and the row falls back to the last message that still exists'
);

-- A message a moderator took down.
select pg_temp.admin();
update public.messages set removed_at = now()
  where body = 'Landing Tuesday!';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 0, 'a removed message stops being unread');

-- HARD RULE 5: a photo still in the moderation queue is not delivered, so it
-- cannot be counted or previewed either.
select pg_temp.admin();
insert into public.messages (chat_id, sender_id, image_path, moderation_status, created_at)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000b',
          'chat/pending.jpg', 'pending', clock_timestamp());
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 0, 'a photo awaiting moderation is not unread');
select is(
  (select last_message from public.my_chats() where chat_id = pg_temp.chat()),
  null,
  'and it is not previewed before it clears'
);

select pg_temp.admin();
update public.messages set moderation_status = 'approved'
  where image_path = 'chat/pending.jpg';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(pg_temp.unread(pg_temp.chat()), 1, 'once approved it counts');
select is(
  (select last_message from public.my_chats() where chat_id = pg_temp.chat()),
  'Photo',
  'and it previews as a photo'
);

-- JOINING LATE -------------------------------------------------------------
--
-- Walking into a hostel room with months of backlog must not arrive as
-- months of unread: the baseline falls back to when you joined.

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.create_group('Hostel crew', (current_date + 30)::date);

create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Hostel crew' $$;

insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000b',
          'anyone up for tapas', clock_timestamp());

select pg_temp.admin();
insert into public.room_members (chat_id, user_id, departure_date, expires_at, joined_at)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000c',
          current_date + 5, clock_timestamp() + interval '5 days', clock_timestamp());

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(pg_temp.unread(pg_temp.crew()), 0, 'joining a room does not import its backlog');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000b',
          'meeting at 8', clock_timestamp());
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(pg_temp.unread(pg_temp.crew()), 1, 'but what arrives after you do is unread');

-- WHO MAY MARK -------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  format($$ select public.mark_chat_read(%L) $$, pg_temp.chat()),
  'chat not found',
  'a stranger cannot mark somebody else''s chat read'
);

select pg_temp.guest();
select throws_ok(
  format($$ select public.mark_chat_read(%L) $$, pg_temp.chat()),
  '42501',
  'permission denied for function mark_chat_read',
  'anon cannot call mark_chat_read'
);

-- MUTE, PUSH, AND WHAT A ROOM SHOWS ----------------------------------------
--
-- Three things the newer features never told the older ones about, all fixed
-- in 20260828140000.

-- 1. Mute is a promise about the PHONE, not just the badge. enqueue_message_push
-- had no mute test on its direct arm at all, and read room_members.muted on its
-- room arm - a column `authenticated` cannot write. The bell a person can
-- actually press writes chat_prefs, which is also what my_chats reads back.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_chat_pref(pg_temp.chat(), null, true, null);
select pg_temp.admin();
delete from public.push_queue;
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000b',
          'while muted', clock_timestamp());
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'a muted chat does not queue a push'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_chat_pref(pg_temp.chat(), null, false, null);
select pg_temp.admin();
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000b',
          'and after unmuting', clock_timestamp());
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'and unmuting it starts the phone ringing again'
);

-- The same bell in a group, where the old arm read a column nobody could set.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select public.set_chat_pref(pg_temp.crew(), null, true, null);
select pg_temp.admin();
delete from public.push_queue;
insert into public.messages (chat_id, sender_id, body, created_at)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000b',
          'group noise', clock_timestamp());
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  0,
  'and a muted group is quiet too'
);

-- 2. room_messages predates unsend. It returned a withdrawn message with a
-- null body, removed = false and no flag at all, so the thread drew an empty
-- bubble under the sender's name - for everyone, permanently.
select pg_temp.admin();
create temp table t_unsent as
  select id from public.messages
   where chat_id = pg_temp.crew() and body = 'group noise' limit 1;
grant select on pg_temp.t_unsent to public;
update public.messages
   set unsent_at = now(), body = null, image_path = null
 where id = (select id from pg_temp.t_unsent);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select isnt(
  (select unsent_at from public.room_messages(pg_temp.crew())
    where id = (select id from pg_temp.t_unsent)),
  null,
  'a room reports a withdrawn message as withdrawn'
);
select is(
  (select removed from public.room_messages(pg_temp.crew())
    where id = (select id from pg_temp.t_unsent)),
  false,
  'and does not confuse withdrawing it with a moderator removing it'
);

-- 3. message_requests is unique on (sender, recipient), not on chat, so two
-- people who both said hi before either accepted have two rows pointing at one
-- chat - and the left join returned the conversation twice, with the same key.
select pg_temp.admin();
insert into public.message_requests
  (chat_id, sender_id, recipient_id, source, first_message, status)
  values (pg_temp.chat(), '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-00000000000b', 'trip_match', 'hi back', 'accepted');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.my_chats() where chat_id = pg_temp.chat()),
  1,
  'a chat with a hello in both directions is still one row in the list'
);

select * from finish();
rollback;
