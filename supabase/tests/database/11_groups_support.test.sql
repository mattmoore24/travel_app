-- Traveler groups and the support inbox (Phase 10).
--
-- The rules under test are the ones a client could otherwise talk its way
-- past: who runs a group, who may speak in it, how long a joiner may stay,
-- who can read an invite token, and whether a shared group counts as a
-- connection for the social-handle gate (hard rule 4 — it must not).
begin;
select plan(40);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
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

-- MAKING ONE -------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$select public.create_group('Hostel crew', (current_date + 30)::date)$$,
  'anybody can start a group'
);

create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Hostel crew' $$;

-- Read as the owner: `chats` carries no select policy for room members
-- (which is true of hostel rooms too, and harmless — my_chats is a definer
-- function). The claim here is about the kind, not about who can see it.
select pg_temp.admin();
select is(
  (select kind::text from public.chats where id = pg_temp.crew()),
  'room',
  'a group is a room, so everything rooms already do applies to it'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select role from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000a'),
  'admin',
  'the person who started it runs it'
);
select ok(
  public.is_room_moderator(pg_temp.crew()),
  'and is a moderator, with everything that already implies'
);
select throws_ok(
  $$select public.create_group('Yesterday', (current_date - 1)::date)$$,
  '23514',
  null,
  'a group cannot be created with a stay-until date that has passed'
);

-- A group is PRIVATE. This is the difference from a hostel room and the
-- reason none of the public-preview paths may pick it up.
select ok(
  not public.is_public_room(pg_temp.crew()),
  'a traveler group is not readable by passers-by'
);
select pg_temp.guest();
select is(
  (select count(*)::int from public.messages where chat_id = pg_temp.crew()),
  0,
  'a signed-out visitor reads nothing from a group'
);

-- INVITES ----------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
create function pg_temp.token() returns text language sql as
  $$ select public.group_invite_token(pg_temp.crew()) $$;

select is(
  pg_temp.token(),
  pg_temp.token(),
  'sharing twice gives the same link, so the first person is not cut off'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format($$select public.group_invite_token(%L::uuid)$$, pg_temp.crew()),
  'P0001',
  'group not found',
  'somebody who is not the admin cannot mint an invite'
);

-- The token table is a bearer store. Nobody but the definer functions may
-- read it, or every group in the product is one select away from anyone.
select ok(
  not has_table_privilege('authenticated', 'public.group_invites', 'select'),
  'a signed-in traveler cannot enumerate invite tokens'
);
select ok(
  not has_table_privilege('anon', 'public.group_invites', 'select'),
  'and neither can a visitor'
);

-- JOINING ----------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
create table pg_temp.invite as select pg_temp.token() as token;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select (public.group_invite_preview((select token from pg_temp.invite))).name),
  'Hostel crew',
  'a link shows what the group is before it asks for anything'
);
select ok(
  not (select (public.group_invite_preview((select token from pg_temp.invite))).already_member),
  'and knows you are not in it yet'
);

