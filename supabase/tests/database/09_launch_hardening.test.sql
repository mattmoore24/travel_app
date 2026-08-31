-- Launch hardening (Phase 6): velocity caps on hot write paths, push-token
-- pruning, storage-object ceilings, admin metrics view privileges, and the
-- account-deletion cascade (what dies, what survives).
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

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

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 10, current_date + 20),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 10, current_date + 20);

-- Every active launch city states a clock the server can actually evaluate:
-- a typo'd IANA name would otherwise raise inside the first scheduled job,
-- where nobody sees it (20260831160000).
select is(
  (select count(*)::int from public.launch_cities
    where active and not public.is_valid_timezone(timezone)),
  0,
  'every active launch city carries a timezone now() at time zone accepts'
);
select throws_ok(
  $$ update public.launch_cities set timezone = 'Neverland/Nowhere'
     where city_id = pg_temp.lisbon() $$,
  '23514',
  null,
  'a timezone that does not parse is refused at write time'
);

-- Build an accepted chat for the message-flood test.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000a', 'trip_match',
     'Sunrise at the miradouro?', 'bio')) ->> 'delivered',
  'true',
  'baseline request delivers'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.respond_to_message_request(
     (select id from public.message_requests where status = 'pending' limit 1),
     true)) ->> 'accepted',
  'true',
  'baseline accept opens the chat'
);

-- Message flood: 29 more sends fine (30 total in the window), the 31st raises.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     select cp.chat_id, '00000000-0000-0000-0000-00000000000b', 'msg ' || n
     from public.chat_participants cp, generate_series(1, 30) n
     where cp.user_id = '00000000-0000-0000-0000-00000000000b' limit 30 $$,
  '30 messages inside a minute are allowed'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     select chat_id, '00000000-0000-0000-0000-00000000000b', 'one too many'
     from public.chat_participants
     where user_id = '00000000-0000-0000-0000-00000000000b' limit 1 $$,
  'sending too fast, give it a moment',
  'the 31st message in a minute is throttled'
);

-- Request-attempt cap: pad the day's attempt count to the limit, then send.
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, action, source)
select '00000000-0000-0000-0000-00000000000b', 'message_request', 'stub_approved', 'test'
from generate_series(1, 30);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000a', 'trip_match', 'hello again', 'bio') $$,
  'daily request limit reached',
  'request attempts are capped per rolling day'
);

-- Report cap.
select throws_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason)
     select '00000000-0000-0000-0000-00000000000b',
            '00000000-0000-0000-0000-00000000000a', 'spam'
     from generate_series(1, 11) $$,
  'daily report limit reached',
  'the 11th report in a day is refused'
);

-- Trip churn cap (rows, not just active count).
select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date, status)
     select '00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
            current_date + 30, current_date + 31, 'cancelled'
     from generate_series(1, 20) $$,
  'daily trip limit reached',
  'trip insert churn is capped per day'
);

-- Pin churn cap: the 10-LIVE cap alone doesn't stop delete/expire-recreate
-- cycles, so batches of 10 are inserted and force-expired (as postgres)
-- three times; the 31st insert of the day must then hit the daily cap.
create function pg_temp.pin_batch(n int) returns void language plpgsql as $$
begin
  perform pg_temp.login('00000000-0000-0000-0000-00000000000b');
  insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                           intent_date, expires_at)
  select '00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
         'venue ' || i, 'bar', 38.72, -9.14, current_date,
         now() + interval '1 hour'
  from generate_series(1, n) i;
  perform pg_temp.admin();
  update public.pins set expires_at = now() - interval '1 second'
    where user_id = '00000000-0000-0000-0000-00000000000b';
end
$$;
select pg_temp.pin_batch(10);
select pg_temp.pin_batch(10);
select pg_temp.pin_batch(10);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                              intent_date, expires_at)
     values ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
             'venue 31', 'bar', 38.72, -9.14, current_date,
             now() + interval '1 hour') $$,
  'daily pin limit reached',
  'pin insert churn is capped per day even across expiry cycles'
);

