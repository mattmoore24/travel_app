-- Did you two actually meet: asked once, and answered where the other person
-- can never reach it.
--
-- This file is written as the ATTACK, because the failure mode is silent.
-- Every assertion below passes on an implementation that is also a
-- reciprocal-interest reveal, EXCEPT the ones in PART TWO and PART FIVE, and
-- those are the whole point:
--
--   * The obvious wrong implementation reads the other participant's row.
--     "Show the prompt until both have answered" is a boolean that publishes
--     the other person's answer perfectly without ever naming it. Assertion
--     "still due" after the first answer is the one that catches it.
--
--   * The second wrong implementation lets a stranger insert for a chat they
--     are not in. The row would be unreadable to them afterwards, so nothing
--     looks wrong - but it takes the primary key, and that silences somebody
--     else's prompt from the outside. That is the attack in PART FOUR.
--
--   * The third is not about reads at all. 20260902220000 is the cautionary
--     tale: a bookkeeping write that touched nothing a client could read
--     still leaked a presence feed, through a trigger nobody was looking at.
--     So PART THREE asserts that writing an answer fires nothing, publishes
--     nothing, and leaves the other person's chat list byte-identical.
begin;
select plan(35);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'meet-ana@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'meet-bea@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'meet-cai@example.com'),
  ('00000000-0000-0000-0000-0000000000e4', 'meet-dee@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'meet-eve@example.com'),
  ('00000000-0000-0000-0000-0000000000e6', 'meet-fay@example.com'),
  ('00000000-0000-0000-0000-0000000000e7', 'meet-gus@example.com'),
  ('00000000-0000-0000-0000-0000000000e8', 'meet-hal@example.com'),
  ('00000000-0000-0000-0000-0000000000e9', 'meet-ivy@example.com'),
  ('00000000-0000-0000-0000-0000000000ea', 'meet-jo@example.com'),
  ('00000000-0000-0000-0000-0000000000eb', 'meet-kit@example.com'),
  ('00000000-0000-0000-0000-0000000000ec', 'meet-lou@example.com');

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

-- Back to postgres AND clear the claims.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- Claims without the role switch: enough for auth.uid() inside a definer
-- function, while the session still has postgres's privileges. This is how
-- the "before" snapshot in PART THREE is taken.
create function pg_temp.as_uid(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Definer helpers, CREATED HERE, before the first login: a function created
-- while the session is `set role authenticated` is owned by authenticated, so
-- `security definer` defines it as exactly the role it was meant to escape
-- and it silently returns null. And a pg_temp FUNCTION rather than a temp
-- TABLE, because a temp table has no privileges once the suite switches role
-- (the traps skill).
--
-- The chat id has to come this way at all because `chats` carries no select
-- policy for its own participants - my_chats() is a definer function - so a
-- fixture that read it as the traveler would hand back null and every
-- assertion after it would be about the null chat.
create function pg_temp.chat_of(a uuid, b uuid) returns uuid
language sql security definer as $$
  select p1.chat_id
  from public.chat_participants p1
  join public.chat_participants p2 on p2.chat_id = p1.chat_id
  where p1.user_id = $1 and p2.user_id = $2
  limit 1
$$;

create function pg_temp.hello(sender uuid, recipient uuid) returns uuid
language sql security definer as $$
  select id from public.message_requests
  where sender_id = $1 and recipient_id = $2
$$;

create function pg_temp.pair_a() returns uuid language sql as $$
  select pg_temp.chat_of('00000000-0000-0000-0000-0000000000e1',
                         '00000000-0000-0000-0000-0000000000e2') $$;

-- The chat list row the other traveler sees, as text. PART THREE compares it
-- across somebody else's answer.
create function pg_temp.chat_row(p_chat uuid) returns text language sql stable as $$
  select t::text from public.my_chats() t where t.chat_id = p_chat
$$;

-- Five pairs, one trip each, so nobody is near the active-trip cap.
--
--   A (e1,e2)  shared window ended YESTERDAY  - the due case
--   B (e3,e4)  shared window still open       - too early
--   C (e5,e6)  aged to 31 days ago below      - past the tail
--   D (e7,e8)  ended yesterday, then a report - the bad moment
--   E (e9,ea)  ended yesterday, then a block  - the other bad moment
--   F (eb,ec)  ended yesterday                - the sideways-write control
--
-- Pair D and pair F are separate on purpose. PART THREE needs somebody to
-- answer, and PART FIVE needs a pair where NEITHER has, so that "still asked"
-- means something.
--
-- current_date - 1 is the earliest end date validate_trip_dates accepts, and
-- it is also exactly the boundary meet_prompt_due is written against: the day
-- AFTER the last shared date, never before.
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000e1', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e2', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e3', pg_temp.lisbon(), current_date - 2, current_date + 3),
  ('00000000-0000-0000-0000-0000000000e4', pg_temp.lisbon(), current_date - 2, current_date + 3),
  ('00000000-0000-0000-0000-0000000000e5', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e6', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e7', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e8', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000e9', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000ea', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000eb', pg_temp.lisbon(), current_date - 5, current_date - 1),
  ('00000000-0000-0000-0000-0000000000ec', pg_temp.lisbon(), current_date - 5, current_date - 1);

-- Five accepted chats, through the ordinary door.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.send_message_request('00000000-0000-0000-0000-0000000000e2',
  'trip_match', 'Which miradouro wins at sunset?', 'bio');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000e1',
                '00000000-0000-0000-0000-0000000000e2'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select public.send_message_request('00000000-0000-0000-0000-0000000000e4',
  'trip_match', 'Any coworking cafe tips while our dates overlap?', 'bio');
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000e3',
                '00000000-0000-0000-0000-0000000000e4'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e5');
select public.send_message_request('00000000-0000-0000-0000-0000000000e6',
  'trip_match', 'Is the tram worth it or is it a tourist trap?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000e5',
                '00000000-0000-0000-0000-0000000000e6'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select public.send_message_request('00000000-0000-0000-0000-0000000000e8',
  'trip_match', 'Up for a pastel de nata crawl before we both leave?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000e7',
                '00000000-0000-0000-0000-0000000000e8'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select public.send_message_request('00000000-0000-0000-0000-0000000000ea',
  'trip_match', 'Fancy splitting a taxi out to Sintra?', 'trip');
select pg_temp.login('00000000-0000-0000-0000-0000000000ea');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000e9',
                '00000000-0000-0000-0000-0000000000ea'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000eb');
select public.send_message_request('00000000-0000-0000-0000-0000000000ec',
  'trip_match', 'Any good day trips out of the city?', 'bio');
select pg_temp.login('00000000-0000-0000-0000-0000000000ec');
select public.respond_to_message_request(
  pg_temp.hello('00000000-0000-0000-0000-0000000000eb',
                '00000000-0000-0000-0000-0000000000ec'), true);

-- Pair C ages past the tail. The date trigger refuses to move a trip
-- wholesale into the past, which is correct for a traveler and in the way
-- here, so it comes off for one statement.
select pg_temp.admin();
alter table public.trips disable trigger trips_validate_dates;
update public.trips
   set start_date = current_date - 35, end_date = current_date - 31
 where user_id in ('00000000-0000-0000-0000-0000000000e5',
                   '00000000-0000-0000-0000-0000000000e6');
alter table public.trips enable trigger trips_validate_dates;

-- =========================================================================
-- PART ONE. The question arrives at the right moment, and only then.
-- =========================================================================

-- 1-2. The day after the last date they shared, for BOTH of them.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select ok(
  public.meet_prompt_due(pg_temp.pair_a()),
  'the question is due the day after the last shared date'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select ok(
  public.meet_prompt_due(pg_temp.pair_a()),
  'and it is due for the other traveler too'
);

-- 3. Never before. Pair B still has days left together, and asking mid-trip
-- would be asking about a trip that has not happened.
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e3',
                    '00000000-0000-0000-0000-0000000000e4')),
  'and never while the two of you still share dates'
);

-- 4. And not forever. Without the tail, the day this ships every chat any
-- traveler ever had asks at once.
select pg_temp.login('00000000-0000-0000-0000-0000000000e5');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e5',
                    '00000000-0000-0000-0000-0000000000e6')),
  'a trip that ended a month ago is not asked about'
);

