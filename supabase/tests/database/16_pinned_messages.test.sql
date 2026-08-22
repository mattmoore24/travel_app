-- Pinned messages: capped, expiring, moderator-only, and never outliving the
-- message they point at.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  -- Cara is in no room at all: the outsider the refusals must not talk to.
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

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

-- Alice runs the group; Bob is a member.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.create_group('Hostel crew', (current_date + 30)::date);

create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Hostel crew' $$;

select pg_temp.admin();
create temp table t_chat as select pg_temp.crew() as id;
grant select on pg_temp.t_chat to public;
insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000b',
          current_date + 5, now() + interval '5 days', 'member');

insert into public.messages (chat_id, sender_id, body) values
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Dinner at 8, Rua Nova 12'),
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Second thing'),
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Third thing'),
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Fourth thing'),
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Fifth thing');

create function pg_temp.msg(p_body text) returns uuid language sql as
  $$ select id from public.messages where body = p_body limit 1 $$;

-- WHO MAY PIN --------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format($$ select public.pin_message(%L) $$, pg_temp.msg('Dinner at 8, Rua Nova 12')),
  'only a host can pin',
  'an ordinary member cannot pin'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format($$ select public.pin_message(%L) $$, pg_temp.msg('Dinner at 8, Rua Nova 12')),
  'the host can'
);
select is(
  (select count(*)::int from public.room_pins(pg_temp.crew())),
  1,
  'and everyone in the room can read it'
);
select is(
  (select body from public.room_pins(pg_temp.crew())),
  'Dinner at 8, Rua Nova 12',
  'with the message itself, not just an id'
);

-- THE CAP ------------------------------------------------------------------

select public.pin_message(pg_temp.msg('Second thing'));
select public.pin_message(pg_temp.msg('Third thing'));
select throws_ok(
  format($$ select public.pin_message(%L) $$, pg_temp.msg('Fourth thing')),
  'three pins is the limit',
  'a pinned list is a second thread, so it stops at three'
);

-- Re-pinning one that is already up extends it rather than spending a slot.
select lives_ok(
  format($$ select public.pin_message(%L, 48) $$, pg_temp.msg('Second thing')),
  're-pinning an existing pin is not a fourth pin'
);

-- EXPIRY -------------------------------------------------------------------

select pg_temp.admin();
update public.pinned_messages set expires_at = now() - interval '1 minute'
  where message_id = pg_temp.msg('Third thing');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.room_pins(pg_temp.crew())),
  2,
  'an expired pin stops showing'
);
select lives_ok(
  format($$ select public.pin_message(%L) $$, pg_temp.msg('Fourth thing')),
  'and gives its slot back'
);

-- A PIN NEVER OUTLIVES ITS MESSAGE ----------------------------------------

select public.unsend_message(pg_temp.msg('Dinner at 8, Rua Nova 12'));
select is(
  (select count(*)::int from public.room_pins(pg_temp.crew())
    where message_id = pg_temp.msg('Dinner at 8, Rua Nova 12')),
  0,
  'unsending a pinned message takes the pin down with it'
);

-- AND ITS SLOT. This is the half that was missing, and it is the half a
-- host would actually hit: pin_message counted the TABLE while room_pins
-- reads the JOIN, so a pin whose message had been unsent went on holding a
-- slot that nothing rendered and nothing could unpin — there is no row to
-- long-press, and re-pinning the same message raises 'message not found'.
select lives_ok(
  format($$ select public.pin_message(%L) $$, pg_temp.msg('Fifth thing')),
  'and gives its slot back, the same as an expired one'
);

-- The hourly sweep collects the row itself, so the table does not fill up
-- with pins pointing at messages that no longer say anything.
select pg_temp.admin();
select ok(
  (select count(*)::int from public.pinned_messages pm
    join public.messages m on m.id = pm.message_id
    where m.unsent_at is not null or m.removed_at is not null) > 0,
  'the dead pin is still a row until something sweeps it'
);
select public.expire_pinned_messages();
select is(
  (select count(*)::int from public.pinned_messages pm
    join public.messages m on m.id = pm.message_id
    where m.unsent_at is not null or m.removed_at is not null),
  0,
  'and the hourly sweep collects it'
);

-- UNPINNING ----------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format($$ select public.unpin_message(%L) $$, pg_temp.msg('Second thing')),
  'only a host can unpin',
  'and a member cannot take one down either'
);

-- WHAT A REFUSAL IS ALLOWED TO SAY ----------------------------------------
--
-- Two distinguishable refusals are a message-existence oracle: hand somebody
-- a message id and the wording tells them whether it is real, and whether it
-- is pinned, in a room they cannot read. A member of the room can already
-- see both of those facts, so they keep the honest reason; everybody else
-- gets the one answer. Same rule send_message_request follows.

-- Resolved as admin and carried across. Looked up AS Cara it comes back
-- null, and pin_message(null) refuses for the boring reason — an assertion
-- that would pass whether or not the leak is closed.
select pg_temp.admin();
create temp table t_pinned as select pg_temp.msg('Second thing') as id;
grant select on pg_temp.t_pinned to public;

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  format($$ select public.pin_message(%L) $$, (select id from pg_temp.t_pinned)),
  'message not found',
  'somebody outside the room is told nothing about whether the message is real'
);
select lives_ok(
  format($$ select public.unpin_message(%L) $$, (select id from pg_temp.t_pinned)),
  'and nothing about whether it is pinned'
);

select * from finish();
rollback;
