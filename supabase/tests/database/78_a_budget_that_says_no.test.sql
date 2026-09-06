-- THE PIPELINE THAT SPENDS MONEY HAS TO BE ABLE TO REFUSE.
--
-- Nine moderation queues drain inside one tick, every item is a model call,
-- and the cron fires every minute. The per-tick `.limit()`s bound THROUGHPUT
-- and always did; nothing bounded the bill. 47 calls a tick times 1440 ticks
-- is 67,680 calls a day of a frontier model over images, and the thing that
-- used to stop the 67,681st was nothing at all.
--
-- 20260906100000 added a ceiling that is claimed before the spend and handed
-- back unspent. This file holds the four properties that make it worth having:
--
--   1. NOBODY BUT THE SERVER CAN TOUCH IT. A cap an authenticated caller can
--      raise, reset, or read is decoration.
--   2. IT ACTUALLY REFUSES. A claim past the ceiling returns nought, and
--      nought is what makes a queue stop rather than slow down.
--   3. THE FAILURE DIRECTION IS RIGHT. Release can never mint budget, and a
--      claim that is never released stays spent - so a worker killed mid-tick
--      under-spends the day instead of escaping it.
--   4. RUNNING OUT IS NOT AN APPROVAL. That half lives in the worker (see
--      src/app/__tests__/moderation-worker-queues.test.ts), because it is a
--      property of the branch that reads the claim, not of the claim.
--
-- And the velocity cap the same migration added: a chat photo is a model call,
-- and until now the only thing bounding how many an account could queue was a
-- STANDING cap of 200 objects in the bucket. Delete two hundred, upload two
-- hundred more: the storage policy is satisfied every time and the classifier
-- is not. Profile photos were given a daily cap in 20260817150000 for exactly
-- this reason and chat photos were missed.
--
-- WHY THE SEEDED ROWS ARE BACKDATED. `now()` is the TRANSACTION's timestamp,
-- so every row this file inserts shares one. Seeded at now() the 30-a-minute
-- throttle fires first and the file would prove the wrong cap - passing, with
-- the daily cap deleted. Two hours back puts them outside the minute window
-- and inside the day, so the only rule that can raise is the one under test.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

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

-- `reset role` alone is NOT enough to become the server again: assert_service_caller
-- reads auth.role(), which reads the request.jwt.claims GUC, and that GUC survives
-- a role reset. Clearing it leaves auth.role() null, which is neither anon nor
-- authenticated and so passes the guard - the same shape 65 uses.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- 1. THE DOOR IS SHUT ------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.claim_moderation_budget(int)', 'EXECUTE'),
  'anon cannot claim moderation budget'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_moderation_budget(int)', 'EXECUTE'),
  'authenticated cannot claim moderation budget'
);
select ok(
  not has_function_privilege('anon', 'public.release_moderation_budget(int, date)', 'EXECUTE'),
  'anon cannot release moderation budget'
);
select ok(
  not has_function_privilege('authenticated', 'public.release_moderation_budget(int, date)', 'EXECUTE'),
  'authenticated cannot release moderation budget'
);
select ok(
  not has_function_privilege('authenticated', 'public.config_int(text, int)', 'EXECUTE'),
  'authenticated cannot read config_int, which would leak the ceiling'
);

-- RLS on with no policies: the deny-all shape app_config and push_queue use.
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.moderation_spend'::regclass),
  true,
  'moderation_spend has RLS enabled'
);
select is(
  (select count(*)::int from pg_policy
   where polrelid = 'public.moderation_spend'::regclass),
  0,
  'moderation_spend has no policies, so every API role is denied'
);

-- The runtime guard, proved SEPARATELY from the grant - and the grant has to
-- be handed over for the length of one call to prove it at all.
--
-- Written the obvious way (log in, call, expect 42501) this assertion passes
-- with assert_service_caller() deleted from the function, because a missing
-- EXECUTE grant raises 42501 too: "permission denied for function" and "admin
-- only" are the same SQLSTATE, so the test would be re-asserting the four
-- checks above and reporting it as a fifth. The guard exists for exactly the
-- case the grant does not cover - a future migration that grants EXECUTE back
-- by accident - so the only way to test it is to BE that migration.
grant execute on function public.claim_moderation_budget(int) to authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.claim_moderation_budget(10) $$,
  '42501',
  'admin only',
  'the runtime guard still refuses an authenticated caller who has been granted EXECUTE'
);
select pg_temp.admin();
revoke execute on function public.claim_moderation_budget(int) from authenticated;

-- 2. IT REFUSES ------------------------------------------------------------

update public.app_config set value = '25' where key = 'moderation_daily_call_cap';

select is((public.claim_moderation_budget(10) ->> 'granted')::int, 10,
  'a claim inside the ceiling is granted in full');
select is((public.claim_moderation_budget(10) ->> 'granted')::int, 10,
  'and again, while there is room');
select is(
  (public.claim_moderation_budget(10) ->> 'granted')::int, 5,
  'a claim that would cross the ceiling is trimmed to what is left'
);
select is((public.claim_moderation_budget(10) ->> 'granted')::int, 0,
  'and the next one is refused outright');
select is(
  (select calls from public.moderation_spend where day = current_date), 25,
  'the day is charged for exactly the ceiling, never past it'
);

