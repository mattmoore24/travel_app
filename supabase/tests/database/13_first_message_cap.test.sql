-- The daily cap on first messages.
--
-- A safety limit, not a tier: it paces senders, protects the inboxes of the
-- travelers whose departure would kill this category, and keeps the
-- moderation queue readable. Hard rule 1 means it must never be sold back,
-- so the tests care that it is a plain limit with a plain, warm refusal.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dee@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

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

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Everybody is in Lisbon on the same dates, so every pair is a valid target
-- and the only thing that can stop a send is the cap itself.
insert into public.trips (user_id, city_id, start_date, end_date)
select id, pg_temp.lisbon(), current_date + 1, current_date + 10 from auth.users;

-- A cap of two, so the test is about the rule rather than about typing.
select pg_temp.admin();
update public.app_config set value = '2'::jsonb where key = 'first_messages_per_day';

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select is(
  (select allowed from public.first_message_budget()),
  2,
  'the budget says how many you get'
);
select is(
  (select used from public.first_message_budget()),
  0,
  'and how many you have spent'
);

select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000b', 'trip_match',
     'Your bio mentions street food, any pastel de nata tips?', 'bio')) ->> 'delivered',
  'true',
  'the first hello goes'
);
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000c', 'trip_match',
     'Saw you are in town the same week, fancy a coffee?', 'trip')) ->> 'delivered',
  'true',
  'so does the second'
);

-- THE CAP ------------------------------------------------------------------

select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000d', 'trip_match',
     'Hello! Want to explore Belem together?', 'trip')) ->> 'capped',
  'true',
  'the third is capped rather than refused with an error'
);
-- THE SAME KEYS ON EVERY BRANCH. The client has one result type for this
-- function, so a branch that omits a key types it as present and hands back
-- undefined. The capped branch is exactly the one where the composer wants
-- to say "8 of 8", and `used` was the key it dropped.
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     public.send_message_request(
       '00000000-0000-0000-0000-00000000000d', 'trip_match',
       'Another one over the line', 'trip')) k),
  array['allowed','blocked','capped','category','delivered','queued','request_id','used'],
  'a capped answer carries every key the other answers carry'
);
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000d', 'trip_match',
     'And another', 'trip')) ->> 'used',
  '2',
  'including how many have gone today, which is what the composer shows'
);

-- Counted with RLS out of the way: a sender deliberately has no direct row
-- visibility into message_requests (invariant 4), which is why the budget is
-- a definer function rather than a query the client could run itself.
select pg_temp.admin();
select is(
  (select count(*)::int from public.message_requests
    where sender_id = '00000000-0000-0000-0000-00000000000a'),
  2,
  'and nothing was written'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select used from public.first_message_budget()),
  2,
  'the budget agrees'
);

-- ORACLE-PROOF: a capped sender learns nothing about who they aimed at. The
-- cap is checked before any recipient test, so a stranger with no overlapping
-- trip gets exactly the same answer as a valid target would.
select pg_temp.admin();
delete from public.trips where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000d', 'trip_match',
     'Hello again from a capped sender', 'trip')) ->> 'capped',
  'true',
  'a capped sender cannot use the refusal to probe who exists'
);

-- THE REWORD NUDGE ---------------------------------------------------------
--
-- The same verdict the send path uses, exposed as a read so the composer can
-- offer a reword instead of a rejection.

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select would_block from public.preview_first_message(
     'Any good pastel de nata near Alfama?')),
  false,
  'an ordinary hello previews clean'
);
select is(
  (select would_block from public.preview_first_message('you are so sexy')),
  true,
  'and one the filter would stop says so before it is sent'
);

-- Never the pattern that matched: a caller who could see WHY would have a
-- machine for finding exactly which words to route around.
select hasnt_column('public', 'preview_first_message', 'pattern',
  'the preview never hands back the rule that matched');

-- WHICH KIND OF WRONG ------------------------------------------------------
--
-- The send path returns the category the prefilter computed, so a message
-- caught by the flirtation patterns is no longer told it was "explicit".
-- Only ever on the blocked branch, and only to the sender it belongs to.
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000c', 'trip_match',
     'you look so sexy in that photo', 'photo:0')) ->> 'category',
  'flirtation',
  'a blocked hello names the kind of wrong the filter actually saw'
);
select ok(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000000c', 'trip_match',
     'Rewrote it: which market should I not miss?', 'bio')) ->> 'category' is null,
  'a delivered hello carries no category at all'
);

select * from finish();
rollback;
