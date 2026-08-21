-- Traveler groups and the support inbox (Phase 10).
--
-- The rules under test are the ones a client could otherwise talk its way
-- past: who runs a group, who may speak in it, how long a joiner may stay,
-- who can read an invite token, and whether a shared group counts as a
-- connection for the social-handle gate (hard rule 4 — it must not).
begin;
select plan(73);

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

-- PUSH -------------------------------------------------------------------------
-- A group chat nobody is told about is a group chat nobody comes back to.

select pg_temp.admin();
delete from public.push_queue;
insert into public.room_members (chat_id, user_id, departure_date, expires_at) values
  (pg_temp.crew(), '00000000-0000-0000-0000-00000000000c', current_date + 5,
    now() + interval '5 days');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.messages (chat_id, sender_id, body)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000a', 'anyone up for the 8pm walk?');

select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  1,
  'posting in a group reaches the other members, which it never used to'
);
select is(
  (select title from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c' limit 1),
  'Hostel crew',
  'and the title is the group, not the sender, the way a group reads on a lock screen'
);
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'the sender never pushes themselves'
);

-- Muting has to mean something too.
delete from public.push_queue;
update public.room_members set muted = true
  where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.messages (chat_id, sender_id, body)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000000a', 'and breakfast?');
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  0,
  'somebody who muted the group is left alone'
);

-- Put the group back the way the sections below expect it.
delete from public.room_members
 where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000c';
delete from public.messages where chat_id = pg_temp.crew();
delete from public.push_queue;

-- REMOVAL HAS TO STICK ---------------------------------------------------------
-- An admin removing somebody who is making the group uncomfortable was told
-- it worked while that person still held the same link everyone was sent.

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
create table pg_temp.invite2 as select pg_temp.token() as token;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format(
    $$select public.join_group_with_invite(%L, (current_date + 1)::date)$$,
    (select token from pg_temp.invite2)
  ),
  '42501',
  'You were removed from this group. Ask an admin to let you back in.',
  'somebody who was removed cannot walk back in through the same link'
);

-- But it is not a life sentence, and the admin is the one who decides.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  format(
    $$select public.allow_group_rejoin(%L::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)$$,
    pg_temp.crew()
  ),
  'P0001',
  'group not found',
  'and somebody who is not the admin cannot undo it'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  format(
    $$select public.allow_group_rejoin(%L::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)$$,
    pg_temp.crew()
  ),
  'the admin can let somebody back in'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  format(
    $$select public.join_group_with_invite(%L, (current_date + 1)::date)$$,
    (select token from pg_temp.invite2)
  ),
  'and then the link works for them again'
);

-- The history is still there. Nothing was erased to make this work.
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where subject_user_id = '00000000-0000-0000-0000-00000000000b'
      and entity_id = pg_temp.crew()
      and action in ('removed_by_moderator', 'readmitted_by_moderator')),
  2,
  'both the removal and the readmission are on the record'
);

-- Put them back out for the sweep test below.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.room_remove_member(pg_temp.crew(), '00000000-0000-0000-0000-00000000000b'::uuid);

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

-- SUCCESSION -------------------------------------------------------------------
-- A group is other people's conversation. Losing its only admin must not
-- leave it running with a live invite link and nobody able to revoke it.

select pg_temp.admin();
delete from public.room_members where chat_id = pg_temp.crew();
insert into public.room_members (chat_id, user_id, departure_date, expires_at, role) values
  (pg_temp.crew(), '00000000-0000-0000-0000-00000000000a', current_date + 10,
    now() + interval '10 days', 'admin'),
  (pg_temp.crew(), '00000000-0000-0000-0000-00000000000c', current_date + 10,
    now() + interval '10 days', 'member');

delete from public.room_members
 where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000a';

select is(
  (select role from public.room_members
    where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000c'),
  'admin',
  'losing the only admin promotes whoever is left, so the group stays runnable'
);

-- And when the last person goes, the group goes with them.
delete from public.room_members
 where chat_id = pg_temp.crew() and user_id = '00000000-0000-0000-0000-00000000000c';
select is(
  (select status::text from public.chats where id = pg_temp.crew()),
  'closed',
  'and an empty group closes rather than lingering with a live invite link'
);

-- Deleting an orphaned selfie needs a SELECT policy as well as a DELETE one:
-- storage resolves the row before removing it, so without this the cleanup
-- call succeeded having removed nothing.
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'verification_selfies_select_own'
  ),
  'a traveler can read back their own verification selfie, so the cleanup can delete it'
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

