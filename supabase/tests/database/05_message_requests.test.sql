-- Message requests: moderation before delivery (hard rule 5), sender-blind
-- decline (invariant 4), and accept -> chat -> social-handle unlock.
begin;
select plan(56);

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

-- The card the recipient decides on carries the shared city and the shared
-- window. incoming_requests() is SECURITY INVOKER on purpose: it is Alice's
-- own trips_select_overlap policy reading Bob's trip, so there is no path
-- here that hands over travel plans the reader could not already read.
select is(
  (select overlap_city from public.incoming_requests()),
  'Lisbon',
  'the incoming hello names the city both travelers are in'
);
select is(
  (select overlap_start from public.incoming_requests()),
  current_date + 8,
  'the incoming hello carries the start of the window they share'
);
select is(
  (select overlap_end from public.incoming_requests()),
  current_date + 13,
  'the incoming hello carries the end of the window they share'
);

-- The attack, not the happy path: a hello from somebody whose travel plans
-- the reader is not allowed to read.
--
-- Cara IS in Lisbon while Alice is here, so the lateral join's own city and
-- date conditions would find her trip perfectly well. The ONLY thing that
-- stops it is Alice's trips_select_overlap policy, which also demands a
-- discoverable owner - and Cara has not finished onboarding, so she is not
-- one. That is exactly the difference between incoming_requests() being
-- SECURITY INVOKER and being DEFINER, which is why the setup is built this
-- way: this case used to leave Cara with no trip at all, so the lateral
-- found nothing either way and the assertion passed whether the gate was
-- there or not.
reset role;
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(),
          current_date + 4, current_date + 10);
update public.profiles set onboarding_completed_at = null
  where user_id = '00000000-0000-0000-0000-00000000000c';
insert into public.message_requests (sender_id, recipient_id, source, first_message)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a',
          'pin', 'Saw your pin at the miradouro. Going Thursday?');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.incoming_requests()
   where sender_id = '00000000-0000-0000-0000-00000000000c'),
  1,
  'a pin-sourced hello still reaches the inbox'
);
select is(
  (select count(*)::int from public.trips
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  0,
  'the recipient cannot read that sender trip at all: the policy is the gate'
);
select ok(
  (select overlap_city is null and overlap_start is null and overlap_end is null
     from public.incoming_requests()
    where sender_id = '00000000-0000-0000-0000-00000000000c'),
  'so the card leaks no city and no dates'
);
reset role;
delete from public.message_requests
  where sender_id = '00000000-0000-0000-0000-00000000000c'
    and recipient_id = '00000000-0000-0000-0000-00000000000a';
delete from public.trips where user_id = '00000000-0000-0000-0000-00000000000c';
update public.profiles set onboarding_completed_at = now()
  where user_id = '00000000-0000-0000-0000-00000000000c';

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.message_requests),
  0,
  'sender has no direct row visibility'
);
-- And the inbox answers about YOU. Bob sent this hello; the overlap columns
-- are not a back door to reading it from the other end.
select is(
  (select count(*)::int from public.incoming_requests()),
  0,
  'a hello addressed to somebody else is not in your inbox'
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

-- The accept push goes to the sender and says what happened, in the same
-- words as the in-app card: 'Connected with {name}. Your chat is open.'
-- Never 'replied', never an instruction to say hi again.
reset role;
select is(
  (select user_id from public.push_queue where data ->> 'type' = 'accepted' limit 1),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'accept push goes to the sender'
);
select is(
  (select title from public.push_queue where data ->> 'type' = 'accepted' limit 1),
  'Connected',
  'accept push title names the event the app already named'
);
select is(
  (select body from public.push_queue where data ->> 'type' = 'accepted' limit 1),
  'Connected with traveler. Your chat is open.',
  'accept push body matches the in-app card, no "replied", no "Say hi"'
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


-- A HELLO THAT NOBODY ANSWERS ENDS ------------------------------------------
--
-- request_status has declared 'expired' since the first migration and nothing
-- ever wrote it, so a pending hello sat in both lists for ever. The sweep
-- ends it, and the interesting half is what it takes with it.
--
-- At this point in the story: Bob -> Alice was DECLINED, Alice -> Bob was
-- ACCEPTED, and Cara -> Bob is still PENDING. sent_requests() masks a decline
-- as 'sent' precisely so a sender cannot tell silence from a no. If the sweep
-- expired only the pending rows, that mask would come off in one move: the
-- unanswered hellos would leave a sender's list and the declined ones would
-- still be sitting in it. So both arms have to go together, and the
-- assertions below are that attack, not the happy path.
reset role;
-- Past dates are refused by the trips trigger on purpose, and a trip that has
-- already ended is this sweep's entire subject.
alter table public.trips disable trigger trips_validate_dates;
update public.trips set start_date = current_date - 12, end_date = current_date - 2;
alter table public.trips enable trigger trips_validate_dates;
-- And the hellos went out while those trips were still running, which is the
-- only way a hello is ever sent. The sweep clocks off the trips a hello could
-- have been ABOUT, so one stamped today against a trip that ended a week ago
-- would be measured against nothing and fall to the thirty-day fallback.
update public.message_requests set created_at = now() - interval '8 days';

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.incoming_requests()),
  1,
  'before the sweep, the unanswered hello is still waiting on bob'
);

