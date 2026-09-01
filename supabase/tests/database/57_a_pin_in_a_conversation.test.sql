-- A pin in a conversation, who reacted, and a group that records its churn.
--
-- Written as attacks, because all three packages hand somebody a new way to
-- ask the database a question:
--
--   * a message can carry a PIN, so the questions are whose pin it may carry
--     and what happens the moment that pin expires. §7 rule 3 says an expired
--     pin is unreadable to everybody, its owner included, and a chat must not
--     become the way around that — so the read path has to null it rather than
--     the app having to remember to hide it.
--   * message_reactors NAMES PEOPLE. In a room that is an RSVP; in a chat with
--     two people in it, it is a reciprocal-interest reveal arrived at from the
--     side, which is exactly what §7 exists to stop. The refusal has to be in
--     the function.
--   * a membership log is a record of WHO WAS WHERE AND WHEN. A business room
--     can be read signed-out wherever the business left its preview on, so the
--     last case here is a stranger reading a public room and finding nothing
--     about who is in it.
begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000057a1', 'nina@example.com'),
  ('00000000-0000-0000-0000-0000000057a2', 'omar@example.com'),
  ('00000000-0000-0000-0000-0000000057a3', 'pia@example.com'),
  ('00000000-0000-0000-0000-0000000057a4', 'quinn@example.com'),
  ('00000000-0000-0000-0000-0000000057ff', 'staff57@hostel.example');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Nina'
  where user_id = '00000000-0000-0000-0000-0000000057a1';
update public.profiles set display_name = 'Omar'
  where user_id = '00000000-0000-0000-0000-0000000057a2';
update public.profiles set display_name = 'Pia'
  where user_id = '00000000-0000-0000-0000-0000000057a3';
update public.profiles set display_name = 'Quinn'
  where user_id = '00000000-0000-0000-0000-0000000057a4';

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

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Functions, never temp tables: the suite switches into `authenticated`, which
-- has no privileges on anything in pg_temp. And the chat id is read from
-- `groups`, never through `chats`, which carries no select policy for room
-- members (both traps are in the skill).
create function pg_temp.crew(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = p_name $$;

create function pg_temp.said(p_body text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.messages where body = p_body $$;

create function pg_temp.pin_named(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.pins where venue_name = p_name $$;

create function pg_temp.token() returns text language sql
security definer set search_path = public as
  $$ select token from public.group_invites
      where chat_id = pg_temp.crew('Pin crew')
      order by created_at desc limit 1 $$;

create function pg_temp.lines_of(p_chat uuid, p_kind text) returns text
language sql security definer set search_path = public as
  $$ select string_agg(body, ' | ' order by created_at)
       from public.messages
      where chat_id = p_chat and kind::text = p_kind $$;

-- ============================================================================
-- A PIN IN A CONVERSATION
-- ============================================================================

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select lives_ok(
  $$ select public.create_group('Pin crew', (current_date + 30)::date) $$,
  'somebody starts a group'
);
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, category, lat, lng, intent_date, expires_at)
     values ('00000000-0000-0000-0000-0000000057a1', pg_temp.lisbon(),
             'Park Bar', 'Sunset drinks', 'bar', 38.7160, -9.1450,
             current_date, now() + interval '20 hours') $$,
  'and drops a pin of their own'
);

-- The link is minted and used here so Omar is in the room for the next case,
-- and so the arrival line further down has something to describe.
select public.group_invite_token(pg_temp.crew('Pin crew'));
select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
select public.join_group_with_invite(pg_temp.token(), (current_date + 5)::date);

-- THE ATTACK: A MESSAGE CANNOT CARRY SOMEBODY ELSE'S PLAN ---------------------
--
-- Both of them are in this room and Omar can read the pin on the map, so this
-- is not about what he may see. It is about a plan appearing in the thread
-- under his name and his face, with somebody else's evening in it.
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body, pin_id)
     values (pg_temp.crew('Pin crew'), '00000000-0000-0000-0000-0000000057a2',
             'look at this', pg_temp.pin_named('Park Bar')) $$,
  'You can only send a plan of your own that is still on.',
  'a message cannot carry somebody else''s pin'
);

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body, pin_id)
     values (pg_temp.crew('Pin crew'), '00000000-0000-0000-0000-0000000057a1',
             'this one?', pg_temp.pin_named('Park Bar')) $$,
  'while the person whose plan it is can send it'
);

select is(
  (select pin_venue_name from public.room_messages(pg_temp.crew('Pin crew'))
    where body = 'this one?'),
  'Park Bar',
  'the thread reads back the venue'
);
select is(
  (select pin_intent_date from public.room_messages(pg_temp.crew('Pin crew'))
    where body = 'this one?'),
  current_date,
  'and the day the plan is for'
);