-- DELIVERY ---------------------------------------------------------------------
-- The contact form promises a reply, so something has to actually carry the
-- message off this table. Email needs a third-party key; the push channel
-- needs nothing, and stays off until somebody is named.

select pg_temp.admin();
select is(
  (select value from public.app_config where key = 'support_notify_recipients'),
  '[]'::jsonb,
  'nobody is on support duty until somebody is named'
);
select ok(
  not has_table_privilege('authenticated', 'public.app_config', 'select'),
  'and a traveler cannot read who is'
);

-- Submitting through the function, which is the only way a client learns the
-- id of what it just wrote: the insert policy is write-only.
select pg_temp.guest();
select isnt(
  public.submit_support_message('lost@example.com', 'Locked out and stuck.'),
  null,
  'a guest can submit and gets an id back'
);

select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue where title like 'Support:%'),
  0,
  'with nobody on duty, an incoming message wakes no phone'
);

-- Name somebody and try again. By email, which is what the person setting
-- this actually knows about themselves.
update public.app_config
   set value = jsonb_build_array('Bob@Example.com')
 where key = 'support_notify_recipients';

select pg_temp.guest();
select lives_ok(
  $$select public.submit_support_message('found@example.com', 'Second one, with somebody on duty.')$$,
  'and once one is named the message still goes in'
);

select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000000b'
      and title = 'Support: found@example.com'),
  1,
  'whoever is on duty gets a push, addressed so it can be answered from the lock screen'
);
select is(
  (select body from public.push_queue where title = 'Support: found@example.com'),
  'Second one, with somebody on duty.',
  'carrying the message itself'
);

-- Writing in as the person on duty must not ping the person on duty.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$select public.submit_support_message('bob@example.com', 'Testing the form myself.')$$,
  'the person on support duty can use the form too'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue where title = 'Support: bob@example.com'),
  0,
  'and is not pushed their own message'
);

-- Knowing what became of yours. Not the inbox: one row, yours, no content.
-- Definer so the test can name the id without granting anybody a read of the
-- table, which is the whole thing being protected here.
create function pg_temp.bob_msg() returns uuid language sql security definer as
  $$ select id from public.support_messages where reply_to = 'bob@example.com' $$;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.support_message_status(pg_temp.bob_msg())),
  1,
  'the sender can ask what became of their own message'
);
select is(
  (select delivered_at from public.support_message_status(pg_temp.bob_msg())),
  null,
  'and is told the truth: not delivered yet'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.support_message_status(pg_temp.bob_msg())),
  0,
  'nobody else can, even naming the id exactly'
);
select ok(
  not has_function_privilege('anon', 'public.support_message_status(uuid)', 'execute'),
  'and a guest cannot ask at all: theirs has no owner to match'
);

-- The limit lives on the table, so going through the function cannot dodge it.
select pg_temp.guest();
select lives_ok(
  $$select public.submit_support_message('again@example.com', 'One more, first time.')$$,
  'the function accepts a first message from a new address'
);
select lives_ok(
  $$select public.submit_support_message('again@example.com', 'One more, second time.')$$,
  'and a second'
);
select lives_ok(
  $$select public.submit_support_message('again@example.com', 'One more, third time.')$$,
  'and a third'
);
select throws_ok(
  $$select public.submit_support_message('again@example.com', 'One more, fourth time.')$$,
  '23514',
  null,
  'but the fourth is refused: the function is not a way around the limit'
);


-- A typo in the setting must not be able to refuse somebody's message.
select pg_temp.admin();
update public.app_config
   set value = jsonb_build_array('not-an-email-or-an-id', 'nobody@example.com',
                                 '00000000-0000-0000-0000-0000000000ff')
 where key = 'support_notify_recipients';
select pg_temp.guest();
select lives_ok(
  $$select public.submit_support_message('typo@example.com', 'Does a bad setting eat this?')$$,
  'a recipient list full of junk still takes the message'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.push_queue where title = 'Support: typo@example.com'),
  0,
  'and simply wakes nobody'
);

-- A misconfigured mailer must not be able to abandon somebody's message.
select pg_temp.admin();
select is(
  (select column_default is not null and is_nullable = 'NO'
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'support_messages'
      and column_name = 'next_attempt_at'),
  true,
  'every support message carries a due time, defaulted so it is sendable at once'
);
select is(
  (select count(*)::int from public.support_messages
    where next_attempt_at > created_at + interval '1 second'),
  0,
  'and nothing arrives already deferred'
);

select * from finish();
rollback;