reset role;
select is(
  public.expire_message_requests(),
  2,
  'the sweep ends the unanswered hello and the declined one, and nothing else'
);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000c'),
  'expired',
  'a hello nobody answered is expired once the sender has left'
);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000b'
      and recipient_id = '00000000-0000-0000-0000-00000000000a'),
  'expired',
  'a DECLINED hello expires on the same clock, so a no cannot be told from silence'
);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000a'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'accepted',
  'an accepted hello is untouched: it is a chat now'
);

-- Both lists are clear.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.incoming_requests()),
  0,
  'an expired hello leaves the recipient inbox'
);

-- The sender's view learns that it ended, and does NOT learn a new word for
-- it. An over-the-air update is never applied on the launch that downloads
-- it, so for at least one launch every phone runs the PREVIOUS bundle
-- against this schema: a sixth `state` would land in code that has never
-- heard of one, whose already-sent guard would then answer "nothing is out
-- to this traveler" and offer a second Say hi the unique constraint refuses.
-- So `state` keeps its vocabulary and `expired_at` carries the fact.
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000a'),
  'sent',
  'the declined hello still reads sent to its sender: never declined, never a new state'
);
select ok(
  (select expired_at is not null from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000a'),
  'and it carries the stamp that says it has run out'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'sent',
  'the unanswered hello reads exactly the same word to ITS sender'
);
select ok(
  (select expired_at is not null from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'and exactly the same stamp, so a no still cannot be told from silence'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'accepted',
  'and the accepted one still reads accepted'
);
select ok(
  (select expired_at is null from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'with nothing stamped on it'
);

-- Expiry is not a withdraw. unique(sender_id, recipient_id) is one shot per
-- direction, ever, and freeing it would turn this into the pester loop the
-- constraint exists to close.
reset role;
select throws_ok(
  $$ insert into public.message_requests (sender_id, recipient_id, source, first_message)
     values ('00000000-0000-0000-0000-00000000000c',
             '00000000-0000-0000-0000-00000000000b', 'trip_match', 'again then') $$,
  '23505',
  null,
  'expiry does not free the anti-pester constraint'
);

-- Server-only. A sender calling this on their own rows would be a withdraw.
set local role authenticated;
select throws_ok(
  $$ select public.expire_message_requests() $$,
  '42501',
  null,
  'no client can run the sweep'
);
reset role;


-- A TRIP IN DECEMBER DOES NOT HOLD A SEPTEMBER HELLO OPEN ------------------
--
-- The sweep used to clock off max(end_date) over EVERY active trip the
-- sender had, so one trip far enough out postponed every hello they had ever
-- sent until it ended - and a hello from a pin, sent by somebody whose only
-- trip had already finished, expired on the day it was written. It now
-- counts only the trips the hello could have been about: still running when
-- it was sent, and starting inside the horizon matching itself works to
-- (current_date + 180, get_matches').
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com');
update public.profiles set
  display_name = 'traveler', age = 31, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now()
  where user_id = '00000000-0000-0000-0000-00000000000d';
insert into public.trips (user_id, city_id, start_date, end_date)
  values ('00000000-0000-0000-0000-00000000000d', pg_temp.lisbon(),
          current_date + 300, current_date + 310);
insert into public.message_requests
  (sender_id, recipient_id, source, first_message, created_at)
  values ('00000000-0000-0000-0000-00000000000d',
          '00000000-0000-0000-0000-00000000000a', 'pin',
          'Saw your pin ages ago. Still around?', now() - interval '60 days');
select is(
  (select count(*)::int from public.trips
    where user_id = '00000000-0000-0000-0000-00000000000d'
      and status = 'active' and end_date >= current_date),
  1,
  'the far-future trip is live, so the old max(end_date) clock held that hello open into next year'
);
select is(
  public.expire_message_requests(),
  1,
  'a trip 300 days out does not postpone a hello sent two months ago'
);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000d'),
  'expired',
  'it ends on the thirty-day fallback instead, still read off the sender own dates'
);

-- AND THE CAP ITSELF, which the case above does not reach: that trip is
-- excluded by the horizon, so it proves the horizon clause and would pass
-- without the thirty-day term. The uncovered shape is a trip INSIDE the
-- horizon that simply runs long - a two-month stay, or a trip added after
-- the hello went out - which the trip clause alone would let hold a hello
-- open for as long as the calendar says.
reset role;
insert into public.trips (user_id, city_id, start_date, end_date, status)
  values ('00000000-0000-0000-0000-00000000000d',
          (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
          current_date, current_date + 60, 'active');
insert into public.message_requests
  (sender_id, recipient_id, source, first_message, created_at)
  values ('00000000-0000-0000-0000-00000000000d',
          '00000000-0000-0000-0000-00000000000b', 'pin',
          'Sent this over a month ago now.', now() - interval '40 days');
select is(
  (select count(*)::int from public.trips
    where user_id = '00000000-0000-0000-0000-00000000000d'
      and status = 'active'
      and start_date <= (current_date - 40) + 180
      and end_date >= current_date),
  1,
  'the trip qualifies on the horizon, so the trip clause alone would hold this hello 60 more days'
);
select is(
  public.expire_message_requests(),
  1,
  'the thirty-day cap ends it anyway: a hello nobody answered in a month is over'
);

select * from finish();
rollback;
