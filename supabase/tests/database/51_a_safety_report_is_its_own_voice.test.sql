-- A safety report is not silenced by an earlier complaint about the hours.
--
-- `business_reports_one_voice` was written for listing-accuracy reports, and
-- for those it is right: without it, "the first report from an account
-- triggers a scan" means "one account can trigger a scan as often as it
-- likes". 20260902110000 then routed a second KIND of report through the same
-- table - a report about how the business BEHAVED, which raises a row in the
-- moderation spine beside the reports about people. The index could not tell
-- the two apart, and report_business inserts `on conflict do nothing` and
-- returns void, so a traveler who had once reported a wrong address and later
-- had something to say about harassment got silence and a success.
--
-- These cases are written from that traveler's side: the accuracy report goes
-- first, exactly as it would in life, and the question is whether the safety
-- report that follows it is heard.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'traveler@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'other@example.com');

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Bar Fonte' $$;

create function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.reports() returns int language sql as
  $$ select count(*)::int from public.business_reports where business_id = pg_temp.biz() $$;

create function pg_temp.conduct_events() returns int language sql as
  $$ select count(*)::int from public.moderation_events
      where action = 'conduct_report' $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select public.register_business('Bar Fonte', 'bar', pg_temp.lisbon(), 38.7108, -9.1400);
reset role;
select set_config('request.jwt.claims', '', true);
update public.businesses set state = 'listed', listed_at = now() where id = pg_temp.biz();

-- ---------------------------------------------------------------------------
-- The traveler says the address is wrong. Ordinary, and unchanged.
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'wrong_location', 'it moved') $$,
  'a traveler reports the listing'
);
select is(pg_temp.reports(), 1, 'which is recorded');
select is(pg_temp.conduct_events(), 0, 'and is not a conduct report');

-- The same complaint twice is still one voice: this is the guarantee the
-- index was built for and the change must not spend it.
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'not_a_real_place') $$,
  'the same account complaining about the listing again is a no-op'
);
select is(pg_temp.reports(), 1, 'and writes no second row');

-- ---------------------------------------------------------------------------
-- Then something happens, and it is not about the address.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'harassment_or_conduct', 'the manager followed me out') $$,
  'the same traveler can still report how the business behaved'
);
select is(
  pg_temp.reports(), 2,
  'which is a row of its own, not a silent no-op behind the earlier one'
);
-- The half that makes it a safety report rather than a filed complaint: it
-- reaches the same queue as a report about a person.
select is(
  pg_temp.conduct_events(), 1,
  'and reaches the moderation spine, which is what the first one did not'
);

-- And conduct is one voice too. A second conduct report from the same account
-- is the repetition the index exists to stop, on the other side of the line.
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'unsafe') $$,
  'but a second conduct report from that account is a no-op in its turn'
);

-- ---------------------------------------------------------------------------
-- The unclaimed venue, which is where a conduct report has no owner to hang on
-- ---------------------------------------------------------------------------
--
-- The spine has two subject queries: "complaints against this account"
-- (subject_user_id) and "everything filed about this business", which reads
-- the (subject_business_id, created_at desc) index built for it. A row with
-- neither set exists and answers neither, and an unclaimed venue - owner null
-- by definition - is exactly the row that used to come out that way.

insert into public.businesses (name, category, city_id, lat, lng, state, listed_at)
values ('Tasca Sem Dono', 'bar', pg_temp.lisbon(), 38.7120, -9.1380, 'listed', now());

select is(
  (select owner_user_id from public.businesses where name = 'Tasca Sem Dono'),
  null,
  'the venue really is unclaimed, so there is no owner to file against'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select lives_ok(
  $$ select public.report_business(
       (select id from public.businesses where name = 'Tasca Sem Dono'),
       'unsafe', 'the bouncer got physical') $$,
  'a traveler reports how an unclaimed venue behaved'
);

select is(
  (select count(*)::int from public.moderation_events
    where action = 'conduct_report'
      and subject_business_id = (select id from public.businesses where name = 'Tasca Sem Dono')),
  1,
  'and the event names the business, so the one index built for this finds it'
);

select * from finish();
rollback;
