-- Trust & safety (Phase 5): the LLM moderation hold on first messages (hard
-- rule 5), verdict RPC privileges, the strike ladder (warn -> suspend -> ban),
-- standing gates on suspended/banned senders, the photo moderation flag, the
-- selfie verification flow, and the admin report queue.
begin;
select plan(75);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com');

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

-- Back to postgres AND clear the JWT claims GUC — the verdict/admin RPCs
-- runtime-guard on auth.role(), which would otherwise still read the last
-- login's claims.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Everyone overlaps in Lisbon so requests are legitimate.
insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 10, current_date + 20
from unnest(array[
  '00000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-00000000000b',
  '00000000-0000-0000-0000-00000000000c',
  '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0000-00000000000e']::uuid[]) as u;

-- Baseline with the LLM flag OFF: Phase 2-4 behavior, and an accepted chat
-- for the later suspension gates.
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Fellow early riser — sunrise hike while we overlap?', 'bio')) ->> 'delivered',
  'true',
  'flag off: clean message delivers directly'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.respond_to_message_request(
     (select id from public.message_requests where status = 'pending' limit 1),
     true)) ->> 'accepted',
  'true',
  'recipient accepts -> chat opens'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     select chat_id, '00000000-0000-0000-0000-00000000000e', 'see you there!'
     from public.chat_participants
     where user_id = '00000000-0000-0000-0000-00000000000e' limit 1 $$,
  'member in good standing can send chat messages'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000e', 'trip_match',
     'Your food pics are a whole itinerary — market tour?', 'photo:0')) ->> 'delivered',
  'true',
  'flag off: second baseline request delivers'
);

-- app_config is server-only.
select throws_ok(
  $$ select * from public.app_config $$,
  '42501',
  null,
  'clients cannot read app_config'
);

-- HARD RULE 5, LLM stage: flip the flag on.
select pg_temp.admin();
update public.app_config set value = 'true'::jsonb where key = 'require_llm_moderation';

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Which miradouro wins at sunset? Asking for my trip notes.', 'bio')) ->> 'queued',
  'true',
  'flag on: clean message is HELD for classification, not delivered'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'held request is invisible to the recipient'
);
select is(
  (select count(*)::int from public.incoming_requests()),
  0,
  'held request does not appear in the inbox RPC'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000a'),
  'sent',
  'sender sees a held request as plain sent (masked)'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000a'
      and title = 'New message request'),
  1,
  'no request push while the message is held (only the earlier baseline push)'
);

-- Verdict application is service-role only.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.apply_message_verdict(
       (select gen_random_uuid()), '{"action":"allow"}'::jsonb) $$,
  '42501',
  null,
  'clients cannot execute apply_message_verdict'
);

select pg_temp.admin();
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000b'
      and recipient_id = '00000000-0000-0000-0000-00000000000a'),
  '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000b' and status = 'pending'),
  1,
  'allow verdict releases the request to the recipient'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000a'
      and title = 'New message request'),
  2,
  'release enqueues the request push'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000b'
      and action = 'llm_approved'),
  1,
  'allow verdict is audit-logged'
);
select throws_ok(
  $$ select public.apply_message_verdict(
       (select id from public.message_requests
         where sender_id = '00000000-0000-0000-0000-00000000000b'
           and recipient_id = '00000000-0000-0000-0000-00000000000a'),
       '{"action":"allow"}'::jsonb) $$,
  'request is not awaiting moderation',
  'verdicts only apply to held requests'
);

-- A block filed while the message is held severs it.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Overlapping in Lisbon — pastel crawl?', 'bio')) ->> 'queued',
  'true',
  'cara''s message is held'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.blocks (blocker_id, blocked_id) values
     ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c') $$,
  'recipient blocks the sender while the message is held'
);
select pg_temp.admin();
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000c'
      and recipient_id = '00000000-0000-0000-0000-00000000000a'),
  'declined',
  'block severs a held request before any verdict lands'
);

