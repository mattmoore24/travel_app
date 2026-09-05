-- A reporter may learn what became of THEIR report, and nothing whatever
-- about the account they reported.
--
-- Written as the attack, because every interesting failure here is a leak
-- rather than an error. The two functions this file is about hand a signed-in
-- caller their own rows out of two tables that are otherwise closed to them,
-- so the questions are: does either one ever return somebody else's row, does
-- the reported account learn that it was reported, and - the one that would
-- have shipped quietly - can a reporter tell a DISMISSED report from a BAN by
-- reading the state back?
--
-- That last one is the whole point of the file. `reports.status` carries the
-- moderator's verdict verbatim ('resolved:ban', 'resolved:dismiss'), the audit
-- asked for a three-value state with 'action taken' in it, and a third state
-- is that verdict published to the person who filed the report. So the
-- assertions below are mostly about two rows being INDISTINGUISHABLE, which is
-- not a property any ordinary test looks for.
--
-- And it is asked twice, because a report has two tables. A report about a
-- BUSINESS goes to public.business_reports through report_business, carries
-- its own resolution vocabulary (dismiss, flag, relist, remove, unverify),
-- and includes the two conduct reasons a traveler files when the people at a
-- venue behaved badly. Every one of those resolutions has to arrive here as
-- the same word as every other, exactly as a ban and a dismissal do.
begin;
select plan(36);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'ines@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'jonas@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'kaya@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

-- A pg_temp FUNCTION rather than a temp table: `set local role authenticated`
-- has no privileges on anything in pg_temp, and a fixture table would take the
-- suite down on the first assertion after the switch - which is always the
-- half about what a real person sees.
create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- The hardest caller the owner tests have to hold against: somebody holding
-- the `authenticated` role - the only role either function is granted to -
-- with no `sub` in the token, so auth.uid() is null. anon is refused by the
-- grant and never reaches the body at all; this one does.
create function pg_temp.nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

-- ---------------------------------------------------------------------------
-- Two reports, filed by one person, about two different people
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

insert into public.reports (reporter_id, reported_user_id, reason, context) values
  ('00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000f2', 'harassment', 'profile'),
  ('00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000f3', 'spam', 'profile');

select is(
  (select count(*)::int from public.my_report_status()),
  2,
  'a reporter gets their own reports back'
);

select is(
  (select count(*)::int from public.my_report_status() where state = 'received'),
  2,
  'and both say received while nobody has read them yet'
);

-- ---------------------------------------------------------------------------
-- THE ATTACK: reading somebody else's punishment off your own report
-- ---------------------------------------------------------------------------
--
-- One report is dismissed and the other ends in a ban. Those are the two
-- furthest-apart outcomes the moderator has, and the reporter must not be able
-- to tell which is which.

select pg_temp.admin();

create function pg_temp.report_about(subject uuid) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.reports where reported_user_id = subject $$;

select lives_ok(
  format($$ select public.admin_resolve_report(%L, 'ban') $$,
         pg_temp.report_about('00000000-0000-0000-0000-0000000000f2')),
  'a moderator bans the first account'
);
select lives_ok(
  format($$ select public.admin_resolve_report(%L, 'dismiss') $$,
         pg_temp.report_about('00000000-0000-0000-0000-0000000000f3')),
  'and dismisses the report about the second'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

select is(
  (select count(*)::int from public.my_report_status() where state = 'reviewed'),
  2,
  'the reporter learns that a person read both'
);

select is(
  (select count(distinct state)::int from public.my_report_status()),
  1,
  'and a ban is byte identical to a dismissal, which is the whole rule'
);

select ok(
  not exists (
    select 1 from public.my_report_status()
     where state like 'resolved%' or state like '%ban%' or state like '%dismiss%'
  ),
  'the raw resolution string never leaves the database'
);

-- The OUT columns by NAME, so the negative is structural rather than a
-- sampling of today's data: no reported_user_id, no reported_chat_id, no
-- status, no details about anybody. A migration that adds one fails here.
select is(
  (select array_to_string(proargnames, ',') from pg_proc
    where oid = 'public.my_report_status()'::regprocedure),
  'id,created_at,reason,state',
  'and there is no column on it that could name the other account'
);

-- ---------------------------------------------------------------------------
-- Everybody else
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from public.my_report_status()),
  0,
  'the reported account is never told it was reported'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
