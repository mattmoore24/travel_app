-- Reading a conversation past its first screenful.
--
-- The cap was always there (room_messages has taken a limit since it was
-- written) and no client ever passed one, so a busy room simply ended. Paging
-- it backwards adds a cursor, and a cursor is the kind of parameter that
-- quietly becomes an access route: the attack this file is written around is
-- a non-member passing p_before and getting rows they could not otherwise
-- read.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000fa1', 'paige@example.com'),
  ('00000000-0000-0000-0000-000000000fa2', 'pedro@example.com'),
  ('00000000-0000-0000-0000-000000000fa3', 'priya@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Paige'
  where user_id = '00000000-0000-0000-0000-000000000fa1';

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

-- Read the id from `groups`, never from `chats`: chats carries no select
-- policy for room members, so a helper joining it returns NULL the moment the
-- suite becomes `authenticated` and every insert afterwards goes to a null
-- chat (see the traps skill).
create function pg_temp.crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Paging crew' $$;

select pg_temp.login('00000000-0000-0000-0000-000000000fa1');
select lives_ok(
  $$ select public.create_group('Paging crew', (current_date + 30)::date) $$,
  'somebody starts a group'
);

-- Five messages, an hour apart, so the cursor has something to cut through.
-- Written as the admin: the point of this file is the READ path, and
-- backdating created_at is not something a client may do.
select pg_temp.admin();
insert into public.messages (chat_id, sender_id, body, created_at)
select pg_temp.crew(), '00000000-0000-0000-0000-000000000fa1',
       'message ' || n, now() - make_interval(hours => 5 - n)
from generate_series(1, 5) as n;

-- THE CAP AND THE CURSOR -------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-000000000fa1');

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew())),
  5,
  'the whole thread comes back when nothing is asked for'
);

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 2)),
  2,
  'a limit is honoured'
);

select is(
  (select body from public.room_messages(pg_temp.crew(), 1)),
  'message 5',
  'and the first page is the NEWEST messages, which is what an inverted list wants'
);

-- The cursor: everything at or after it is excluded.
create function pg_temp.third_oldest() returns timestamptz language sql
security definer set search_path = public as
  $$ select created_at from public.messages
      where chat_id = pg_temp.crew() and body = 'message 3' $$;

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 60, pg_temp.third_oldest())),
  2,
  'p_before excludes the row at that timestamp and everything newer'
);

select is(
  (select array_agg(body order by created_at)
     from public.room_messages(pg_temp.crew(), 60, pg_temp.third_oldest())),
  array['message 1', 'message 2'],
  'leaving exactly the older page'
);

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 60,
    (select min(created_at) from public.room_messages(pg_temp.crew())))),
  0,
  'and paging past the oldest message returns nothing, which is what ends paging'
);

-- The cap still clamps. 500 asked for, 200 is the ceiling the function has
-- always enforced, and a cursor must not become a way around it.
select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 500)),
  5,
  'asking for more than the ceiling is clamped rather than refused'
);

-- THE ATTACK: A CURSOR IS NOT AN ACCESS TOKEN ----------------------------------
--
-- A private group is readable by its members and nobody else. The paging
-- parameter is new surface on that function, so the refusal has to be proven
-- with the parameter in play, not only without it.

select pg_temp.login('00000000-0000-0000-0000-000000000fa2');

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew())),
  0,
  'a non-member reads nothing from a private group'
);

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 60, pg_temp.third_oldest())),
  0,
  'and still nothing when they pass a cursor into the middle of it'
);

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 200, now() + interval '1 day')),
  0,
  'or a cursor past the end of the conversation'
);

select is(
  (select count(*)::int from public.room_messages(pg_temp.crew(), 500, null)),
  0,
  'or the largest page the function will draw'
);

select * from finish();
rollback;