-- HARD RULE 3: THE PIN GOES DARK AT EXPIRY -----------------------------------
--
-- Backdated rather than swept, because the gap between a pin expiring and
-- expire_pins deleting it is up to fifteen minutes, and it is exactly the
-- window in which a chat could still be reading a dead plan. The row is still
-- there; the answer must already be nothing.
select pg_temp.admin();
update public.pins set expires_at = now() - interval '1 minute'
  where venue_name = 'Park Bar';

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select is(
  (select pin_venue_name from public.room_messages(pg_temp.crew('Pin crew'))
    where body = 'this one?'),
  null,
  'an expired pin comes back with its fields nulled, to its own author'
);
select is(
  (select pin_id from public.room_messages(pg_temp.crew('Pin crew'))
    where body = 'this one?'),
  null,
  'and with no id either, so nothing downstream can go looking for it'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body, pin_id)
     values (pg_temp.crew('Pin crew'), '00000000-0000-0000-0000-0000000057a1',
             'again?', pg_temp.pin_named('Park Bar')) $$,
  'You can only send a plan of your own that is still on.',
  'and an expired plan cannot be sent again'
);

-- JOINING A PLAN SOMEBODY SENT ------------------------------------------------
--
-- The tapper gets their OWN pin at the same venue and day, which is what puts
-- a plan agreed in a chat onto the map. Ordered before the expiry case below
-- so there is a live plan to copy.

select pg_temp.admin();
update public.pins set expires_at = now() + interval '20 hours'
  where venue_name = 'Park Bar';

select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
select lives_ok(
  $$ select public.copy_plan_from_message(pg_temp.said('this one?')) $$,
  'somebody in the conversation can join the plan it carries'
);
select is(
  (select count(*)::int from public.pins
    where user_id = '00000000-0000-0000-0000-0000000057a2'
      and venue_name = 'Park Bar'),
  1,
  'which posts a pin of their own at the same venue'
);
-- Ten taps, one plan. The second answer is the pin the first tap made.
select public.copy_plan_from_message(pg_temp.said('this one?'));
select is(
  (select count(*)::int from public.pins
    where user_id = '00000000-0000-0000-0000-0000000057a2'
      and venue_name = 'Park Bar'),
  1,
  'and tapping it again does not post a second one'
);

-- Quinn is in no conversation with either of them, so the message id tells
-- them nothing.
select pg_temp.login('00000000-0000-0000-0000-0000000057a4');
select throws_ok(
  $$ select public.copy_plan_from_message(pg_temp.said('this one?')) $$,
  '42501',
  'That plan is not open to join any more.',
  'somebody outside the conversation cannot join a plan inside it'
);

-- ============================================================================
-- WHO REACTED — ROOMS AND GROUPS ONLY
-- ============================================================================

select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
select public.set_reaction(pg_temp.said('this one?'), '🔥');

select is(
  (select display_name from public.message_reactors(pg_temp.said('this one?'))),
  'Omar',
  'in a group, a member is told who reacted'
);
select is(
  (select emoji from public.message_reactors(pg_temp.said('this one?'))),
  '🔥',
  'and with which emoji'
);

-- Quinn is in no group with either of them.
select pg_temp.login('00000000-0000-0000-0000-0000000057a4');
select is(
  (select count(*)::int from public.message_reactors(pg_temp.said('this one?'))),
  0,
  'a signed-in stranger gets nothing for a message in a private group'
);

select pg_temp.guest();
select throws_ok(
  $$ select * from public.message_reactors(pg_temp.said('this one?')) $$,
  '42501',
  null,
  'and a signed-out visitor cannot call it at all'
);

-- THE §7 CASE: A ONE-TO-ONE CHAT NAMES NOBODY --------------------------------
--
-- A direct chat has exactly two people in it, so "who reacted" there answers
-- "does the other person like what I said" — a reciprocal-interest reveal by
-- another route. Refused in the function and not in the screen, because a
-- screen is not an enforcement.
select pg_temp.admin();
insert into public.chats (id, kind, status) values
  ('dddddddd-0000-4000-8000-000000000057', 'direct', 'active');
insert into public.chat_participants (chat_id, user_id) values
  ('dddddddd-0000-4000-8000-000000000057', '00000000-0000-0000-0000-0000000057a1'),
  ('dddddddd-0000-4000-8000-000000000057', '00000000-0000-0000-0000-0000000057a3');

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
insert into public.messages (chat_id, sender_id, body)
values ('dddddddd-0000-4000-8000-000000000057',
        '00000000-0000-0000-0000-0000000057a1', 'rooftop at 9?');
select pg_temp.login('00000000-0000-0000-0000-0000000057a3');
select public.set_reaction(pg_temp.said('rooftop at 9?'), '🔥');

select is(
  (select count(*)::int from public.message_reactors(pg_temp.said('rooftop at 9?'))),
  0,
  'a one-to-one chat names nobody, to either person in it'
);

-- ============================================================================
-- A GROUP RECORDS ITS CHURN
-- ============================================================================