insert into public.reports (reporter_id, reported_user_id, reason, context)
values ('00000000-0000-0000-0000-0000000000f3',
        '00000000-0000-0000-0000-0000000000f1', 'other', 'profile');

select is(
  (select count(*)::int from public.my_report_status()),
  1,
  'a second reporter sees one report, not the three in the table'
);
select is(
  (select id from public.my_report_status()),
  pg_temp.report_about('00000000-0000-0000-0000-0000000000f1'),
  'and it is theirs'
);

-- ---------------------------------------------------------------------------
-- The other table: a report about a business
-- ---------------------------------------------------------------------------
--
-- Two businesses rather than one, because admin_resolve_business_report
-- resolves every open report against a business at once - so telling a
-- removal apart from a dismissal needs one of each, on two listings.
--
-- These two auth rows are inserted HERE, after the blanket profile update at
-- the top of the file: register_business refuses an account that has finished
-- traveler onboarding, and that update stamps every profile it can see.

select pg_temp.admin();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f4', 'fonte@example.com'),
  ('00000000-0000-0000-0000-0000000000f5', 'mirante@example.com');

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.biz(nom text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.businesses where name = nom $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000f4');
select public.register_business('Bar Fonte', 'bar', pg_temp.lisbon(), 38.7108, -9.1400);
select pg_temp.login('00000000-0000-0000-0000-0000000000f5');
select public.register_business('Bar Mirante', 'bar', pg_temp.lisbon(), 38.7150, -9.1300);

select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
 where name in ('Bar Fonte', 'Bar Mirante');

-- The traveler who already filed two reports about people now files two about
-- businesses: one about how the place behaved, one about the map pin.
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok(
  $$ select public.report_business(
       pg_temp.biz('Bar Fonte'), 'harassment_or_conduct', 'the doorman followed me out') $$,
  'the same traveler reports a business for how it behaved'
);
select lives_ok(
  $$ select public.report_business(
       pg_temp.biz('Bar Mirante'), 'wrong_location', 'it moved') $$,
  'and reports another one for being in the wrong spot'
);

select is(
  (select count(*)::int from public.my_report_status()),
  4,
  'a report about a business is a report, and lands in the same list'
);
select is(
  (select count(*)::int from public.my_report_status()
    where reason in ('harassment_or_conduct', 'wrong_location')),
  2,
  'in the words the report form offered, not an enum from the other table'
);
select is(
  (select count(*)::int from public.my_report_status()
    where reason in ('harassment_or_conduct', 'wrong_location') and state = 'received'),
  2,
  'and both say received while nobody has read them'
);

-- THE SAME ATTACK, on the other table. A removal and a dismissal are the two
-- furthest-apart things the queue can do to a listing.
select pg_temp.admin();

create function pg_temp.biz_report(nom text) returns uuid language sql
security definer set search_path = public as
  $$ select r.id from public.business_reports r
      join public.businesses b on b.id = r.business_id
     where b.name = nom $$;

select lives_ok(
  format($$ select public.admin_resolve_business_report(%L, 'remove') $$,
         pg_temp.biz_report('Bar Fonte')),
  'a moderator takes the first listing down'
);
select lives_ok(
  format($$ select public.admin_resolve_business_report(%L, 'dismiss') $$,
         pg_temp.biz_report('Bar Mirante')),
  'and dismisses the report about the second'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is(
  (select count(distinct state)::int from public.my_report_status()
    where reason in ('harassment_or_conduct', 'wrong_location')),
  1,
  'and a removed listing is byte identical to a dismissed report'
);
select ok(
  not exists (
    select 1 from public.my_report_status()
     where state like '%remove%' or state like '%flag%' or state like '%unverify%'
        or state like '%relist%' or state like '%dismiss%'
  ),
  'no business resolution word leaves the database either'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from public.my_report_status()),
  0,
  'and somebody else''s business report is not theirs to read'
);

select pg_temp.admin();
select ok(
  not has_table_privilege('authenticated', 'public.business_reports', 'select'),
  'the business report table itself stays closed, which is why this is a function'
);

select ok(
  not has_function_privilege('anon', 'public.my_report_status()', 'execute'),
  'anon cannot ask the question at all'
);
select ok(
  has_function_privilege('authenticated', 'public.my_report_status()', 'execute'),
  'while a signed-in caller can'
);
select ok(
  not has_column_privilege('authenticated', 'public.reports', 'status', 'select'),
  'and the raw status column is still admin-only, which is why this is a function'
);

-- ---------------------------------------------------------------------------
-- Messages to support
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok(
  $$ select public.submit_support_message(
       'ines@example.com', 'My chats are not loading on hostel wifi.', 'account') $$,
  'somebody writes in'
);

select is(
  (select count(*)::int from public.my_support_messages() where not delivered),
  1,
  'and can see it sitting there, not yet delivered'
);

select pg_temp.admin();
update public.support_messages set delivered_at = now()
 where reply_to = 'ines@example.com';

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is(
  (select count(*)::int from public.my_support_messages() where delivered),
  1,
  'and sees it land once the mailer has run'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from public.my_support_messages()),
  0,
  'somebody else''s message to support is not theirs to read'
);