-- Belt and braces: even if a held row survived to the verdict, release
-- re-checks the pair. (Recipient turns invisible -> silent decline.)
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Saw you are around the same dates — coworking recs?', 'bio')) ->> 'queued',
  'true',
  'dave''s message is held'
);
select pg_temp.admin();
update public.users set status = 'shadowbanned'
  where id = '00000000-0000-0000-0000-00000000000b';
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000d'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'),
  '{"action":"allow","category":"ok"}'::jsonb);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000d'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'declined',
  'an allow verdict re-checks the pair and declines instead of delivering'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000d'
      and action = 'release_declined'),
  1,
  'silent release-decline is audit-logged'
);
update public.users set status = 'active'
  where id = '00000000-0000-0000-0000-00000000000b';

-- LLM block: strike + sender feedback, then rewrite-and-retry.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Coffee while our trips overlap?', 'bio')) ->> 'queued',
  'true',
  'cara''s message to bob is held'
);
select pg_temp.admin();
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000c'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'),
  '{"action":"block","category":"flirtation","engine":"claude-moderator"}'::jsonb);
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000c'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'blocked_by_moderation',
  'block verdict lands as blocked_by_moderation'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-00000000000b'),
  'blocked',
  'sender sees the moderation block as their own feedback'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000c'
      and action = 'llm_blocked'),
  1,
  'LLM block is audit-logged as a strike action'
);
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c'
      and title = 'Message not delivered'),
  1,
  'sender is notified their message was not delivered'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Rewrote this: any coworking cafe tips for Lisbon?', 'bio')) ->> 'queued',
  'true',
  'a blocked message can be rewritten and resent'
);
select pg_temp.admin();
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000c'
      and recipient_id = '00000000-0000-0000-0000-00000000000b'
      and status = 'pending_moderation'),
  '{"action":"block","category":"moderation_unavailable","engine":"failsafe"}'::jsonb);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000c'
      and action = 'blocked_failsafe'),
  1,
  'failsafe block is logged under its own non-strike action'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000c'
      and action in ('blocked', 'llm_blocked', 'photo_rejected', 'admin_strike')),
  1,
  'failsafe block did NOT add a strike (still just the real one)'
);

-- Flag back off: direct delivery returns.
update public.app_config set value = 'false'::jsonb where key = 'require_llm_moderation';
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Tram 28 or just walk everything?', 'bio')) ->> 'delivered',
  'true',
  'flag off again: messages deliver directly'
);

-- Shadowban suppression: a shadowbanned sender is told "delivered", but the
-- row lands declined and the recipient gets no push, no inbox entry, nothing.
select pg_temp.admin();
update public.users set status = 'shadowbanned'
  where id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000c', 'trip_match',
     'Any coworking cafe tips?', 'bio')) ->> 'delivered',
  'true',
  'shadowbanned sender is shown normal delivery feedback'
);
select pg_temp.admin();
select is(
  (select status::text from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000d'
      and recipient_id = '00000000-0000-0000-0000-00000000000c'),
  'declined',
  'shadowbanned sender''s request is silently suppressed'
);
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c'
      and title = 'New message request'),
  0,
  'no push ever reaches the recipient of a suppressed request'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000d'
      and action = 'shadowban_suppressed'),
  1,
  'suppression is audit-logged'
);
update public.users set status = 'active'
  where id = '00000000-0000-0000-0000-00000000000d';

-- Strike ladder: 3 -> warning, 5 -> suspension, 7 -> ban.
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000e'
      and action = 'warning_issued'),
  1,
  'third strike issues exactly one warning'
);
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-00000000000e'),
  'active',
  'a warning does not change account status'
);
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000e'
      and title = 'Community guidelines warning'),
  1,
  'warning is pushed to the user'
);
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-00000000000e'),
  'suspended',
  'fifth strike suspends the account'
);
select is(
  (select suspended_until > now() from public.users
    where id = '00000000-0000-0000-0000-00000000000e'),
  true,
  'suspension carries an expiry timestamp'
);

