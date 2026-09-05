-- EVERY MODERATION QUEUE IS VISIBLE TO THE DAILY SMOKE TEST
--
-- CORRECTION, 2026-09-02 (comment only - not one statement in this file has
-- changed since it was applied, and it must not: docs/LAUNCH_RUNBOOK.md,
-- "fix forward, never edit an applied one"). The title above overclaims and
-- the body below is the honest version: this migration added the four
-- photo-and-message queues it names, taking the view from three moderation
-- queues to seven, and the worker drains NINE. The two it left out are
-- storefront photos and impersonation scans - the only two queues that can
-- be PAUSED by a missing prompt secret, so exactly the two a smoke test
-- exists to surface. 20260903140000 adds them and the title becomes true of
-- the pair of files.
--
-- `admin_ops_health` (20260817150000:488) is the one-query liveness check:
-- docs/DASHBOARD.md calls it the daily smoke test, docs/LAUNCH_RUNBOOK.md
-- reads it before launch and quotes its thresholds, and `select * from
-- admin_ops_health;` in the SQL editor is its only entry point. It counted
-- two of the six photo-and-message queues the moderation worker drains: held
-- first messages and pending PROFILE photos (plus selfie verifications).
-- Business photos (20260829180000), post photos (20260902170000), chat photos
-- (20260817200000) and now group photos (20260903050000) each hold at
-- 'pending' behind their own trigger and their own verdict door, and a worker
-- branch that stopped draining any of them - the failure
-- moderation-worker-queues.test.ts exists for, and the one a green
-- `functions deploy` cannot see - would have shown the founder all zeros.
--
-- The four new counts use each queue's own predicate, the one the worker
-- selects by (moderation-worker/index.ts), so a number here is a number the
-- worker would find. The existing seven columns keep their names and their
-- order: a view's columns cannot be renamed or reordered by create or
-- replace, the runbook's thresholds are written against them, and
-- `pending_photos` has always meant profile photos.
--
-- No RPC, no client. A drop takes the ACL with it, so the revoke is restated.
-- 69_every_queue_the_smoke_test_can_see puts one item in each of the five
-- photo queues with the flag on and asserts each column says one, so a queue
-- dropped from this view fails the assertion that names it; and it asserts
-- the revoke, so a view recreated without it fails too.

drop view if exists public.admin_ops_health;
create view public.admin_ops_health as
select
  (select count(*) from public.message_requests where status = 'pending_moderation')
    as held_messages,
  (select round(extract(epoch from now() - min(created_at)) / 60)
     from public.message_requests where status = 'pending_moderation')
    as oldest_held_message_minutes,
  (select count(*) from public.profile_photos where moderation_status = 'pending')
    as pending_photos,
  (select count(*) from public.verification_requests where status = 'pending')
    as pending_verifications,
  (select count(*) from public.push_queue where sent_at is null)
    as unsent_pushes,
  (select round(extract(epoch from now() - min(created_at)) / 60)
     from public.push_queue where sent_at is null)
    as oldest_unsent_push_minutes,
  (select count(*) from public.pins where expires_at <= now())
    as expired_pins_awaiting_sweep,
  (select count(*) from public.business_photos where moderation_status = 'pending')
    as pending_business_photos,
  (select count(*) from public.business_posts
     where photo_status = 'pending' and photo_path is not null)
    as pending_post_photos,
  (select count(*) from public.messages
     where moderation_status = 'pending' and image_path is not null)
    as pending_chat_photos,
  (select count(*) from public.groups
     where photo_status = 'pending' and photo_path is not null)
    as pending_group_photos;

revoke all on public.admin_ops_health from anon, authenticated;

comment on view public.admin_ops_health is
  'The daily smoke test (docs/DASHBOARD.md): queue depths and oldest ages for '
  'both workers and pg_cron. pending_photos is PROFILE photos; the other four '
  'photo queues (business, post, chat, group) have their own columns since '
  '20260903070000, each counted by the predicate the worker selects with. '
  'Service role only.';
