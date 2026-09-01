-- A hello the classifier stopped after sending leaves a trace.
--
-- Two blocks look identical in the database and are completely different
-- events to the person who wrote them:
--
--   * the PREFILTER refused the message in the composer, with the text still
--     in the box and a warning already on screen. Nothing was lost.
--   * the CLASSIFIER came back minutes after the app said the message was on
--     its way. The sender was never told, the row silently left the "You said
--     hi" list, and unique (sender_id, recipient_id) means they can never
--     write to that person again.
--
-- sent_requests() now tells them apart with blocked_after_send, keyed on the
-- verdict's engine. This file pins that, and re-attacks the two things the
-- new OUT column could have broken: the recipient must still see none of it,
-- and anon must still be refused after the drop-and-recreate that the extra
-- column required.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'trace-sender@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'trace-prefilter@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'trace-classifier@example.com'),
  ('00000000-0000-0000-0000-0000000000c4', 'trace-failsafe@example.com');

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

-- Everyone overlaps, so every hello below is legitimately sendable.
insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 5, current_date + 15
from unnest(array[
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c3',
  '00000000-0000-0000-0000-0000000000c4']::uuid[]) as u;

-- 1. The prefilter refuses, in the composer, in front of the writer.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-0000000000c2', 'trip_match',
     'you look so sexy in that photo', 'photo:0')) ->> 'blocked',
  'true',
  'the prefilter blocks in the composer'
);
select is(
  (select state from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000c2'),
  'blocked',
  'and the sender reads it as their own block'
);
select is(
  (select blocked_after_send from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000c2'),
  false,
  'nothing was lost, so it is NOT a hello that vanished after sending'
);

-- 2. The classifier blocks, minutes after the app said the message was sent.
select pg_temp.admin();
update public.app_config set value = 'true'::jsonb where key = 'require_llm_moderation';
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-0000000000c3', 'trip_match',
     'Which miradouro wins at sunset?', 'bio')) ->> 'queued',
  'true',
  'a clean message is held for classification'
);
select pg_temp.admin();
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-0000000000c1'
      and recipient_id = '00000000-0000-0000-0000-0000000000c3'),
  '{"action":"block","category":"flirtation","engine":"claude-moderator"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (select blocked_after_send from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000c3'),
  true,
  'a classifier block after the confirmation is marked, so the row can stay'
);

-- 3. A failsafe block is the same event to the sender: equally not told.
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-0000000000c4', 'trip_match',
     'Any coworking cafe tips while our dates overlap?', 'bio')) ->> 'queued',
  'true',
  'a second clean message is held'
);
select pg_temp.admin();
select public.apply_message_verdict(
  (select id from public.message_requests
    where sender_id = '00000000-0000-0000-0000-0000000000c1'
      and recipient_id = '00000000-0000-0000-0000-0000000000c4'),
  '{"action":"block","category":"moderation_unavailable","engine":"failsafe"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (select blocked_after_send from public.sent_requests()
    where recipient_id = '00000000-0000-0000-0000-0000000000c4'),
  true,
  'a failsafe block is marked too: the sender did nothing wrong and was not told'
);

-- 4. THE ATTACK. The new column must not have widened what a recipient sees.
-- message_requests_select_recipient only ever exposes pending and accepted
-- rows, and a blocked hello is neither, whichever engine stopped it.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(
  (select count(*)::int from public.message_requests),
  0,
  'the prefilter block never reaches the person it was aimed at'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select count(*)::int from public.message_requests),
  0,
  'nor does the one the classifier stopped'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(
  (select count(*)::int from public.message_requests),
  0,
  'nor the failsafe one'
);

-- 5. THE ATTACK the drop-and-recreate makes possible. Dropping a function
-- drops its grants; a migration that forgets to restate the revoke hands
-- execute back to anon by way of Supabase's default.
select pg_temp.admin();
set local role anon;
select throws_ok(
  $$ select * from public.sent_requests() $$,
  '42501',
  null,
  'anon still cannot execute sent_requests() after the recreate'
);

reset role;
select * from finish();
rollback;