-- Suspended accounts are cut off at the DB layer.
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000d', 'trip_match', 'hi!', 'bio') $$,
  'account suspended',
  'suspended sender cannot send message requests'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     select chat_id, '00000000-0000-0000-0000-00000000000e', 'hello?'
     from public.chat_participants
     where user_id = '00000000-0000-0000-0000-00000000000e' limit 1 $$,
  '42501',
  null,
  'suspended sender cannot send chat messages (RLS)'
);
select throws_ok(
  $$ select public.respond_to_message_request(
       (select id from public.message_requests
         where recipient_id = '00000000-0000-0000-0000-00000000000e'
           and status = 'pending'), true) $$,
  'account suspended',
  'suspended recipient cannot accept requests'
);

-- Suspensions lift on schedule.
select pg_temp.admin();
update public.users set suspended_until = now() - interval '1 minute'
  where id = '00000000-0000-0000-0000-00000000000e';
select is(
  (select public.lift_expired_suspensions() >= 1),
  true,
  'lift_expired_suspensions clears expired suspensions'
);
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-00000000000e'),
  'active',
  'account is active again after the suspension expires'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     select chat_id, '00000000-0000-0000-0000-00000000000e', 'back!'
     from public.chat_participants
     where user_id = '00000000-0000-0000-0000-00000000000e' limit 1 $$,
  'reinstated account can chat again'
);
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
  values ('00000000-0000-0000-0000-00000000000e', 'user',
          '00000000-0000-0000-0000-00000000000e', 'admin_strike', 'test');
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-00000000000e'),
  'banned',
  'seventh strike bans the account'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000e'
      and action = 'banned'),
  1,
  'ban is audit-logged'
);

-- Photo moderation flag: uploads hold at pending until a verdict.
update public.app_config set value = 'true'::jsonb where key = 'require_photo_moderation';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.profile_photos (user_id, storage_path, position) values
  ('00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-00000000000b/one.jpg', 0),
  ('00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-00000000000b/two.jpg', 1);
