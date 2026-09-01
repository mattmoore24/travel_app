-- Messaging a place, and rating one.
--
-- The two invariants under attack here are the ones the §7 amendments buy:
-- a message to a business always goes through but is still screened, and a
-- chat with a business never unlocks anybody's personal handles in either
-- direction.
begin;
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'ana@example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'bar@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'carl@example.com'),
  ('00000000-0000-0000-0000-0000000000d3', 'dee@example.com');
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-0000000000d3';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  reset role;
end
$$;

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Azul' $$;

update public.profiles set
  display_name = 'Ana', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id in ('00000000-0000-0000-0000-0000000000a3',
                  '00000000-0000-0000-0000-0000000000c3');

select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select public.register_business('Casa Azul', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now() where name = 'Casa Azul';

-- WRITING TO A PLACE --------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select throws_ok(
  $$ select public.message_business(pg_temp.biz(), 'do you have beds') $$,
  'make an account first',
  'a guest cannot write to a business'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select throws_ok(
  $$ select public.message_business(pg_temp.biz(), 'hello') $$,
  'a business account cannot do that',
  'and neither can another business, which is rule 8'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (public.message_business(pg_temp.biz(), 'Any beds left on the 4th?')) ->> 'blocked',
  'false',
  'a traveler writes to a place and it goes straight through'
);
-- The whole difference from the held first-message path: there is a chat and
-- a message the moment the prefilter clears, with nothing to release later.
select is(
  (select count(*)::int from public.messages m
    join public.chats c on c.id = m.chat_id
   where c.kind = 'business' and m.moderation_status = 'approved'),
  1,
  'the message is delivered, not held'
);
select is(
  (select count(*)::int from public.chats where kind = 'business'),
  1,
  'in one chat'
);

-- Screened, though. Rule 5 is not waived, only the accept step is.
select is(
  (public.message_business(pg_temp.biz(), 'hello')) ->> 'existing',
  'true',
  'writing again lands in the same conversation rather than a second one'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (public.message_business(pg_temp.biz(), 'you are so sexy')) ->> 'blocked',
  'true',
  'and a message the prefilter blocks is refused'
);
select is(
  (select count(*)::int from public.my_chats() where kind = 'business'),
  0,
  'with no chat created at all, so there is nothing to release later'
);

-- §7 RULE 4: A BUSINESS CHAT UNLOCKS NOBODY'S HANDLES ----------------------

select pg_temp.admin();
insert into public.social_handles (user_id, platform, handle) values
  ('00000000-0000-0000-0000-0000000000a3', 'instagram', 'ana'),
  ('00000000-0000-0000-0000-0000000000b3', 'instagram', 'casaazul');

-- has_accepted_chat requires kind = 'direct'. That one enum value is what
-- makes the promise true rather than merely stated, and it has to hold in
-- BOTH directions or the exchange is asymmetric in somebody's favour.
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select is(
  (select count(*)::int from public.social_handles
    where user_id = '00000000-0000-0000-0000-0000000000a3'),
  0,
  'a business never sees the handle of somebody who wrote to it'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (select count(*)::int from public.social_handles
    where user_id = '00000000-0000-0000-0000-0000000000b3'),
  0,
  'and the traveler never sees the owner''s personal one either'
);

-- THE ROW IN CHATS ----------------------------------------------------------

select is(
  (select title from public.my_chats() where kind = 'business'),
  'Casa Azul',
  'a traveler''s row is titled with the PLACE, not with whoever owns it'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select is(
  (select title from public.my_chats() where kind = 'business'),
  'Ana',
  'and the business sees the person'
);

-- Shadowbanning only works if it is invisible to the person being
-- shadowbanned and total for everybody else. A business reading its inbox is
-- everybody else.
select pg_temp.admin();
update public.users set status = 'shadowbanned'
  where id = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select is(
  (select count(*)::int from public.my_chats() where kind = 'business'),
  0,
  'a shadowbanned traveler''s chat is gone from the business inbox'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (select count(*)::int from public.my_chats() where kind = 'business'),
  1,
  'and looks perfectly normal to them, which is the whole point'
);
select pg_temp.admin();
update public.users set status = 'active' where id = '00000000-0000-0000-0000-0000000000a3';

-- RATINGS -------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select throws_ok(
  $$ select public.rate_business(pg_temp.biz(), 'loved', 0.9) $$,
  'make an account first',
  'a guest rates nothing, because an anonymous session is not an identity'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select throws_ok(
  $$ select public.rate_business(pg_temp.biz(), 'not_for_me', 0.1) $$,
  'a business account cannot do that',
  'and a bar cannot rank a rival down'
);

-- No presence requirement at all **[founder]**: this account has no trip in
-- Lisbon and never has had one, and that is deliberately fine.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (select count(*)::int from public.trips where user_id = '00000000-0000-0000-0000-0000000000a3'),
  0,
  'the rater has never entered a trip in this city'
);
select is(
  (public.rate_business(pg_temp.biz(), 'loved', 1.0)) ->> 'score',
  '10.0',
  'and rates it anyway, because somebody who was there in 2024 still knows'
);
select is(
  (public.rate_business(pg_temp.biz(), 'not_for_me', 0.0)) ->> 'score',
  '0.0',
  'changing your mind moves the same row rather than adding a second'
);
-- The bands are what stop a hand-made request putting a 10 on something it
-- marked "not for me".
select is(
  public.rating_score('fine', 0.5),
  5.0::numeric,
  'each bucket owns a band of the scale'
);
select throws_ok(
  $$ select public.rate_business(pg_temp.biz(), 'loved', 1.5) $$,
  'that is not a position in the list',
  'and a position outside the list is refused'
);
select throws_ok(
  $$ select public.rate_business(pg_temp.biz(), 'loved', 0.5,
       array['cheap','quiet','late','lively']::public.rating_tag[]) $$,
  'three tags is plenty',
  'tags are capped, and there is no free text anywhere to cap'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select count(*)::int from public.business_ratings
    where user_id = '00000000-0000-0000-0000-0000000000a3'),
  0,
  'nobody reads anybody else''s rating, which is the anti-retaliation control'
);

-- The five-rater floor. A 9.2 from one person is noise wearing a number, and
-- the gate is in the function rather than in the client because a threshold
-- the client enforces is one anybody can read around.
select is(
  (select average from public.business_rating_summary(pg_temp.biz())),
  null,
  'no public number below five raters'
);
select is(
  (select rater_count from public.business_rating_summary(pg_temp.biz())),
  1,
  'though the count itself is honest'
);

select pg_temp.admin();
insert into public.business_ratings (user_id, business_id, category, bucket, rank, score)
select u.id, pg_temp.biz(), 'bar', 'loved', 0.8, 9.3
from (values ('00000000-0000-0000-0000-0000000000b3'::uuid),
             ('00000000-0000-0000-0000-0000000000c3'::uuid),
             ('00000000-0000-0000-0000-0000000000d3'::uuid)) as u(id);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'e@example.com');
insert into public.business_ratings (user_id, business_id, category, bucket, rank, score)
values ('00000000-0000-0000-0000-0000000000e3', pg_temp.biz(), 'bar', 'loved', 0.8, 9.3);

select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select rater_count from public.business_rating_summary(pg_temp.biz())),
  5,
  'at five raters'
);
select isnt(
  (select average from public.business_rating_summary(pg_temp.biz())),
  null,
  'the number appears'
);