-- =========================================================================
-- PART TWO. One answer, private, and permanent.
-- =========================================================================

-- 5-6. Ana answers. The card is gone for her, for good.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select ok(
  public.answer_meet_prompt(pg_temp.pair_a(), 'yes'),
  'a participant can answer once'
);
select ok(
  not public.meet_prompt_due(pg_temp.pair_a()),
  'and is never asked again'
);

-- 7. THE ASSERTION THIS FILE EXISTS FOR. Bea is still due. An implementation
-- that waits for both answers, or that dismisses on either, publishes Ana's
-- answer to Bea in a boolean - and passes every other test here.
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select ok(
  public.meet_prompt_due(pg_temp.pair_a()),
  'the other traveler is still asked: their prompt knows nothing of the first answer'
);

-- 8. And Bea cannot read the answer itself, which is the same rule stated at
-- the table.
select is(
  (select count(*)::int from public.chat_meet_answers),
  0,
  'and cannot read the other answer at all'
);

-- 9-11. Bea answers differently. Each of them reads exactly one row, their
-- own, whichever order they answered in.
select ok(
  public.answer_meet_prompt(pg_temp.pair_a(), 'no'),
  'the other traveler answers for themselves'
);
select is(
  (select answer::text from public.chat_meet_answers),
  'no',
  'and reads back their own answer and no other'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is(
  (select string_agg(answer::text, ',' order by answer::text)
     from public.chat_meet_answers),
  'yes',
  'the first traveler still sees one row, still their own, after the second answered'
);

-- 12-13. Asked once means once. A second tap is not an error and not an edit.
select is(
  public.answer_meet_prompt(pg_temp.pair_a(), 'unsure'),
  false,
  'a second answer is a no-op rather than an error'
);
select is(
  (select answer::text from public.chat_meet_answers),
  'yes',
  'and the first answer stands'
);

-- 14-15. There is no update and no delete, at the grant as well as the
-- policy, so "permanent dismissal" is a fact about the database.
select throws_ok(
  format($$ update public.chat_meet_answers set answer = 'no' where chat_id = %L $$,
         pg_temp.pair_a()),
  '42501',
  null,
  'an answer cannot be edited'
);
select throws_ok(
  format($$ delete from public.chat_meet_answers where chat_id = %L $$,
         pg_temp.pair_a()),
  '42501',
  null,
  'nor taken back'
);

-- =========================================================================
-- PART THREE. The write publishes nothing sideways.
-- =========================================================================
--
-- 20260902220000 in one line: a write that touched nothing a client could
-- read still leaked, because of a trigger on the row it touched.

-- 16. Nothing fires when an answer is written.
select pg_temp.admin();
select is(
  (select count(*)::int
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'chat_meet_answers' and not t.tgisinternal),
  0,
  'writing an answer fires no trigger, so it can touch nothing else'
);

-- 17. And it is not broadcast. A realtime publication on this table would
-- push an insert down the channel the other person's thread is subscribed to.
--
-- The control above it is the whole assertion. Until the shim created an empty
-- `supabase_realtime` publication, no publication existed locally at all,
-- `pg_publication_tables` was permanently empty, and this count could only
-- ever be 0 — it passed for a table that WAS published. The control proves the
-- catalog can answer the question before the guard is allowed to answer it.
select ok(
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and tablename = 'messages'),
  'realtime is wired locally at all, so the next assertion can fail'
);
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_meet_answers'),
  0,
  'and is not published to realtime, where the other side is listening'
);

