-- Message requests: moderation before delivery (hard rule 5), sender-blind
-- decline (invariant 4), and accept -> chat -> social-handle unlock.
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

-- Alice has a social handle: the accept flow should unlock it for Bob.
insert into public.social_handles (user_id, platform, handle)
  values ('00000000-0000-0000-0000-00000000000a', 'instagram', 'alice.travels');

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
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Alice and Bob overlap in Lisbon; Cara has no trip at all.
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 3, current_date + 13),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 8, current_date + 18);

-- Send.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Your bio mentions street food — best pastel de nata in Lisbon?',
     'bio')) ->> 'delivered',
  'true',
  'clean first message is delivered'
);
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'hi again', 'bio') $$,
  'request already sent to this traveler',
  'one delivered request per pair, ever'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'hello!', 'bio') $$,
  'recipient unavailable',
  'requests require a real overlap'
);

-- Recipient inbox sees it; sender has no direct table read.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.message_requests where status = 'pending'),
  1,
  'recipient sees the pending request'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.message_requests),
  0,
  'sender has no direct row visibility'
);
select is(
  (select state from public.sent_requests() limit 1),
  'sent',
  'sender sees masked state via sent_requests()'
);

-- INVARIANT 4: decline changes nothing from the sender's perspective.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.respond_to_message_request(
     (select id from public.message_requests where status = 'pending' limit 1),
     false)) ->> 'accepted',
  'false',
  'recipient can decline'
);
select is(
  (select count(*)::int from public.message_requests where status = 'pending'),
  0,
  'declined request leaves the recipient inbox'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select state from public.sent_requests() limit 1),
  'sent',
  'decline is invisible to the sender (still just "sent")'
);
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'following up!', 'bio') $$,
  'request already sent to this traveler',
  're-sending after (invisible) decline is refused identically'
);

-- HARD RULE 5: flirty content is blocked before delivery, with audit + retry.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'you look so sexy in that photo', 'photo:0')) ->> 'blocked',
  'true',
  'flirtatious first message is blocked'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.message_requests
   where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'blocked message never reaches the recipient'
);
reset role;
select is(
  (select count(*)::int from public.moderation_events
   where entity_type = 'message_request' and action = 'blocked'),
  1,
  'blocked verdict is audit-logged'
);

-- The sender can rewrite and retry after a block…
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Fellow hiker! Which trail are you doing near Lisbon?', 'bio')) ->> 'delivered',
  'true',
  'rewritten message goes through after a block'
);

-- …and acceptance builds the chat that unlocks social handles.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.social_handles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'pre-accept: handles still hidden'
);
select isnt(
  (public.respond_to_message_request(
     (select id from public.message_requests where status = 'pending' limit 1),
     true)) ->> 'chat_id',
  null,
  'accept returns a chat id'
);
select is(
  (select count(*)::int from public.chat_participants
   where chat_id = (select chat_id from public.message_requests where status = 'accepted')),
  2,
  'both travelers are in the chat'
);
select is(
  (select count(*)::int from public.social_handles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'post-accept: the accepted chat unlocks the handle (hard rule 4 end-to-end)'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select state from public.sent_requests()
   where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'accepted',
  'sender sees acceptance (and only acceptance)'
);

-- Already connected: the reverse-direction request is refused before it can
-- mint a second chat.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'hello again', 'bio') $$,
  'already connected with this traveler',
  'no second request/chat once a chat exists'
);

-- Blocks sever in-flight requests: Cara -> Bob pending, then Bob blocks Cara.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(),
          current_date + 9, current_date + 17);
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Also around those dates — coffee?', 'bio')) ->> 'delivered',
  'true',
  'cara reaches bob while unblocked'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.message_requests where status = 'pending'),
  0,
  'blocking auto-declines the pending request'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select state from public.sent_requests()
   where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'sent',
  'the block-decline stays invisible to the sender'
);

-- Accept-time re-validation: even a request that sneaks into pending across
-- an existing block cannot form a chat.
reset role;
delete from public.message_requests
  where sender_id = '00000000-0000-0000-0000-00000000000c'
    and recipient_id = '00000000-0000-0000-0000-00000000000b';
insert into public.message_requests (sender_id, recipient_id, source, first_message)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b',
          'trip_match', 'race window message');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.respond_to_message_request(
       (select id from public.message_requests where status = 'pending' limit 1), true) $$,
  'request unavailable',
  'accepting across a block is refused at accept time'
);

-- Blocking a chat partner closes the chat and re-hides their handles.
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
reset role;
select is(
  (select status::text from public.chats limit 1),
  'closed',
  'blocking a chat partner closes the chat'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.social_handles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'closed chat re-hides the social handles (hard rule 4 after a block)'
);

-- Signed-out clients cannot touch the RPCs.
reset role;
set local role anon;
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'hi', null) $$,
  '42501',
  null,
  'anon cannot call send_message_request'
);

select * from finish();
rollback;
