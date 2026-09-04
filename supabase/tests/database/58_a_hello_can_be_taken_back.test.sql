-- A hello can be taken back, and the liquidity number can be counted.
--
-- Two packages share one migration (20260902210000 says why), so they share
-- one test file. PART ONE is the withdraw; PART TWO is liquidity reach and
-- history.
--
-- The withdraw has one obvious wrong implementation and two invisible ones.
--
--   * The obvious one is `delete from message_requests`. It frees the
--     `unique (sender_id, recipient_id)` slot, which is the anti-pester
--     constraint, so "take it back" quietly becomes "say hi again, and again,
--     at the person who did not answer". Assertion 2 is the one that would
--     catch that, and it is the reason this file exists.
--
--   * The first invisible one is an ORACLE. sent_requests() collapses
--     pending, declined and expired into a flat 'sent' precisely so a sender
--     is never told they were declined (invariant 4). A withdraw that works
--     on pending and refuses on declined hands that fact straight back.
--     Assertions 9 to 11 compare the three answers.
--
--   * The second is the PUSH. A hello held for classification is pushed when
--     the worker releases it, minutes later, by an UPDATE trigger - so a
--     hello withdrawn during those minutes would still ring somebody's phone
--     for a message that no longer exists. Assertions 14 to 16 are that,
--     with a control so the test cannot pass by the trigger being broken.
begin;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'take-back-sender@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'take-back-pending@example.com'),
  ('00000000-0000-0000-0000-0000000000d3', 'take-back-declined@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'take-back-expired@example.com'),
  ('00000000-0000-0000-0000-0000000000d5', 'take-back-accepted@example.com'),
  ('00000000-0000-0000-0000-0000000000d6', 'take-back-held@example.com');

update public.profiles set
  display_name = 'traveler', age = 28, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now();

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

-- Back to postgres AND clear the claims: apply_message_verdict runtime-guards
-- on auth.role() and would otherwise still read the last login.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Reading a hello's id back has to bypass RLS, and that is invariant 4 doing
-- its job rather than a test problem: the SENDER has no direct select on
-- message_requests at all, because pending, declined and expired must be
-- indistinguishable to them, and the RECIPIENT stops seeing the row the
-- moment it is withdrawn. A definer function owned by postgres is how a
-- pgTAP fixture holds an id across a role switch (the traps skill: a temp
-- TABLE has no privileges once the suite becomes `authenticated`).
--
-- CREATED HERE, before the first login, and that placement is the whole
-- trick: a function created while the session is `set role authenticated` is
-- OWNED by authenticated, so `security definer` defines it as exactly the
-- role it was meant to escape and the helper silently returns null.
create function pg_temp.hello(sender uuid, recipient uuid) returns uuid
language sql security definer as $$
  select id from public.message_requests
  where sender_id = $1 and recipient_id = $2
$$;

create function pg_temp.mine(recipient uuid) returns uuid language sql as
  $$ select pg_temp.hello('00000000-0000-0000-0000-0000000000d1', recipient) $$;

-- Everyone overlaps in Lisbon, so every hello below is legitimately sendable
-- and every one of these six counts toward Lisbon's liquidity in part two.
insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 5, current_date + 15
from unnest(array[
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000d4',
  '00000000-0000-0000-0000-0000000000d5',
  '00000000-0000-0000-0000-0000000000d6']::uuid[]) as u;

-- =========================================================================
-- PART ONE. Taking a hello back.
-- =========================================================================

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d2', 'trip_match',
  'Which miradouro wins at sunset?', 'bio');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d3', 'trip_match',
  'Any coworking cafe tips while our dates overlap?', 'bio');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d4', 'trip_match',
  'Is the tram worth it or is it a tourist trap?', 'trip');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d5', 'trip_match',
  'Up for a pastel de nata crawl in September?', 'trip');

-- 1. The sender takes it back.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (public.withdraw_message_request(
     pg_temp.mine('00000000-0000-0000-0000-0000000000d2'))) ->> 'withdrawn',
  'true',
  'a pending hello can be taken back'
);

-- 2. THE ONE THAT MATTERS. The row is kept, so the anti-pester slot is still
-- taken and a second hello to the same traveler is still refused. A `delete`
-- implementation passes every other assertion in this file and fails here.
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-0000000000d2', 'trip_match',
       'Second go at the same person', 'bio') $$,
  'hello already sent to this traveler',
  'one shot per direction survives a withdrawal'
);

