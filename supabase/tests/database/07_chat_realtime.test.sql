-- Messaging: member-only, frozen by blocks, deleted by unmatch; reports feed
-- the audit spine; pushes are queued server-side for the right recipients.
begin;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

update public.profiles set
  display_name = 'Traveler ' || right(user_id::text, 1), age = 25, home_country = 'US',
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

-- Alice & Bob overlap, request, accept -> chat. (The full Phase 2 loop.)
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 3, current_date + 13),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 8, current_date + 18);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'Pastel de nata tour?', 'bio') $$,
  'request sent'
);

-- Push: the recipient got a request notification.
reset role;
select is(
  (select count(*)::int from public.push_queue
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'pending request enqueues a push for the recipient'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.respond_to_message_request(
       (select id from public.message_requests where status = 'pending' limit 1), true) $$,
  'request accepted'
);

reset role;
select is(
  (select count(*)::int from public.push_queue
   where user_id = '00000000-0000-0000-0000-00000000000b'
     and (data ->> 'type') = 'accepted'),
  1,
  'acceptance enqueues a push for the sender'
);
select is(
  (select body from public.push_queue
   where user_id = '00000000-0000-0000-0000-00000000000b'
     and (data ->> 'type') = 'accepted'),
  'Connected with Traveler a. Your chat is open.',
  'accept push says Connected with {name}, same words as the in-app card'
);
-- chr(8212) is U+2014; spelled out so this file carries no em dash literal.
select is(
  (select count(*)::int from public.push_queue
   where body like '%' || chr(8212) || '%' or title like '%' || chr(8212) || '%'),
  0,
  'no queued push carries an em dash'
);

-- Messaging.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values ((select id from public.chats limit 1),
             '00000000-0000-0000-0000-00000000000a', 'Hey! Friday works?') $$,
  'member can send a message'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select body from public.messages limit 1),
  'Hey! Friday works?',
  'the other member reads it'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values ((select chat_id from public.chat_participants limit 1),
             '00000000-0000-0000-0000-00000000000a', 'spoofed') $$,
  '42501',
  null,
  'cannot send as someone else'
);

reset role;
select is(
  (select count(*)::int from public.push_queue
   where user_id = '00000000-0000-0000-0000-00000000000b'
     and (data ->> 'type') = 'message'),
  1,
  'a message enqueues a push for the other member only'
);
select is(
  (select data ->> 'kind' from public.push_queue
   where user_id = '00000000-0000-0000-0000-00000000000b'
     and (data ->> 'type') = 'message'),
  'direct',
  'a direct message push says which kind of conversation it belongs to'
);

-- Outsiders see nothing.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.messages),
  0,
  'non-members cannot read messages'
);
select throws_ok(
  $$ select count(*) from public.push_queue $$,
  '42501',
  null,
  'push queue is server-only'
);

-- Block freezes the chat: history readable, sending refused.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.messages),
  1,
  'history stays readable after a block (evidence for reports)'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values ((select chat_id from public.chat_participants limit 1),
             '00000000-0000-0000-0000-00000000000b', 'one more thing') $$,
  '42501',
  null,
  'no new messages into a blocked (closed) chat'
);
-- Nor can either member destroy the frozen history via unmatch.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.unmatch_chat((select id from public.chats limit 1)) $$,
  'cannot unmatch a closed conversation',
  'a closed chat''s evidence cannot be hard-deleted by unmatch'
);
reset role;
delete from public.blocks;
update public.chats set status = 'active';

-- Push tokens: a device token follows whoever registers it last.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[alice-device-1]') $$,
  'token registration works'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[alice-device-1]') $$,
  'shared-device re-registration reassigns the token'
);
reset role;
select is(
  (select user_id from public.push_tokens
   where token = 'ExponentPushToken[alice-device-1]'),
  '00000000-0000-0000-0000-00000000000b',
  'token now belongs to the second account'
);

-- Reports feed the audit spine.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, details, context)
     values ('00000000-0000-0000-0000-00000000000a',
             '00000000-0000-0000-0000-00000000000b',
             'harassment', 'kept pushing after I said no',
             'chat:' || (select id from public.chats limit 1)) $$,
  'report filed'
);
reset role;
select is(
  (select count(*)::int from public.moderation_events
   where entity_type = 'report' and action = 'filed'),
  1,
  'report is logged to moderation_events'
);

-- Unmatch deletes the chat for both.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.unmatch_chat((select id from public.chats limit 1)) $$,
  'member can unmatch'
);
select is((select count(*)::int from public.messages), 0, 'messages are gone');
reset role;
select is((select count(*)::int from public.chats), 0, 'chat row is gone');
select is(
  (select count(*)::int from public.message_requests where status = 'accepted'),
  1,
  'the request record survives (anti-re-pester rule intact)'
);

select * from finish();
rollback;