-- A dark listing takes its score with it, like everything else about it.
select pg_temp.admin();
update public.businesses set state = 'flagged' where name = 'Casa Azul';
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok(
  $$ select public.rate_business(pg_temp.biz(), 'loved', 0.5) $$,
  'business not found',
  'and a flagged place cannot be rated at all'
);

-- THE SHELF ON A PROFILE ----------------------------------------------------

select pg_temp.admin();
update public.businesses set state = 'listed' where name = 'Casa Azul';
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select count(*)::int from public.top_rated_by('00000000-0000-0000-0000-0000000000c3')),
  1,
  'your own best places show on your profile'
);
select pg_temp.admin();
update public.users set status = 'suspended' where id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (select count(*)::int from public.top_rated_by('00000000-0000-0000-0000-0000000000c3')),
  0,
  'and go dark exactly where the rest of that profile does'
);

-- REPORTING HOW A BUSINESS BEHAVED ------------------------------------------
--
-- The five original reasons were all complaints about the LISTING. A hostel
-- is a room this app sends strangers into, so "somebody there treated me
-- badly" has to be sayable, and it has to reach the same queue a report about
-- a person reaches. 20260902110000 adds the two labels and teaches the
-- escalation trigger to tell the two kinds apart.

select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
-- The owner of Casa Azul, refused - and refused one line EARLIER than you
-- would guess. report_business checks is_business_account before it checks
-- owns_business, so the owner never reaches "that is your own listing": they
-- are turned away for being a business account at all, which is rule 8 and is
-- also the answer for a rival bar trying to file against this one.
select throws_ok(
  $$ select public.report_business(pg_temp.biz(), 'harassment_or_conduct') $$,
  'a business account cannot do that',
  'a business account reports nobody, its own listing included'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'harassment_or_conduct',
       'the guy on the door followed me out') $$,
  'a traveler can report how a business behaved, not only whether the pin is right'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'business' and action = 'conduct_report'
      and entity_id = pg_temp.biz()),
  1,
  'and it lands in the moderation spine, beside the reports about people'
);

-- The other half of the same branch. An accuracy complaint is a map
-- correction, and a map correction is not an accusation about anybody.
select pg_temp.admin();
update public.users set status = 'active' where id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'wrong_location') $$,
  'an accuracy complaint still files exactly as it always did'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'business' and action = 'conduct_report'),
  1,
  'and adds nothing to that queue, because it is not about a person'
);

-- The reporter learns nothing, second time included. The unique index takes
-- one report per account and the insert silently does nothing on the second,
-- so the app can say the same sentence both times - "you already reported
-- this" would be the app telling whoever is holding the phone what this
-- account did before.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ select public.report_business(pg_temp.biz(), 'unsafe') $$,
  'reporting the same business again says the same nothing'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.business_reports
    where business_id = pg_temp.biz()
      and reporter_user_id = '00000000-0000-0000-0000-0000000000a3'),
  1,
  'and there is still one report from that account rather than two'
);

select * from finish();
rollback;