-- 3-4. And the words are still there for the sender, with the stamp on them.
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000d2'),
  'sent',
  'state keeps its three words: a withdrawn row still reads sent'
);
select isnt(
  (select withdrawn_at from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000d2'),
  null,
  'and the new fact arrives as a column rather than as a fourth state'
);

-- 5. The recipient's inbox no longer has it.
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select is(
  (select count(*)::int from public.incoming_requests()),
  0,
  'a withdrawn hello leaves the recipient inbox'
);

-- 6. And neither does their direct read of the table. The RPC is UX; the
-- policy is the enforcement layer, and a client with a raw PostgREST select
-- must not be able to read a hello that was taken back.
select is(
  (select count(*)::int from public.message_requests),
  0,
  'nor is it readable straight off the table'
);

-- 7. A recipient holding a stale list cannot accept it. Accepting would open
-- a chat and unlock social handles (hard rule 4 runs off this exact row).
select throws_ok(
  format($$ select public.respond_to_message_request(%L, true) $$,
         pg_temp.mine('00000000-0000-0000-0000-0000000000d2')),
  'request not found',
  'and a stale client cannot accept it'
);

-- 8. Taking it back twice is not an error and not a second stamp.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (public.withdraw_message_request(
     pg_temp.mine('00000000-0000-0000-0000-0000000000d2'))) ->> 'withdrawn',
  'false',
  'withdrawing an already withdrawn hello answers false rather than raising'
);

-- 9-11. THE ORACLE. Invariant 4 says the database never tells a sender they
-- were declined, and sent_requests() collapses pending, declined and expired
-- into one word to keep that promise. So the withdraw has to answer the same
-- on all three, or it becomes the read-receipt the whole design refuses.
select pg_temp.admin();
update public.message_requests set status = 'declined', responded_at = now()
  where recipient_id = '00000000-0000-0000-0000-0000000000d3';
update public.message_requests set status = 'expired', expired_at = now()
  where recipient_id = '00000000-0000-0000-0000-0000000000d4';
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000d3'),
  'sent',
  'a declined hello still reads sent to its sender'
);
select is(
  (public.withdraw_message_request(
     pg_temp.mine('00000000-0000-0000-0000-0000000000d3'))) ->> 'withdrawn',
  'true',
  'and withdrawing it answers exactly what withdrawing a pending one answered'
);
select is(
  (public.withdraw_message_request(
     pg_temp.mine('00000000-0000-0000-0000-0000000000d4'))) ->> 'withdrawn',
  'true',
  'so does withdrawing one the nightly sweep already ended'
);

-- 12-13. An accepted hello is not withdrawn. There is a chat, the sender can
-- see it in their own chat list, and refusing tells them nothing new.
select pg_temp.login('00000000-0000-0000-0000-0000000000d5');
select public.respond_to_message_request(
  pg_temp.mine('00000000-0000-0000-0000-0000000000d5'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (public.withdraw_message_request(
     pg_temp.mine('00000000-0000-0000-0000-0000000000d5'))) ->> 'withdrawn',
  'false',
  'an accepted hello is a conversation and cannot be taken back'
);
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000d5'),
  'accepted',
  'and it stays accepted'
);

-- 14-15. THE PUSH, and the control that keeps this pair honest.
--
-- A hello held for classification is delivered by an UPDATE minutes later,
-- and that update is what fires the push trigger. Withdraw it in between and
-- the phone must stay quiet - but a test that only asserts "no push" would
-- pass just as well if the trigger were broken outright, so the delivered
-- hello above is asserted first. push_queue is server-only, so these read as
-- admin: a client cannot see this table at all, which is itself the point.
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000d5'
      and data ->> 'type' = 'request'),
  1,
  'an ordinary hello does queue a push'
);
select pg_temp.admin();
update public.app_config set value = 'true'::jsonb where key = 'require_llm_moderation';
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d6', 'trip_match',
  'Any good day trips out of the city?', 'bio');
select public.withdraw_message_request(
  pg_temp.mine('00000000-0000-0000-0000-0000000000d6'));
select pg_temp.admin();
select public.apply_message_verdict(
  pg_temp.mine('00000000-0000-0000-0000-0000000000d6'),
  '{"action":"allow","engine":"claude-moderator"}'::jsonb);
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000d6'
      and data ->> 'type' = 'request'),
  0,
  'a hello withdrawn while it was being screened never rings the recipient'
);

-- 16. And the push the FIRST withdrawal queued was pulled back out, because
-- the worker had not sent it yet. Targeted by request id: the control push
-- to d5 above is still sitting there untouched, which assertion 14 already
-- said and this one relies on.
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000d2'
      and data ->> 'type' = 'request'),
  0,
  'an unsent push for a withdrawn hello is taken out of the queue'
);