-- A GUEST's message is written with a null author, and it must reach nobody.
--
-- The `user_id is not null` half of the owner test is NOT what does that, and
-- the assertion that used to sit here pretended otherwise: it asked a caller
-- with a real uid, for whom the guest's row is excluded by the equality alone,
-- so it passed identically with the clause deleted. What actually holds is the
-- equality itself - `null = null` is NULL, not TRUE - together with the revoke
-- from anon. So this asks the hardest caller either guard has to hold against:
-- the authenticated role with no sub in its token.
select pg_temp.guest();
select lives_ok(
  $$ select public.submit_support_message(
       'passing@example.com', 'How do I get my name back?', 'other') $$,
  'a guest with no account writes in too'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is(
  (select count(*)::int from public.my_support_messages()),
  1,
  'and it belongs to nobody, so the signed-in caller still sees only theirs'
);

select pg_temp.nobody();
select is(
  (select count(*)::int from public.my_support_messages()),
  0,
  'a caller whose own uid is null matches no null author either'
);

-- The other function's business half is nullable for the same reason: a
-- report outlives the account that filed it, and `reporter_user_id` is set
-- null when that account is deleted. One of the four reports above loses its
-- reporter here, which is what a deletion does to it.
select pg_temp.admin();
update public.business_reports set reporter_user_id = null
 where business_id = pg_temp.biz('Bar Fonte');

select pg_temp.nobody();
select is(
  (select count(*)::int from public.my_report_status()),
  0,
  'and an orphaned report belongs to no caller, uid or no uid'
);

select pg_temp.admin();
select is(
  (select array_to_string(proargnames, ',') from pg_proc
    where oid = 'public.my_support_messages()'::regprocedure),
  'id,created_at,category,delivered',
  'the message answer carries no body and no address either'
);
select ok(
  not has_function_privilege('anon', 'public.my_support_messages()', 'execute'),
  'anon cannot ask this one either'
);
select ok(
  not has_table_privilege('authenticated', 'public.support_messages', 'select'),
  'and the inbox itself stays closed'
);

select * from finish();
rollback;
