-- Replying to one message, and the two ways that could leak.
--
-- Written as attacks. A reply pointer is a reference to another row, so the
-- questions are: can it point OUT of the conversation it was written in (which
-- would deliver a quoted line from a chat the readers are not in), and does the
-- quoted line respect the same membership test the messages do. The third case
-- is the one a client would get wrong quietly: a parent that has been taken
-- back keeps its id and must lose its words.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ab01', 'rosa@example.com'),
  ('00000000-0000-0000-0000-00000000ab02', 'ravi@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Rosa'
  where user_id = '00000000-0000-0000-0000-00000000ab01';

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

-- Read the chat id from `groups`: `chats` carries no select policy for room
-- members, so a helper joining it goes NULL the moment the suite becomes
-- `authenticated` (see the traps skill).
create function pg_temp.crew(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = p_name $$;

create function pg_temp.said(p_body text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.messages where body = p_body $$;

select pg_temp.login('00000000-0000-0000-0000-00000000ab01');
select lives_ok(
  $$ select public.create_group('Reply crew', (current_date + 30)::date) $$,
  'somebody starts a group'
);
select lives_ok(
  $$ select public.create_group('Other crew', (current_date + 30)::date) $$,
  'and a second one, which they are also in'
);

select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.crew('Reply crew'),
             '00000000-0000-0000-0000-00000000ab01', 'Rooftop at 9?') $$,
  'and says something in the first'
);
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.crew('Other crew'),
             '00000000-0000-0000-0000-00000000ab01', 'Anybody up for the museum?') $$,
  'and something else in the second'
);

-- THE ATTACK: A REPLY CANNOT REACH OUT OF ITS OWN CONVERSATION -----------------
--
-- Both chats here belong to the SAME person, so nothing about this is about
-- what they may read: it is about the quoted line being delivered to everybody
-- in the other room, who were never in the conversation it came from.

select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body, reply_to_message_id)
     values (pg_temp.crew('Reply crew'),
             '00000000-0000-0000-0000-00000000ab01', 'this quotes elsewhere',
             pg_temp.said('Anybody up for the museum?')) $$,
  'You can only reply to a message in this chat.',
  'a reply pointing at another chat''s message is refused'
);

select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body, reply_to_message_id)
     values (pg_temp.crew('Reply crew'),
             '00000000-0000-0000-0000-00000000ab01', 'I am in',
             pg_temp.said('Rooftop at 9?')) $$,
  'while a reply inside the conversation lands'
);

-- WHAT THE THREAD READS BACK ---------------------------------------------------

select is(
  (select reply_to_name from public.room_messages(pg_temp.crew('Reply crew'))
    where body = 'I am in'),
  'Rosa',
  'the quoted line names the parent sender by display name'
);
select is(
  (select reply_to_body from public.room_messages(pg_temp.crew('Reply crew'))
    where body = 'I am in'),
  'Rooftop at 9?',
  'and carries the parent''s words'
);

-- A PARENT THAT IS TAKEN BACK KEEPS ITS ID AND LOSES ITS WORDS -----------------

select lives_ok(
  $$ select public.unsend_message(pg_temp.said('Rooftop at 9?')) $$,
  'the parent is unsent'
);
select is(
  (select reply_to_body from public.room_messages(pg_temp.crew('Reply crew'))
    where body = 'I am in'),
  null,
  'the quoted line goes with it, rather than preserving a copy'
);
select isnt(
  (select reply_to_message_id from public.room_messages(pg_temp.crew('Reply crew'))
    where body = 'I am in'),
  null,
  'but the id survives, so the bubble still reads as an answer'
);

-- THE MEMBERSHIP TEST COVERS THE NEW COLUMNS TOO -------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ab02');
select is(
  (select count(*)::int from public.room_messages(pg_temp.crew('Reply crew'))),
  0,
  'a non-member reads nothing, quoted fields included'
);

select * from finish();
rollback;