select is(
  (select count(*)::int from public.profile_photos
    where user_id = '00000000-0000-0000-0000-00000000000b'
      and moderation_status = 'pending'),
  2,
  'flag on: new photos hold at pending'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000b'
      and entity_type = 'profile_photo' and action = 'queued_for_llm'),
  2,
  'held photos are audit-logged as queued'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.profile_photos
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'pending photos are invisible to other users'
);
select throws_ok(
  $$ select public.apply_photo_verdict(gen_random_uuid(), '{"action":"allow"}'::jsonb) $$,
  '42501',
  null,
  'clients cannot execute apply_photo_verdict'
);
select pg_temp.admin();
select public.apply_photo_verdict(
  (select id from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-00000000000b/one.jpg'),
  '{"action":"block","category":"suggestive","engine":"claude-moderator"}'::jsonb);
select is(
  (select moderation_status::text from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-00000000000b/one.jpg'),
  'rejected',
  'photo block verdict rejects the photo'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000b'
      and action = 'photo_rejected'),
  1,
  'photo rejection is a logged strike action'
);
select public.apply_photo_verdict(
  (select id from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-00000000000b/two.jpg'),
  '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.profile_photos
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'approved photo becomes visible to others; rejected stays hidden'
);

-- Selfie verification flow.
-- No approved profile photo -> refused up front (an auto-reject later would
-- silently burn one of the 3 daily attempts).
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
insert into storage.objects (bucket_id, name) values
  ('verification-selfies', '00000000-0000-0000-0000-00000000000d/selfie.jpg');
select throws_ok(
  $$ select public.submit_verification(
       '00000000-0000-0000-0000-00000000000d/selfie.jpg') $$,
  'add a profile photo before verifying',
  'verification requires an approved profile photo to compare against'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('verification-selfies', '00000000-0000-0000-0000-00000000000b/selfie.jpg') $$,
  'owner can upload a selfie into their own folder'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('verification-selfies', '00000000-0000-0000-0000-00000000000b/fake.jpg') $$,
  '42501',
  null,
  'nobody can upload into another user''s selfie folder'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.submit_verification(
     '00000000-0000-0000-0000-00000000000b/selfie.jpg')) ->> 'status',
  'pending',
  'submitting a selfie opens a pending verification request'
);
select throws_ok(
  $$ select public.submit_verification(
       '00000000-0000-0000-0000-00000000000b/selfie.jpg') $$,
  'verification already in review',
  'only one verification can be in review at a time'
);
select throws_ok(
  $$ select public.apply_verification_verdict(gen_random_uuid(), '{"action":"approve"}'::jsonb) $$,
  '42501',
  null,
  'clients cannot execute apply_verification_verdict'
);
select pg_temp.admin();
select public.apply_verification_verdict(
  (select id from public.verification_requests
    where user_id = '00000000-0000-0000-0000-00000000000b' and status = 'pending'),
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select verified from public.profiles
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  true,
  'approval sets the public verified badge'
);
select throws_ok(
  $$ select verification from public.profiles
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'verification evidence jsonb stays unreadable to clients'
);
select throws_ok(
  $$ select verdict from public.verification_requests
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'raw model verdict on the request is server-only'
);
select is(
  (select status::text from public.verification_requests
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  'approved',
  'owner can read their verification status'
);
select throws_ok(
  $$ select public.submit_verification(
       '00000000-0000-0000-0000-00000000000b/selfie.jpg') $$,
  'already verified',
  'verified accounts cannot re-submit'
);

-- Admin report review queue.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, details)
     values ('00000000-0000-0000-0000-00000000000a',
             '00000000-0000-0000-0000-00000000000c',
             'flirtation_or_sexual', 'kept pushing after I said this is platonic') $$,
  'user can file a report'
);
select throws_ok(
  $$ select * from public.admin_report_queue $$,
  '42501',
  null,
  'clients cannot read the admin report queue'
);
select throws_ok(
  $$ select public.admin_resolve_report(gen_random_uuid(), 'ban') $$,
  '42501',
  null,
  'clients cannot execute admin_resolve_report'
);
select pg_temp.admin();
select is(
  (select reported_user_strikes::int from public.admin_report_queue
    where reported_user_id = '00000000-0000-0000-0000-00000000000c'),
  1,
  'queue shows the reported user''s strike count'
);
select public.admin_resolve_report(
  (select id from public.reports
    where reported_user_id = '00000000-0000-0000-0000-00000000000c'),
  'ban', 'pattern of flirtatious first messages');
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-00000000000c'),
  'banned',
  'admin ban action bans the reported user'
);
select is(
  (select status from public.reports
    where reported_user_id = '00000000-0000-0000-0000-00000000000c'),
  'resolved:ban',
  'resolved report leaves the open queue'
);
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000c'
      and action = 'admin_banned'),
  1,
  'admin ban is audit-logged'
);

-- Admin actions that can't apply raise instead of logging phantom events.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason)
     values ('00000000-0000-0000-0000-00000000000b',
             '00000000-0000-0000-0000-00000000000c', 'harassment') $$,
  'a second report can be filed against a banned user'
);
select pg_temp.admin();
select throws_ok(
  $$ select public.admin_resolve_report(
       (select id from public.reports
         where reported_user_id = '00000000-0000-0000-0000-00000000000c'
           and status = 'open'),
       'suspend') $$,
  'suspend does not apply to this account''s status',
  'suspending a banned account raises instead of logging a phantom event'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000d', 'trip_match', 'hey', 'bio') $$,
  'account banned',
  'banned sender is refused at the DB layer'
);

select * from finish();
rollback;
