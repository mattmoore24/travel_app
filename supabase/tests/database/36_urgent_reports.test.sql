-- An urgent report goes first, wakes somebody, and takes nobody down.
--
-- Written as the attack, because the interesting failure here is not "does
-- the queue sort" but "what can one person buy by typing a word". Decision
-- D34: a single unverified report must never suppress a stranger, however
-- serious the label on it. So the assertions come in two halves - the
-- priority and the push that make an urgent report useful, and the status
-- column that proves it bought nothing else.
begin;
select plan(11);

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
  ('00000000-0000-0000-0000-0000000000d1', 'reporter@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'spammer@example.com'),
  ('00000000-0000-0000-0000-0000000000d3', 'suspect@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'duty@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

-- THE ENUM ACCEPTS BOTH ------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, context)
     values ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d2', 'spam', 'profile') $$,
  'an ordinary report goes in, and goes in FIRST so the ordering has an older row to beat'
);

-- A beat, so created_at genuinely differs: an ordering test where both rows
-- share a timestamp proves nothing about the ordering.
select pg_temp.admin();
update public.reports set created_at = now() - interval '1 hour';

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, context)
     values ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d3', 'underage', 'profile') $$,
  'the enum accepts underage'
);
select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, context)
     values ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d3', 'immediate_danger', 'chat') $$,
  'and immediate_danger'
);

-- THE QUEUE ------------------------------------------------------------------
--
-- The attack version: the spam report was filed an hour earlier, so a queue
-- ordered by age alone puts it first and a minor waits behind it.

select pg_temp.admin();
select is(
  (select reason::text from public.admin_report_queue limit 1),
  'underage',
  'the older spam report does not outrank a claim that somebody is 15'
);
select is(
  (select count(*)::int from (
     select reason::text as reason from public.admin_report_queue limit 2
   ) top2 where reason in ('underage', 'immediate_danger')),
  2,
  'both urgent reasons sit ahead of it, whatever their own order'
);
select ok(
  not has_table_privilege('anon', 'public.admin_report_queue', 'select')
    and not has_table_privilege('authenticated', 'public.admin_report_queue', 'select'),
  'and no client can read the queue at all, before or after the reorder'
);

-- THE PUSH -------------------------------------------------------------------

select is(
  (select count(*)::int from public.push_queue where title like 'Report:%'),
  0,
  'with nobody on support duty, an urgent report wakes no phone'
);

update public.app_config
   set value = jsonb_build_array('duty@example.com')
 where key = 'support_notify_recipients';

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
insert into public.reports (reporter_id, reported_user_id, reason, context)
values ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d3', 'underage', 'profile');
insert into public.reports (reporter_id, reported_user_id, reason, context)
values ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'spam', 'profile');

select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000d4'
      and title = 'Report: under 18'),
  1,
  'once somebody is on duty, an underage report wakes their phone'
);
select is(
  (select body from public.push_queue
    where user_id = '00000000-0000-0000-0000-0000000000d4'
      and title = 'Report: under 18'),
  'It is at the front of the review queue. Nobody has been suspended by it.',
  'and the notification says what did NOT happen, so nobody assumes it did'
);
select is(
  (select count(*)::int from public.push_queue where title like 'Report:%'),
  1,
  'a spam report wakes nobody: only the urgent reasons do'
);

-- WHAT A REPORT DOES NOT BUY (D34) -------------------------------------------
--
-- Two reports naming somebody a minor, and their account is untouched. If
-- this ever fails, one person typing a word has become a way to darken any
-- stranger in the app.
select is(
  (select status::text from public.users
    where id = '00000000-0000-0000-0000-0000000000d3'),
  'active',
  'and the reported account is still active: a human decides, not the form'
);

select * from finish();
rollback;