-- 17-18. Somebody else's hello is not yours to take back, and the miss has
-- to be a miss rather than a stamp on the wrong row: a where-clause that
-- forgot `sender_id` would answer false here and still have withdrawn it.
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select public.send_message_request(
  '00000000-0000-0000-0000-0000000000d4', 'trip_match',
  'Fancy splitting a taxi to Sintra?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(
  (public.withdraw_message_request(
     pg_temp.hello('00000000-0000-0000-0000-0000000000d3',
                   '00000000-0000-0000-0000-0000000000d4'))) ->> 'withdrawn',
  'false',
  'a hello you did not send is not yours to withdraw'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select is(
  (select withdrawn_at from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000d4'),
  null,
  'and the row it aimed at is untouched'
);

-- 19-20. The grants, including the one the drop-and-recreate could have lost.
select pg_temp.admin();
set local role anon;
select throws_ok(
  $$ select public.withdraw_message_request(
       '00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501',
  null,
  'anon cannot execute withdraw_message_request'
);
select throws_ok(
  $$ select * from public.sent_requests() $$,
  '42501',
  null,
  'anon still cannot execute sent_requests() after the recreate'
);
reset role;

-- =========================================================================
-- PART TWO. Liquidity reach and history.
-- =========================================================================
--
-- The finding: a trip can be posted weeks ahead and run for weeks, so
-- somebody who installed once, posted a trip and never came back counts
-- toward a city's liquidity for the whole window - and the number gating the
-- second city can be met entirely by people who will never answer a hello.

select pg_temp.admin();
update public.app_config set value = 'false'::jsonb where key = 'require_llm_moderation';
update public.profiles set last_seen_on = current_date
  where user_id = '00000000-0000-0000-0000-0000000000d1';
-- Exactly on the boundary, which is the case a `>` instead of a `>=` gets
-- wrong and nobody notices for a month.
update public.profiles set last_seen_on = current_date - 7
  where user_id = '00000000-0000-0000-0000-0000000000d2';
update public.profiles set last_seen_on = current_date - 8
  where user_id = '00000000-0000-0000-0000-0000000000d3';
-- d4, d5 and d6 keep a null last_seen_on: an account that has not opened the
-- app since the column existed. Unreachable is the right reading.

-- 21-22. The two numbers, side by side. That is the whole package: the pair
-- is the finding, and a single corrected number would have hidden which of
-- the two cities you have.
select is(
  (select liquidity::int from public.admin_liquidity
    where city_id = pg_temp.lisbon()),
  6,
  'liquidity still counts everybody with a live trip or pin'
);
select is(
  (select liquidity_reachable::int from public.admin_liquidity
    where city_id = pg_temp.lisbon()),
  2,
  'and reachable counts only the ones who opened the app inside a week'
);

-- 23-24. The touch. No argument, so there is nowhere to put somebody else's
-- id; the strongest form of "cannot be called for another user".
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select public.touch_last_seen();
-- Read back as admin, because assertion 26 is that a client cannot read this
-- column at all - including its own.
select pg_temp.admin();
select is(
  (select last_seen_on from public.profiles
    where user_id = '00000000-0000-0000-0000-0000000000d3'),
  current_date,
  'touch_last_seen stamps the caller with today'
);
select is(
  (select last_seen_on from public.profiles
    where user_id = '00000000-0000-0000-0000-0000000000d4'),
  null,
  'and touches nobody else'
);

-- 25. A DATE and never a time. A per-minute last-seen is a presence signal,
-- and presence is one step from the live-location promise this product is
-- built on refusing (hard rule 2).
select col_type_is(
  'public', 'profiles', 'last_seen_on', 'date',
  'last_seen_on is a date, so it can never become a presence signal'
);

-- 26. And nothing in the client can read it, about themselves or anybody
-- else. profiles is column-granted and never star-selected by the app.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'last_seen_on', 'select'),
  'no client may read last_seen_on'
);

-- 27. Somebody eight days quiet counted, once they came back.
select is(
  (select liquidity_reachable::int from public.admin_liquidity
    where city_id = pg_temp.lisbon()),
  3,
  'opening the app puts a lapsed account back into the reachable count'
);

-- 28-29. The history the gauge cannot keep, because pins hard-delete within
-- 15 minutes of expiry (hard rule 3) and nothing can reconstruct it later.
select is(
  public.snapshot_liquidity(),
  (select count(*)::int from public.launch_cities),
  'the nightly job writes one row per launch city'
);
select is(
  (select liquidity::int || '/' || reachable::int from public.liquidity_daily
    where city_id = pg_temp.lisbon() and day = current_date),
  '6/3',
  'and it stores the same two counts the view shows'
);

-- 30. Re-running it corrects the day rather than failing on the primary key,
-- so a manual catch-up after a missed night is safe.
select lives_ok(
  $$ select public.snapshot_liquidity() $$,
  'a second run on the same day corrects that day'
);

-- 31-32. Neither the widened view nor the new table is readable by a client.
-- A view recreated without its revoke is readable by every signed-in account,
-- and this one now carries a count derived from a column no client may read.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok(
  $$ select * from public.admin_liquidity $$,
  '42501',
  null,
  'clients still cannot read admin_liquidity after the drop and recreate'
);
select throws_ok(
  $$ select * from public.liquidity_daily $$,
  '42501',
  null,
  'and the snapshot table is service-role only'
);

reset role;
select * from finish();
rollback;