-- The day it charged to, which is the half `release` needs. A tick that starts
-- before midnight and finishes after it must refund the day it BORROWED from;
-- a release reading current_date at release time would lose today's refund and
-- hand tomorrow a tick's worth of budget it never claimed.
select is(
  (public.claim_moderation_budget(1) ->> 'day')::date, current_date,
  'and the claim names the day it charged, so the refund can find it'
);

-- 3. RELEASE GIVES BACK, AND CANNOT MINT -----------------------------------

select lives_ok(
  $$ select public.release_moderation_budget(5) $$,
  'an unspent claim is handed back'
);
select is(
  (public.claim_moderation_budget(10) ->> 'granted')::int, 5,
  'and the handed-back budget is claimable again'
);

-- A double release is the shape a retry takes. It must not carve the day
-- below nought and hand out budget that was already spent.
select public.release_moderation_budget(1000);
select public.release_moderation_budget(1000);
select is(
  (select calls from public.moderation_spend where day = current_date), 0,
  'a release can empty the day but never drive it negative'
);

-- 3b. THE REFUND GOES TO THE DAY IT BORROWED FROM --------------------------
--
-- Directly testable, unlike the two assertions below it.
select public.claim_moderation_budget(5);
insert into public.moderation_spend (day, calls) values (current_date - 1, 20)
on conflict (day) do update set calls = 20;
select public.release_moderation_budget(5, current_date - 1);
select is(
  (select calls from public.moderation_spend where day = current_date - 1), 15,
  'a refund names its day and lands on that day'
);

-- 3c. THE RACE THIS FUNCTION SURVIVES, ASSERTED BY SHAPE -------------------
--
-- HONESTLY LABELLED: these two read the function's own definition out of the
-- catalog instead of exercising it, because the defect they guard needs TWO
-- CONCURRENT TRANSACTIONS and a pgTAP file is one. Mutation testing confirmed
-- the gap rather than assumed it - reintroducing the bug leaves every
-- behavioural assertion in this file green.
--
-- The bug: with `on conflict do nothing` followed by a separate
-- `select ... for update`, two ticks racing the first claim of a new day leave
-- the loser's insert skipped and the winner's row uncommitted, so the select
-- finds nothing and v_used is NULL. Postgres's least() IGNORES nulls -
-- least(47, null) is 47 - so the ceiling check evaluates to p_want, the caller
-- is granted everything it asked for, and the UPDATE under it matches no rows
-- and records none of it. A spend cap that hands out unlimited budget on
-- exactly the transition it is most likely to be raced on.
select matches(
  pg_get_functiondef('public.claim_moderation_budget(int)'::regprocedure),
  'on conflict \(day\) do update',
  'the claim takes the row lock through DO UPDATE, not DO NOTHING plus a select'
);
select matches(
  pg_get_functiondef('public.claim_moderation_budget(int)'::regprocedure),
  'if v_used is null then',
  'and refuses outright if the count is somehow still null, rather than granting'
);

-- 4. THE KILL SWITCH -------------------------------------------------------

update public.app_config set value = 'true' where key = 'moderation_paused';
select is(
  (public.claim_moderation_budget(10) ->> 'granted')::int, 0,
  'moderation_paused refuses every claim regardless of the ceiling'
);
update public.app_config set value = 'false' where key = 'moderation_paused';

-- 5. A CHAT PHOTO IS A MODEL CALL, AND HAS A DAILY CAP NOW -----------------

insert into public.trips (user_id, city_id, start_date, end_date)
select u, (select city_id from public.launch_cities limit 1), current_date + 3, current_date + 13
from unnest(array['00000000-0000-0000-0000-00000000000a'::uuid,
                  '00000000-0000-0000-0000-00000000000b'::uuid]) u;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.send_message_request(
  '00000000-0000-0000-0000-00000000000a', 'trip_match', 'Pastel de nata tour?', 'bio');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.respond_to_message_request(
  (select id from public.message_requests where status = 'pending' limit 1), true);

select pg_temp.admin();
-- Seed 120 photo messages two hours back. User triggers off so the seeding
-- itself is not rate limited; FK checks stay on ("user", not "all").
alter table public.messages disable trigger user;
insert into public.messages (chat_id, sender_id, body, image_path, created_at)
select (select id from public.chats limit 1),
       '00000000-0000-0000-0000-00000000000a',
       null,
       'a/' || g || '.jpg',
       now() - interval '2 hours'
from generate_series(1, 120) g;
alter table public.messages enable trigger user;

select is(
  (select count(*)::int from public.messages
   where sender_id = '00000000-0000-0000-0000-00000000000a' and image_path is not null),
  120,
  'the day is seeded to the cap'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, image_path)
     values ((select id from public.chats limit 1),
             '00000000-0000-0000-0000-00000000000a', 'a/121.jpg') $$,
  '23514',
  null,
  'the hundred and twenty first photo of the day is refused'
);

-- The counterpart, and the reason this is a photo cap and not a message cap:
-- a plain message costs nothing to classify and must still go through.
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values ((select id from public.chats limit 1),
             '00000000-0000-0000-0000-00000000000a', 'still talking') $$,
  'a message without a photo is unaffected by the photo cap'
);

rollback;
