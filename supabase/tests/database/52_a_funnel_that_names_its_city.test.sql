-- Accept rate, answerable by source, by city, and by what actually happened.
--
-- The old admin_request_funnel returned one global row over 30 days, folding
-- pending, ignored and declined into one denominator. Three decisions needed
-- it split: is a map hello accepted less than one from Travelers (the map-led
-- thesis), which city is going bad (creep is local, the rate was global), and
-- is a drop a push outage or a slow responder (all three looked identical).
--
-- The interesting property is the one an assertion is easiest to get wrong:
-- a hello sent an hour ago is NOT a refusal, and counting it as one is how a
-- healthy day reads as a collapsing one every evening. So the rate is over
-- DECIDED hellos, and the still-pending ones are carried in their own column.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@example.com');

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.row_for(p_city text, p_source text)
returns record language sql as $$
  select * from public.admin_request_funnel
   where city = p_city and source = p_source
$$;

-- The column that did not exist. Everything else hangs off it.
select has_column('public', 'message_requests', 'city_id',
  'a hello records which city it belongs to');

-- And it is NOT reachable from a client: message_requests carries
-- column-level grants precisely so moderation_verdict cannot leak, and the
-- city of every hello has no business in that set.
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_name = 'message_requests' and column_name = 'city_id'
      and grantee in ('authenticated', 'anon')),
  0,
  'and no client can read it'
);

-- The view is admin-only, restated after the drop. A view recreated without
-- its revoke is readable by every signed-in client, and this one is the whole
-- hello graph by city.
select is(
  (select count(*)::int from information_schema.table_privileges
    where table_name = 'admin_request_funnel' and grantee in ('authenticated', 'anon')),
  0,
  'the rebuilt view is not readable by anon or authenticated'
);

-- Four hellos in one city and source: one accepted, one declined, one answered
-- by nobody for a fortnight, one sent an hour ago.
insert into public.message_requests
  (sender_id, recipient_id, source, first_message, status, city_id, created_at, responded_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
   'pin', 'hello there', 'accepted', pg_temp.lisbon(),
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3',
   'pin', 'hello there', 'declined', pg_temp.lisbon(),
   now() - interval '3 days', now() - interval '3 days' + interval '4 hours'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3',
   'pin', 'hello there', 'pending', pg_temp.lisbon(),
   now() - interval '14 days', null),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1',
   'pin', 'hello there', 'pending', pg_temp.lisbon(),
   now() - interval '1 hour', null);

select is(
  (select accepted from public.admin_request_funnel where city = 'Lisbon' and source = 'pin'),
  1::bigint, 'the accepted one is counted as accepted');
select is(
  (select declined from public.admin_request_funnel where city = 'Lisbon' and source = 'pin'),
  1::bigint, 'the declined one is counted as declined, not folded in with silence');
select is(
  (select expired_unanswered from public.admin_request_funnel
    where city = 'Lisbon' and source = 'pin'),
  1::bigint, 'a fortnight of silence is an answer');
select is(
  (select still_pending from public.admin_request_funnel where city = 'Lisbon' and source = 'pin'),
  1::bigint, 'an hour of silence is not');

-- The property the whole view exists for: 1 of 3 DECIDED, not 1 of 4.
select is(
  (select accept_rate_pct from public.admin_request_funnel
    where city = 'Lisbon' and source = 'pin'),
  33.3::numeric,
  'the rate is over decided hellos, so this evening does not look like a collapse');

select is(
  (select median_hours_to_respond from public.admin_request_funnel
    where city = 'Lisbon' and source = 'pin'),
  3.0::numeric,
  'and it says how long a yes or a no took, which is what a push outage moves');

-- A row from before the column existed still counts, in its own bucket.
insert into public.message_requests
  (sender_id, recipient_id, source, first_message, status, city_id, created_at)
values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1',
   'trip_match', 'hello there', 'accepted', null, now() - interval '2 days');

select is(
  (select accepted from public.admin_request_funnel
    where city = 'unknown' and source = 'trip_match'),
  1::bigint,
  'a hello with no city is bucketed as unknown rather than dropped from history');

select * from finish();
rollback;
