-- Joining somebody's plan is felt: a line in the chat, a push to the host.
--
-- The rules under test are the ones a client could not fake and a regression
-- would silently eat: the join writes exactly one 'joined' message (so the
-- host's unread_count moves and the chat row earns its dot), the push goes to
-- the host alone and never fans out, the cap stops at the fifth join, a muted
-- host is not rung, a leave-and-rejoin does not announce twice — and an
-- ordinary message in the same room still fans out to everybody, which is the
-- regression the new branch in enqueue_message_push could cause.
begin;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ana@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'cara@example.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'dave@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'edie@example.com'),
  ('00000000-0000-0000-0000-0000000000f1', 'fred@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'gina@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Ana'
  where user_id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set display_name = 'Bob'
  where user_id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set display_name = 'Gina'
  where user_id = '00000000-0000-0000-0000-0000000000a2';

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
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

create function pg_temp.pin_named(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.pins where venue_name = p_name $$;

create function pg_temp.chat_of(p_name text) returns uuid language sql
security definer set search_path = public as
  $$ select g.chat_id from public.groups g
     join public.pins p on p.id = g.pin_id where p.venue_name = p_name $$;

-- Pushes queued for one chat, read as admin (push_queue is server-only).
create function pg_temp.pushes_for(p_chat uuid) returns int language sql
security definer set search_path = public as
  $$ select count(*)::int from public.push_queue
     where data->>'chat_id' = p_chat::text $$;

-- THE JOIN WRITES A LINE -------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Sunset picnic', 'come along', null, 'other',
       38.7071, -9.1458, current_date, now() + interval '24 hours') $$,
  'the host opens a plan to join'
);

-- Everything in a pgTAP file shares one transaction now(), so the host''s
-- joined_at would otherwise equal the join line''s created_at and the strict
-- unread comparison would exclude it. Backdate the host the way 12_unread
-- does.
select pg_temp.admin();
update public.room_members
  set joined_at = now() - interval '1 hour'
  where chat_id = pg_temp.chat_of('Sunset picnic');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(
  (select unread_count from public.my_chats()
    where chat_id = pg_temp.chat_of('Sunset picnic')),
  0,
  'before anybody joins, the host has nothing unread'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'somebody joins the plan'
);

select pg_temp.admin();
select is(
  (select count(*)::int from public.messages
    where chat_id = pg_temp.chat_of('Sunset picnic') and kind = 'joined'),
  1,
  'the join writes exactly one message with kind joined'
);
select is(
  (select body from public.messages
    where chat_id = pg_temp.chat_of('Sunset picnic') and kind = 'joined'),
  'Bob is in',
  'and the line names the person who arrived'
);

-- The system voice cannot be forged: a member's own insert may say things,
-- never announce arrivals. join_pin_chat is SECURITY DEFINER, which is why
-- the joined rows above exist at all.
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body, kind)
     values (pg_temp.chat_of('Sunset picnic'),
             '00000000-0000-0000-0000-0000000000b1',
             'Host cancelled this, do not come', 'joined') $$,
  'Only the app writes system lines.',
  'a member cannot insert a joined line of their own'
);
select pg_temp.admin();

-- THE DOT: UNREAD MOVES FOR THE HOST, NOT THE JOINER ---------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(
  (select unread_count from public.my_chats()
    where chat_id = pg_temp.chat_of('Sunset picnic')),
  1,
  'the host''s unread_count goes from 0 to 1'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select unread_count from public.my_chats()
    where chat_id = pg_temp.chat_of('Sunset picnic')),
  0,
  'while the joiner''s own stays 0'
);

-- THE PUSH: HOST ONLY, SAYING WHAT HAPPENED ------------------------------------

select pg_temp.admin();
select is(
  pg_temp.pushes_for(pg_temp.chat_of('Sunset picnic')),
  1,
  'exactly one push is queued for the join'
);
select is(
  (select user_id from public.push_queue
    where data->>'chat_id' = pg_temp.chat_of('Sunset picnic')::text),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'and it is addressed to the host, not to every member'
);
select is(
  (select body from public.push_queue
    where data->>'chat_id' = pg_temp.chat_of('Sunset picnic')::text),
  'Bob is in. That makes 2.',
  'the push carries the line and the going count'
);
select is(
  (select data->>'type' from public.push_queue
    where data->>'chat_id' = pg_temp.chat_of('Sunset picnic')::text),
  'message',
  'typed like every message push, so old clients tolerate it'
);
select is(
  (select data->>'kind' from public.push_queue
    where data->>'chat_id' = pg_temp.chat_of('Sunset picnic')::text),
  'room',
  'and routed to the room by the payload convention'
);

-- LEAVING AND REJOINING IS ONE ARRIVAL -----------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.leave_room(pg_temp.chat_of('Sunset picnic')) $$,
  'the joiner can leave'
);
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'and rejoin'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.messages
    where chat_id = pg_temp.chat_of('Sunset picnic') and kind = 'joined'),
  1,
  'without posting a second line'
);
select is(
  pg_temp.pushes_for(pg_temp.chat_of('Sunset picnic')),
  1,
  'or ringing the host again'
);

-- THE CAP: FIVE PUSHES, THEN QUIET ---------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'a second joiner'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'a third'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'a fourth'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'a fifth'
);
select pg_temp.admin();
select is(
  pg_temp.pushes_for(pg_temp.chat_of('Sunset picnic')),
  5,
  'the first five joins each ring the host'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Sunset picnic')) $$,
  'a sixth joiner is welcome'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.messages
    where chat_id = pg_temp.chat_of('Sunset picnic') and kind = 'joined'),
  6,
  'and still gets their line in the thread'
);
select is(
  pg_temp.pushes_for(pg_temp.chat_of('Sunset picnic')),
  5,
  'but the sixth join queues no push'
);

-- THE REGRESSION THE BRANCH COULD CAUSE ----------------------------------------
-- An early return written slightly wrong would suppress ordinary chat pushes
-- for the whole room, silently. Prove a normal message still fans out.

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.chat_of('Sunset picnic'),
             '00000000-0000-0000-0000-0000000000a2', 'on my way now') $$,
  'a member talks in the room after five joins'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where data->>'chat_id' = pg_temp.chat_of('Sunset picnic')::text
      and body like '%on my way now%'),
  6,
  'and the message fans out to all six other members as before'
);

-- A MUTED HOST IS NOT RUNG -----------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Quiz night', null, null, 'bar',
       38.7100, -9.1400, current_date, now() + interval '24 hours') $$,
  'the host opens a second plan'
);
select lives_ok(
  $$ select public.set_chat_pref(pg_temp.chat_of('Quiz night'), null, true, null) $$,
  'and mutes its chat'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.pin_named('Quiz night')) $$,
  'somebody joins the muted plan'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.messages
    where chat_id = pg_temp.chat_of('Quiz night') and kind = 'joined'),
  1,
  'the line is still written'
);
select is(
  pg_temp.pushes_for(pg_temp.chat_of('Quiz night')),
  0,
  'but a muted host gets no push'
);

select * from finish();
rollback;