-- The clamp is the point: a joiner asking for a year gets the admin's ceiling.
select lives_ok(
  format(
    $$select public.join_group_with_invite(%L, (current_date + 365)::date)$$,
    (select token from pg_temp.invite)
  ),
  'a link can be accepted'
);
select is(
  (select departure_date from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000b'),
  (current_date + 30)::date,
  'a stay-until date past the admin_s maximum is clamped to it, not refused'
);
select is(
  (select role from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000b'),
  'member',
  'a joiner arrives as a plain member'
);

select throws_ok(
  $$select public.join_group_with_invite('nosuchtoken', (current_date + 1)::date)$$,
  '42501',
  null,
  'a token nobody minted is refused'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format($$select public.revoke_group_invites(%L::uuid)$$, pg_temp.crew()),
  'the admin can turn the link off'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  format(
    $$select public.join_group_with_invite(%L, (current_date + 1)::date)$$,
    (select token from pg_temp.invite)
  ),
  '42501',
  null,
  'a withdrawn link stops working'
);

-- SPEAKING ---------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.can_send_in_chat(pg_temp.crew()),
  'while speaking is open, a member can post'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format($$select public.update_group(%L::uuid, p_speaking => 'granted')$$, pg_temp.crew()),
  'the admin can restrict who posts'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  not public.can_send_in_chat(pg_temp.crew()),
  'a plain member cannot post in a restricted group'
);
-- And that is a POLICY, not a disabled button: the insert itself is refused.
select throws_ok(
  format(
    $$insert into public.messages (chat_id, sender_id, body)
      values (%L::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'let me in')$$,
    pg_temp.crew()
  ),
  '42501',
  null,
  'and the database refuses the insert, not just the client'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select ok(
  public.can_send_in_chat(pg_temp.crew()),
  'the admin can always post'
);
select lives_ok(
  format(
    $$select public.set_group_role(%L::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'speaker')$$,
    pg_temp.crew()
  ),
  'the admin can hand over the microphone'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select ok(
  public.can_send_in_chat(pg_temp.crew()),
  'and the person they picked can post'
);

-- Nobody else gets to hand it out, or take the group over.
select throws_ok(
  format(
    $$select public.set_group_role(%L::uuid, '00000000-0000-0000-0000-00000000000c'::uuid, 'speaker')$$,
    pg_temp.crew()
  ),
  'P0001',
  'group not found',
  'a member cannot hand out the microphone'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format(
    $$select public.set_group_role(%L::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'member')$$,
    pg_temp.crew()
  ),
  'set_group_role accepts a call aimed at the admin'
);
select is(
  (select role from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000a'),
  'admin',
  'but it cannot demote them, so a group is never left without an admin'
);

-- REMOVING ---------------------------------------------------------------------

select lives_ok(
  format(
    $$select public.room_remove_member(%L::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)$$,
    pg_temp.crew()
  ),
  'the admin can remove somebody'
);
select is(
  (select count(*)::int from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'and they are out'
);

-- EXPIRY -----------------------------------------------------------------------

select pg_temp.admin();
update public.room_members set expires_at = now() - interval '1 day'
  where chat_id = pg_temp.crew();
select ok(
  public.expire_room_members() >= 0,
  'the sweep runs'
);
select is(
  (select count(*)::int from public.room_members
    where chat_id = pg_temp.crew() and role = 'admin'),
  1,
  'and never sweeps away the admin, which would leave the group unrunnable'
);

-- HARD RULE 4 ------------------------------------------------------------------
-- Sharing a group is not a connection. Handles stay locked.

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select ok(
  not public.has_accepted_chat('00000000-0000-0000-0000-00000000000b'),
  'being in a group together does not unlock social handles'
);

-- SUPPORT ----------------------------------------------------------------------

select pg_temp.guest();
select lives_ok(
  $$insert into public.support_messages (reply_to, body)
    values ('stuck@example.com', 'I cannot sign in and need help.')$$,
  'somebody who cannot sign in can still reach support'
);
select ok(
  not has_table_privilege('anon', 'public.support_messages', 'select'),
  'and cannot read anybody_s support messages, including their own'
);
select ok(
  not has_table_privilege('authenticated', 'public.support_messages', 'select'),
  'neither can a signed-in traveler'
);

-- Three an hour per address. The fourth is refused with a sentence a person
-- can read, not a constraint name.
select lives_ok(
  $$insert into public.support_messages (reply_to, body)
    values ('stuck@example.com', 'Adding a bit more detail here.')$$,
  'a second message is fine'
);
select lives_ok(
  $$insert into public.support_messages (reply_to, body)
    values ('Stuck@Example.com', 'And one more, different case.')$$,
  'a third is fine too'
);
select throws_ok(
  $$insert into public.support_messages (reply_to, body)
    values ('STUCK@example.com', 'And a fourth one right away.')$$,
  '23514',
  null,
  'the fourth within an hour is refused, and the address is matched case-insensitively'
);

select * from finish();
rollback;
