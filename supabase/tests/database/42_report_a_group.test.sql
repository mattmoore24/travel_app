-- Reporting a group, and the two ways relaxing a NOT NULL could go wrong.
--
-- Written as attacks. A report that names a chat is a report with no person on
-- it, so the questions are: can somebody file one with no subject at all, can
-- somebody report a chat they have never been in (which would make this table
-- a way to probe chat ids), and does the report still reach the reviewer once
-- it has nobody's name on it. The last is the one that would fail silently:
-- the triage view used to inner-join public.users.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ae01', 'gina@example.com'),
  ('00000000-0000-0000-0000-00000000ae02', 'hugo@example.com');

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

create function pg_temp.crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Bad crew' $$;

select pg_temp.login('00000000-0000-0000-0000-00000000ae01');
select lives_ok(
  $$ select public.create_group('Bad crew', (current_date + 30)::date) $$,
  'somebody is in a group'
);

-- A REPORT NEEDS A SUBJECT -----------------------------------------------------

select throws_ok(
  $$ insert into public.reports (reporter_id, reason)
     values ('00000000-0000-0000-0000-00000000ae01', 'spam') $$,
  '23514',
  null,
  'a report with neither a person nor a chat is refused by the check'
);

-- A MEMBER CAN REPORT THE ROOM ITSELF ------------------------------------------

select lives_ok(
  $$ insert into public.reports (reporter_id, reported_chat_id, reason, context)
     values ('00000000-0000-0000-0000-00000000ae01', pg_temp.crew(), 'harassment',
             'group:test') $$,
  'a member can report the group itself, naming nobody'
);

select is(
  (select count(*)::int from public.reports
    where reported_chat_id = pg_temp.crew() and reported_user_id is null),
  1,
  'and the report really does carry no person'
);

-- THE ATTACK: REPORTING A CHAT YOU ARE NOT IN ----------------------------------
--
-- Without the membership test in the policy this table becomes a way to probe
-- which chat ids exist and to file reports against rooms nobody has been in.

select pg_temp.login('00000000-0000-0000-0000-00000000ae02');
select throws_ok(
  $$ insert into public.reports (reporter_id, reported_chat_id, reason)
     values ('00000000-0000-0000-0000-00000000ae02', pg_temp.crew(), 'spam') $$,
  '42501',
  null,
  'somebody who is not in the chat cannot report it'
);

select throws_ok(
  $$ insert into public.reports (reporter_id, reported_chat_id, reason)
     values ('00000000-0000-0000-0000-00000000ae01', pg_temp.crew(), 'spam') $$,
  '42501',
  null,
  'and nobody can file a report in somebody else''s name, chat or no chat'
);

-- REPORTING A PERSON IS UNTOUCHED ----------------------------------------------

select lives_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason, context)
     values ('00000000-0000-0000-0000-00000000ae02',
             '00000000-0000-0000-0000-00000000ae01', 'spam', 'profile') $$,
  'an ordinary report about a person still works'
);

-- IT REACHES THE REVIEWER ------------------------------------------------------
--
-- The half that would have failed silently: the queue inner-joined
-- public.users on the reported person, so a report with none would have been
-- filed, acknowledged, and read by nobody.

select pg_temp.admin();
select is(
  (select count(*)::int from public.admin_report_queue
    where reported_chat_id = pg_temp.crew()),
  1,
  'a report with no person on it is in the reviewer''s queue'
);
select is(
  (select reported_chat_name from public.admin_report_queue
    where reported_chat_id = pg_temp.crew()),
  'Bad crew',
  'and it says which room it is about'
);
select is(
  (select count(*)::int from public.admin_report_queue
    where reported_user_id = '00000000-0000-0000-0000-00000000ae01'),
  1,
  'while a report about a person is still in it too'
);

-- THE AUDIT SPINE TOLERATES A REPORT WITH NO SUBJECT USER ----------------------

select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'report' and subject_user_id is null),
  1,
  'the report is logged in the moderation spine with a null subject'
);

-- ACTING ON IT -----------------------------------------------------------------

create function pg_temp.group_report() returns uuid language sql
security definer set search_path = public as
  $$ select id from public.reports where reported_chat_id = pg_temp.crew() $$;

select throws_ok(
  format($$ select public.admin_resolve_report(%L, 'suspend') $$, pg_temp.group_report()),
  'this report names a chat and not a person: act on somebody in it, or dismiss',
  'a person-shaped action on a chat report is refused in words that say what to do'
);
select lives_ok(
  format($$ select public.admin_resolve_report(%L, 'dismiss') $$, pg_temp.group_report()),
  'and it can be dismissed like any other'
);

select * from finish();
rollback;
