-- Who may hand out a group's invite link, and who may take one back.
--
-- Widening this defaults every existing group to 'everyone', so the whole
-- safety of the change rests on the kill switch: revoke_group_invites must
-- stay moderator-only in BOTH states, and a revoked token must actually stop
-- working. Those two are the point of this file; the rest is the widening
-- itself, proven from both sides.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ac01', 'ada@example.com'),
  ('00000000-0000-0000-0000-00000000ac02', 'ben@example.com'),
  ('00000000-0000-0000-0000-00000000ac03', 'cleo@example.com');

-- A named guest, who is a real session and can be a room member: the one
-- caller the widened guard must still refuse.
insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-0000-0000-00000000ac04', null, true);

-- Every account EXCEPT the guest: guest_profile_stays_minimal refuses an
-- onboarding stamp on an anonymous row, which is the rule keeping guests off
-- the map, so a blanket update here would fail before the first assertion.
update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now()
where user_id <> '00000000-0000-0000-0000-00000000ac04';

update public.profiles set display_name = 'Guest'
where user_id = '00000000-0000-0000-0000-00000000ac04';

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

create function pg_temp.crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Kitchen crew' $$;

-- The group's token, revoked or not: the last assertion is about somebody
-- still HOLDING a link that has been turned off, so filtering revoked ones out
-- here would prove only that no live link exists.
create function pg_temp.token() returns text language sql
security definer set search_path = public as
  $$ select token from public.group_invites
      where chat_id = pg_temp.crew()
      order by created_at desc limit 1 $$;

select pg_temp.login('00000000-0000-0000-0000-00000000ac01');
select lives_ok(
  $$ select public.create_group('Kitchen crew', (current_date + 30)::date) $$,
  'the admin starts a group'
);

select is(
  (select invites::text from public.groups where chat_id = pg_temp.crew()),
  'everyone',
  'a new group lets anybody in it hand out the link'
);

-- Ben joins by the admin's own link, which is also how the token path gets
-- exercised for the person who owns it.
select lives_ok(
  $$ select public.group_invite_token(pg_temp.crew()) $$,
  'the admin can mint a link'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ac02');
select lives_ok(
  $$ select public.join_group_with_invite(pg_temp.token(), (current_date + 5)::date) $$,
  'somebody joins with it'
);

-- A PLAIN MEMBER, WITH THE DEFAULT ---------------------------------------------

select lives_ok(
  $$ select public.group_invite_token(pg_temp.crew()) $$,
  'a plain member can hand out the link while it is set to everyone'
);

-- THE KILL SWITCH, STATE ONE ---------------------------------------------------

select throws_ok(
  $$ select public.revoke_group_invites(pg_temp.crew()) $$,
  'group not found',
  'but cannot turn a live link off, even where they may hand it out'
);

-- A NON-MEMBER, WITH THE DEFAULT -----------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ac03');
select throws_ok(
  $$ select public.group_invite_token(pg_temp.crew()) $$,
  'group not found',
  'a non-member is refused a link when it is set to everyone'
);
select throws_ok(
  $$ select public.revoke_group_invites(pg_temp.crew()) $$,
  'group not found',
  'and cannot turn one off either'
);

-- THE ADMIN CLOSES IT ----------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ac01');
select lives_ok(
  $$ select public.update_group(pg_temp.crew(), p_invites => 'admin') $$,
  'the admin can close invites to admins only'
);
select is(
  (select invites::text from public.groups where chat_id = pg_temp.crew()),
  'admin',
  'and the group says so'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ac02');
select throws_ok(
  $$ select public.group_invite_token(pg_temp.crew()) $$,
  'group not found',
  'the same member is now refused'
);

-- THE KILL SWITCH, STATE TWO ---------------------------------------------------

select throws_ok(
  $$ select public.revoke_group_invites(pg_temp.crew()) $$,
  'group not found',
  'and still cannot turn a link off in this state either'
);

-- AND IT ACTUALLY WORKS --------------------------------------------------------
--
-- The mitigation has to be end to end, not only permitted: a revoked token
-- must stop letting people in.

select pg_temp.login('00000000-0000-0000-0000-00000000ac01');
select lives_ok(
  $$ select public.revoke_group_invites(pg_temp.crew()) $$,
  'the admin turns the live link off'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ac03');
select throws_ok(
  $$ select public.join_group_with_invite(pg_temp.token(), (current_date + 5)::date) $$,
  'That invite has expired or been withdrawn.',
  'and a stranger still holding that exact link cannot get in'
);

-- ─────────────────────────────────────────────────────────────────────────
-- THE GUEST. add_to_group refuses a guest in as many words, and a guest who
-- opened an invite link is a genuine room member of the group, so the widened
-- 'everyone' arm would otherwise hand them a live 30-day bearer token for the
-- whole room. Written as the attack: the guest IS a member, and is refused
-- anyway.
-- ─────────────────────────────────────────────────────────────────────────
select pg_temp.admin();
insert into public.room_members (chat_id, user_id, expires_at)
  values (pg_temp.crew(), '00000000-0000-0000-0000-00000000ac04', now() + interval '30 days')
  on conflict do nothing;

select pg_temp.login('00000000-0000-0000-0000-00000000ac04');
select is(
  (select public.is_room_member(pg_temp.crew())),
  true,
  'the guest really is a member of the group, so the refusal below is about being a guest'
);
select throws_ok(
  $$ select public.group_invite_token(pg_temp.crew()) $$,
  'group not found',
  'and a guest member still cannot mint an invite link, the way add_to_group already refuses them'
);

select * from finish();
rollback;
