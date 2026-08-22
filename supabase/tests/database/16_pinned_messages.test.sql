-- Pinned messages: capped, expiring, moderator-only, and never outliving the
-- message they point at.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

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
  ((select id from pg_temp.t_chat), '00000000-0000-0000-0000-00000000000a', 'Fourth thing');

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

-- UNPINNING ----------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format($$ select public.unpin_message(%L) $$, pg_temp.msg('Second thing')),
  'only a host can unpin',
  'and a member cannot take one down either'
);

select * from finish();
rollback;