-- Push tokens: registering a 6th prunes to the 5 freshest.
select public.register_push_token('ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]');
select public.register_push_token('ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]');
select public.register_push_token('ExponentPushToken[cccccccccccccccccccccc]');
select public.register_push_token('ExponentPushToken[dddddddddddddddddddddd]');
select public.register_push_token('ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]');
select public.register_push_token('ExponentPushToken[ffffffffffffffffffffff]');
select is(
  (select count(*)::int from public.push_tokens
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  5,
  'token registration prunes beyond 5 devices'
);

-- The sign-out path deletes the device's OWN row, and only its own — written
-- as the attack. Nothing in the app had ever exercised push_tokens_delete_own
-- until sign-out started forgetting the device's token, so prove both halves:
-- the delete another user aims across the fence silently removes nothing, and
-- the delete a user aims at their own row lands.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.register_push_token('ExponentPushToken[alice0aaaaaaaaaaaaaaaa]');
delete from public.push_tokens where token = 'ExponentPushToken[ffffffffffffffffffffff]';
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_tokens
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  5,
  'one user cannot delete another user''s push token'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
delete from public.push_tokens where token = 'ExponentPushToken[alice0aaaaaaaaaaaaaaaa]';
select is(
  (select count(*)::int from public.push_tokens
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'a device can delete its own token on the way out'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');

-- Storage ceilings: the verification bucket refuses an 11th object even
-- though clients cannot SELECT (the counter is a definer helper).
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     select 'verification-selfies',
            '00000000-0000-0000-0000-00000000000b/s' || n || '.jpg'
     from generate_series(1, 10) n $$,
  '10 verification objects are allowed'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('verification-selfies', '00000000-0000-0000-0000-00000000000b/s11.jpg') $$,
  '42501',
  null,
  'the 11th verification object is refused'
);

-- Profile text screening: the broadcast fields pass the same pre-filter as
-- first messages, and update velocity is capped.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ update public.profiles set bio = 'Here for hikes, food markets, and museum days.'
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'clean bio saves normally'
);
select throws_ok(
  $$ update public.profiles set bio = 'DTF, hit me up'
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'that text breaks our house rules',
  'flirtatious bio text is refused at write time'
);
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
select '00000000-0000-0000-0000-00000000000a', 'profile',
       '00000000-0000-0000-0000-00000000000a', 'updated', 'test'
from generate_series(1, 28);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ update public.profiles set bio = 'new bio'
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'daily profile update limit reached',
  'profile update velocity is capped per day'
);

-- Photo upload churn cap (counted from the audit spine, so delete/re-insert
-- cycles cannot reset it).
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, entity_id, action, source)
select '00000000-0000-0000-0000-00000000000a', 'profile_photo', gen_random_uuid(),
       'auto_approved', 'test'
from generate_series(1, 25);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position) values
     ('00000000-0000-0000-0000-00000000000a',
      '00000000-0000-0000-0000-00000000000a/late.jpg', 0) $$,
  'daily photo upload limit reached',
  'photo upload churn is capped per day'
);

-- Block velocity cap.
select pg_temp.admin();
insert into public.moderation_events (subject_user_id, entity_type, action, source)
select '00000000-0000-0000-0000-00000000000a', 'block', 'created', 'test'
from generate_series(1, 50);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id) values
     ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') $$,
  'daily block limit reached',
  'block velocity is capped per day'
);

-- Ops health view: queue depths visible to admin, invisible to clients.
select pg_temp.admin();
select is(
  (select held_messages::int from public.admin_ops_health),
  0,
  'ops health view reports the held-message queue depth'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select * from public.admin_ops_health $$,
  '42501',
  null,
  'clients cannot read the ops health view'
);

-- Admin metrics views: liquidity counts distinct users; clients locked out.
select pg_temp.admin();
select is(
  (select liquidity::int from public.admin_liquidity
    where city_id = pg_temp.lisbon()),
  2,
  'liquidity counts distinct users with a live trip or pin'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select * from public.admin_liquidity $$,
  '42501',
  null,
  'clients cannot read admin metrics views'
);

-- Account deletion cascade: deleting the auth user (what the delete-account
-- Edge Function does after storage + chat cleanup) removes the entire
-- public-schema footprint but keeps the moderation audit spine.
select pg_temp.admin();
-- Mirror the Edge Function's order: detach request rows, drop the chats,
-- then delete the auth user.
update public.message_requests set chat_id = null where chat_id in (
  select chat_id from public.chat_participants
  where user_id = '00000000-0000-0000-0000-00000000000b');
delete from public.chats where id in (
  select chat_id from public.chat_participants
  where user_id = '00000000-0000-0000-0000-00000000000b');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select is(
  (select count(*)::int from public.users
    where id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'auth deletion cascades the app user row'
);
select is(
  (select
     (select count(*) from public.trips where user_id = '00000000-0000-0000-0000-00000000000b')
   + (select count(*) from public.pins where user_id = '00000000-0000-0000-0000-00000000000b')
   + (select count(*) from public.message_requests
        where sender_id = '00000000-0000-0000-0000-00000000000b')
   + (select count(*) from public.push_tokens
        where user_id = '00000000-0000-0000-0000-00000000000b')
   + (select count(*) from public.reports
        where reporter_id = '00000000-0000-0000-0000-00000000000b'))::int,
  0,
  'trips, pins, requests, tokens, and reports all cascade away'
);
select is(
  (select count(*) > 0 from public.moderation_events
    where subject_user_id is null),
  true,
  'moderation audit events survive deletion with the subject nulled'
);

select * from finish();
rollback;