-- 18. The other traveler's chat list row is unchanged by an answer - not its
-- ordering, not its last message, not its unread count. Pair F, where nobody
-- has answered yet, so the comparison is against a clean row.
select pg_temp.as_uid('00000000-0000-0000-0000-0000000000ec');
create temp table lou_row as
  select pg_temp.chat_row(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000eb',
                    '00000000-0000-0000-0000-0000000000ec')) as was;

select pg_temp.login('00000000-0000-0000-0000-0000000000eb');
select public.answer_meet_prompt(
  pg_temp.chat_of('00000000-0000-0000-0000-0000000000eb',
                  '00000000-0000-0000-0000-0000000000ec'), 'yes');

select pg_temp.admin();
select pg_temp.as_uid('00000000-0000-0000-0000-0000000000ec');
select is(
  pg_temp.chat_row(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000eb',
                    '00000000-0000-0000-0000-0000000000ec')),
  (select was from lou_row),
  'and the other side''s chat list row is identical afterwards'
);

-- =========================================================================
-- PART FOUR. A stranger cannot answer for a chat they are not in.
-- =========================================================================
--
-- The row would be invisible to them the moment it landed, so nothing about
-- this attack looks like an attack. What it takes is the primary key, and
-- with it somebody else's one chance to answer.

select pg_temp.admin();
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');

-- 19-20. Through the door the client uses, and straight at the table.
select throws_ok(
  format($$ select public.answer_meet_prompt(%L, 'yes') $$,
         pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                         '00000000-0000-0000-0000-0000000000ea')),
  '42501',
  null,
  'a stranger cannot answer for a chat they are not in'
);
select throws_ok(
  format($$ insert into public.chat_meet_answers (chat_id, user_id, answer)
            values (%L, %L, 'yes') $$,
         pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                         '00000000-0000-0000-0000-0000000000ea'),
         '00000000-0000-0000-0000-0000000000e3'),
  '42501',
  null,
  'nor straight at the table'
);

-- 21. Nor for a chat they are in, wearing somebody else's id.
select throws_ok(
  format($$ insert into public.chat_meet_answers (chat_id, user_id, answer)
            values (%L, %L, 'yes') $$,
         pg_temp.chat_of('00000000-0000-0000-0000-0000000000e3',
                         '00000000-0000-0000-0000-0000000000e4'),
         '00000000-0000-0000-0000-0000000000e4'),
  '42501',
  null,
  'nor answer on behalf of the person they are chatting with'
);

