-- THE TWO QUEUES THAT CAN PAUSE ARE THE TWO THE SMOKE TEST COULD NOT SEE
--
-- 20260903070000 is titled "every moderation queue is visible to the daily
-- smoke test" and its body is honestly narrower: it added the four
-- photo-and-message queues it names and stopped there. Counting the columns
-- against the worker: `admin_ops_health` reads seven of the NINE queues
-- moderation-worker drains. The two it does not read are storefront photos
-- (`business_verifications` at 'pending', moderation-worker/index.ts:1199)
-- and impersonation scans (`business_scans` at 'pending', index.ts:1330).
--
-- Those two are the worst possible omission, because they are the only two
-- queues in the product that PAUSE. Both branches are wrapped in
-- `if (!prompt) { report.notes.push('... queue paused') }` (index.ts:1196 and
-- :1327), so a MODERATION_PROMPTS_BUSINESS secret missing either key means
-- the worker skips the queue and keeps posting 200s. It has happened twice
-- already and both times it was recorded, not noticed: supabase/.deploy-request
-- for 2026-08-27 says "until then those two queues pause and everything else
-- keeps running", and again a run later, "the storefront and impersonation
-- queues stay paused until the function actually holds it".
--
-- What a paused queue looks like from the founder's chair: a business
-- uploads its two storefront photos, the badge never arrives, and every
-- check is green - `functions deploy` succeeded, the worker answers 401 to
-- the deploy's probe, and `select * from admin_ops_health;` reads all zeros
-- because the depth that is climbing has no column. A queue that can be
-- switched off by a missing secret is exactly what a smoke test is for.
--
-- Two more counts, each using the predicate the worker selects with, so a
-- number here is a number the worker would find:
--
--   pending_storefronts  business_verifications where status = 'pending'
--   pending_scans        business_scans where status = 'pending'
--
-- The names are the worker's own (QUEUE_BUDGET_MS.storefronts and .scans).
-- `pending_verifications` keeps its name and its meaning - SELFIE
-- verifications, `verification_requests` - because the runbook's thresholds
-- are written against it and a view's columns cannot be renamed by create or
-- replace. That is also why these two go at the END: the eleven existing
-- columns keep their names and their order.
--
-- No RPC, no client. A drop takes the ACL with it, so the revoke is restated.
-- 69_every_queue_the_smoke_test_can_see now puts one item in each of the
-- EIGHT queues a pgTAP file can fill (held first messages are the ninth, and
-- 09_launch_hardening has held that column since 20260817150000) and asserts
-- each column says one, so a queue dropped from this view fails the
-- assertion that names it; and it asserts the revoke, so a view recreated
-- without it fails too.

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
    as pending_group_photos,
  (select count(*) from public.business_verifications where status = 'pending')
    as pending_storefronts,
  (select count(*) from public.business_scans where status = 'pending')
    as pending_scans;

revoke all on public.admin_ops_health from anon, authenticated;

comment on view public.admin_ops_health is
  'The daily smoke test (docs/DASHBOARD.md): queue depths and oldest ages for '
  'both workers and pg_cron. All NINE moderation-worker queues have a column '
  'since 20260903140000, each counted by the predicate the worker selects '
  'with. pending_photos is PROFILE photos and pending_verifications is '
  'SELFIE verifications; pending_storefronts and pending_scans are the two '
  'queues that pause when MODERATION_PROMPTS_BUSINESS is missing a key, '
  'which is why they are counted. Service role only.';