select pg_temp.admin();
select is(
  pg_temp.lines_of(pg_temp.crew('Pin crew'), 'joined'),
  'Omar joined',
  'joining by invite writes a line naming the person'
);
select is(
  (select count(*)::int from public.push_queue where body like '%Omar joined%'),
  0,
  'and rings nobody: a line the room wrote is not a message anybody sent'
);

select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
select public.leave_room(pg_temp.crew('Pin crew'));
select pg_temp.admin();
select is(
  pg_temp.lines_of(pg_temp.crew('Pin crew'), 'left'),
  'Omar left',
  'leaving writes its own line'
);

-- Removal is not leaving, and the thread must not say it was. auth.uid() is
-- what tells them apart: SECURITY DEFINER changes the role, never the JWT.
select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select public.add_to_group(pg_temp.crew('Pin crew'), '00000000-0000-0000-0000-0000000057a3');
select public.room_remove_member(pg_temp.crew('Pin crew'),
                                 '00000000-0000-0000-0000-0000000057a3');
select pg_temp.admin();
select is(
  pg_temp.lines_of(pg_temp.crew('Pin crew'), 'removed'),
  'Pia was removed',
  'somebody taken out by an admin is not described as having left'
);

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select public.update_group(pg_temp.crew('Pin crew'),
                           p_max_stay_until => (current_date + 3)::date);
select pg_temp.admin();
select is(
  pg_temp.lines_of(pg_temp.crew('Pin crew'), 'ends'),
  'This group is now active until '
    || to_char((current_date + 3)::date, 'FMMon FMDD') || '.',
  'moving the end date says so in the thread'
);

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
select public.update_group(pg_temp.crew('Pin crew'), p_clear_max_stay => true);
select pg_temp.admin();
select ok(
  pg_temp.lines_of(pg_temp.crew('Pin crew'), 'ends')
    like '%This group no longer has an end date.',
  'and so does taking it off'
);

-- A BUSINESS ROOM IS NOT A GUEST LIST ----------------------------------------
--
-- The whole reason the log is scoped to traveler groups: a business room can
-- be read signed-out wherever the preview is on, so a join line there would
-- publish who is staying at a hostel to anybody who can see the hostel.
select pg_temp.admin();
insert into public.chats (id, kind) values
  ('bbbbbbbb-0000-4000-8000-000000000057', 'room');
insert into public.businesses
  (id, city_id, name, category, lat, lng, chat_id, state, listed_at)
values ('cccccccc-0000-4000-8000-000000000057', pg_temp.lisbon(),
        'Preview Hostel', 'hostel', 38.7100, -9.1400,
        'bbbbbbbb-0000-4000-8000-000000000057', 'listed', now());
insert into public.business_staff (business_id, user_id)
values ('cccccccc-0000-4000-8000-000000000057', '00000000-0000-0000-0000-0000000057ff');

select pg_temp.login('00000000-0000-0000-0000-0000000057a4');
select public.join_room('bbbbbbbb-0000-4000-8000-000000000057', current_date + 3);
select pg_temp.admin();
select is(
  (select count(*)::int from public.messages
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000057'),
  0,
  'joining a business room writes no line at all'
);

-- And the second half of the same promise: even a system line written into a
-- public room by some other path is only ever for the people in it. Written
-- here as the admin precisely because nothing else can write one.
select pg_temp.login('00000000-0000-0000-0000-0000000057a4');
insert into public.messages (chat_id, sender_id, body)
values ('bbbbbbbb-0000-4000-8000-000000000057',
        '00000000-0000-0000-0000-0000000057a4', 'anyone up for the walk?');
select pg_temp.admin();
select public.log_membership_line('bbbbbbbb-0000-4000-8000-000000000057',
  '00000000-0000-0000-0000-0000000057a4', 'joined', 'Quinn joined');

select pg_temp.guest();
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000057')),
  1,
  'a signed-out visitor still reads the public preview'
);
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000057')
    where kind::text <> 'said'),
  0,
  'and never a line about who is in the room'
);

-- A plan is withheld from that same reader for the same reason: a pin is
-- future intent gated on the map by audience and blocks, and a room left open
-- to the world is not a way around that gate.
select pg_temp.admin();
update public.pins set expires_at = now() + interval '10 hours'
  where venue_name = 'Park Bar';
insert into public.messages (chat_id, sender_id, body, pin_id)
values ('bbbbbbbb-0000-4000-8000-000000000057',
        '00000000-0000-0000-0000-0000000057a1', 'here is the spot',
        pg_temp.pin_named('Park Bar'));

select pg_temp.guest();
select is(
  (select pin_venue_name from public.room_messages('bbbbbbbb-0000-4000-8000-000000000057')
    where body = 'here is the spot'),
  null,
  'and reads no plan off a message in it'
);

select * from finish();
rollback;