-- 22. A chat they are not in is never due for them either.
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                    '00000000-0000-0000-0000-0000000000ea')),
  'and a chat they are not in is never due for them'
);

-- 23. And the attack silenced nobody: Ivy is still asked.
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select ok(
  public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                    '00000000-0000-0000-0000-0000000000ea')),
  'the traveler the stranger aimed at is still asked'
);

-- =========================================================================
-- PART FIVE. Never after a bad moment.
-- =========================================================================

-- 24-25. A report silences the reporter's own prompt, and ONLY theirs. If it
-- silenced the reported person's too, its absence would tell them they had
-- been reported.
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
insert into public.reports (reporter_id, reported_user_id, reason, context)
values ('00000000-0000-0000-0000-0000000000e8',
        '00000000-0000-0000-0000-0000000000e7', 'harassment', 'chat');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e7',
                    '00000000-0000-0000-0000-0000000000e8')),
  'somebody who reported the other traveler is not asked whether they met'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select ok(
  public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e7',
                    '00000000-0000-0000-0000-0000000000e8')),
  'and the person they reported is still asked, so the missing card tells nobody'
);

-- 26. Rule 8 and the shape of the chat. A room or a business conversation is
-- never asked about: this is a question between two travelers.
--
-- ON PAIR D, AND THE PAIR IS THE ASSERTION. This flipped pair B until now,
-- whose window has not ended - so meet_prompt_due was already false for it
-- before the kind moved, and deleting `and c.kind = 'direct'` from the
-- function left this passing. The only behavioural test that a room is never
-- asked about proved nothing at all.
--
-- Gus was due one line ago (assertion 25, and it is the same login and the
-- same chat). Nothing about him, his trip or his standing changes here. The
-- only thing that moves is the kind of the conversation, so a true below can
-- come from nowhere but the predicate.
select pg_temp.admin();
update public.chats set kind = 'room'
 where id = pg_temp.chat_of('00000000-0000-0000-0000-0000000000e7',
                            '00000000-0000-0000-0000-0000000000e8');
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e7',
                    '00000000-0000-0000-0000-0000000000e8')),
  'the traveler who was due a moment ago is not asked once it is not a one-to-one chat'
);

-- 27-28. A block closes the chat, and a closed chat is not asked about, from
-- either side.
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-0000000000e9',
        '00000000-0000-0000-0000-0000000000ea');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                    '00000000-0000-0000-0000-0000000000ea')),
  'a chat that ended in a block is not asked about'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000ea');
select ok(
  not public.meet_prompt_due(
    pg_temp.chat_of('00000000-0000-0000-0000-0000000000e9',
                    '00000000-0000-0000-0000-0000000000ea')),
  'and not from the other side either'
);

-- =========================================================================
-- PART SIX. The grants, which are the enforcement layer.
-- =========================================================================

-- 29-30. anon has no table at all, and no functions.
select pg_temp.admin();
select ok(
  not has_table_privilege('anon', 'public.chat_meet_answers', 'select'),
  'anon cannot read the answers table'
);
select ok(
  not has_table_privilege('anon', 'public.chat_meet_answers', 'insert'),
  'nor write to it'
);

set local role anon;
select throws_ok(
  $$ select public.meet_prompt_due('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501',
  null,
  'anon cannot execute meet_prompt_due'
);
-- Not throws_ok for this one. answer_meet_prompt is SECURITY INVOKER and its
-- only statement inserts into chat_meet_answers, on which anon holds no
-- INSERT — so anon gets 42501 from the TABLE grant whether or not the
-- function's own EXECUTE is revoked, and the assertion would pass on a schema
-- where the function is wide open. The privilege is the thing being claimed,
-- so ask about the privilege.
select ok(
  not has_function_privilege('anon', 'public.answer_meet_prompt(uuid, text)', 'execute'),
  'anon cannot execute answer_meet_prompt'
);
reset role;

-- 33. A client never reads the aggregate either. It is counts and months, and
-- still service-role only, because a view created without its revoke is
-- readable by every signed-in account.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok(
  $$ select * from public.admin_meet_answers $$,
  '42501',
  null,
  'a client cannot read the aggregate'
);

-- 34. And the aggregate the founder does read is a rate, not a log: it counts
-- and it never carries a chat or a pair.
select pg_temp.admin();
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_meet_answers'
      and column_name in ('chat_id', 'user_id')),
  0,
  'and the aggregate names no chat and no person'
);

reset role;
select * from finish();
rollback;
