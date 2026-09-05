-- EVERY MODERATION QUEUE IS VISIBLE TO THE DAILY SMOKE TEST.
--
-- `admin_ops_health` counted held first messages, pending PROFILE photos and
-- selfie verifications, so a stuck business, post, chat or group photo
-- queue - each holds at 'pending' behind its own trigger and its own door -
-- read as all zeros to the one query the founder runs (docs/DASHBOARD.md).
-- 20260903070000 added the four photo queues. 20260903140000 added the last
-- two, which are the two that matter most: storefront checks and
-- impersonation scans are the only queues in the product that PAUSE, because
-- each is wrapped in `if (!prompt) { ... queue paused }` and a
-- MODERATION_PROMPTS_BUSINESS secret missing a key switches it off silently
-- (it has happened twice - see supabase/.deploy-request, 2026-08-27).
--
-- This file puts exactly one item in each of the EIGHT queues a pgTAP file
-- can fill, with the photo flag on so each photo queue genuinely holds, and
-- asks the view. Held first messages are the ninth queue and the one column
-- this file does not fill: 09_launch_hardening has asserted it since
-- 20260817150000, and holding one here would need the moderation flag and a
-- second traveler for no new information.
--
-- EVERY ASSERTION HERE WAS RUN AGAINST THE MUTATION THAT REMOVES WHAT IT
-- NAMES (2026-09-02, re-measured on a rebuilt cluster when the last two
-- queues were added). Each of the eight queue subqueries in turn, with its
-- `= 'pending'` term replaced by `= 'approved'`, fails exactly the assertion
-- that names its queue and nothing else: 9, 10, 11, 12, 13, 14, 15 and 16,
-- in the order they are written below. Assertion 1 goes on passing under
-- every one of them - zero equals zero on a quiet database, which is why
-- the counts after the fixture are the real guard and 1 is only the
-- baseline. `pending_scans` deleted from the view outright kills the file at
-- the FIRST read of the missing column, which is assertion 1's query
-- (planned 17, ran 0) - a failure too, just a louder one. The revoke deleted
-- turns 17 'clients cannot read the smoke test' into "lives".
begin;
select plan(17);

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
  ('00000000-0000-0000-0000-0000000000a9', 'ana@example.com'),     -- a traveler
  ('00000000-0000-0000-0000-0000000000b9', 'owner@example.com');   -- runs a business

-- A whole traveler, so the selfie and photo guards for guests and the
-- unonboarded do not refuse her.
update public.profiles set
  display_name = 'Ana', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000a9';

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Lumen' $$;

create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Porto crew' $$;

-- Nothing is waiting yet.
select pg_temp.admin();
select results_eq(
  $$ select held_messages::int, pending_photos::int, pending_verifications::int,
            pending_business_photos::int, pending_post_photos::int,
            pending_chat_photos::int, pending_group_photos::int,
            pending_storefronts::int, pending_scans::int
       from public.admin_ops_health $$,
  $$ values (0, 0, 0, 0, 0, 0, 0, 0, 0) $$,
  'the smoke test answers all zeros on a quiet database'
);

-- How production runs: everything holds.
update public.app_config set value = 'true' where key = 'require_photo_moderation';

-- One of each.
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
insert into public.profile_photos (user_id, storage_path, position)
values ('00000000-0000-0000-0000-0000000000a9',
        '00000000-0000-0000-0000-0000000000a9/p0.jpg', 0);
select public.create_group('Porto crew', null::date, 'everyone',
  '00000000-0000-0000-0000-0000000000a9/crew.jpg');
insert into public.messages (chat_id, sender_id, image_path, body)
values (pg_temp.crew(), '00000000-0000-0000-0000-0000000000a9',
        '00000000-0000-0000-0000-0000000000a9/beach.jpg', 'look at this');

select pg_temp.login('00000000-0000-0000-0000-0000000000b9');
select public.register_business('Casa Lumen', 'cafe', pg_temp.lisbon(), 38.7108, -9.1400);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now() where id = pg_temp.biz();
-- The selfie goes in through submit_verification on a phone, which wants an
-- approved profile photo first; the row is what the view counts, so it is
-- written directly as the service role, the way the worker's tests do.
insert into public.verification_requests (user_id, storage_path)
values ('00000000-0000-0000-0000-0000000000a9',
        '00000000-0000-0000-0000-0000000000a9/selfie.jpg');
insert into public.business_photos (business_id, storage_path, position)
values (pg_temp.biz(), 'biz/casa-lumen/cover.jpg', 0);
-- The two queues that pause. Both rows are written as the service role for
-- the same reason as the selfie above: submit_business_verification and
-- report_business are the phone's doors, and what the view counts is the
-- row, so the row is what is put there. Both tables default status to
-- 'pending' - there is no flag to turn on and nothing to hold them back.
insert into public.business_verifications (business_id, wide_path, close_path)
values (pg_temp.biz(),
        '00000000-0000-0000-0000-0000000000b9/wide.jpg',
        '00000000-0000-0000-0000-0000000000b9/close.jpg');
insert into public.business_scans (business_id) values (pg_temp.biz());
select pg_temp.login('00000000-0000-0000-0000-0000000000b9');
insert into public.business_posts (business_id, title, photo_path, happens_at)
values (pg_temp.biz(), 'Live music, no cover',
        '00000000-0000-0000-0000-0000000000b9/band.jpg', now() + interval '1 day');

-- Each genuinely holds, or the counts below would be counting nothing.
select pg_temp.admin();
select is((select moderation_status::text from public.profile_photos), 'pending',
  'the profile photo holds');
select is((select moderation_status::text from public.business_photos), 'pending',
  'the business photo holds');
select is((select photo_status::text from public.business_posts), 'pending',
  'the post photo holds');
select is((select moderation_status::text from public.messages), 'pending',
  'the chat photo holds');
select is((select photo_status::text from public.groups), 'pending',
  'the group photo holds');
select is((select status::text from public.business_verifications), 'pending',
  'the storefront check holds');
select is((select status::text from public.business_scans), 'pending',
  'the impersonation scan holds');

-- And the smoke test sees every one of them.
select is((select pending_photos::int from public.admin_ops_health), 1,
  'the smoke test counts the pending profile photo');
select is((select pending_verifications::int from public.admin_ops_health), 1,
  'and the pending verification');
select is((select pending_business_photos::int from public.admin_ops_health), 1,
  'and the pending business photo');
select is((select pending_post_photos::int from public.admin_ops_health), 1,
  'and the pending post photo');
select is((select pending_chat_photos::int from public.admin_ops_health), 1,
  'and the pending chat photo');
select is((select pending_group_photos::int from public.admin_ops_health), 1,
  'and the pending group photo, which was the invisible one');
select is((select pending_storefronts::int from public.admin_ops_health), 1,
  'and the pending storefront check, one of the two queues that can pause');
select is((select pending_scans::int from public.admin_ops_health), 1,
  'and the pending impersonation scan, the other one');

-- Nobody but the service role reads it: the revoke is restated after the
-- drop, and this is what proves it.
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select throws_ok(
  $$ select * from public.admin_ops_health $$,
  '42501', null,
  'clients cannot read the smoke test'
);

select * from finish();
rollback;
