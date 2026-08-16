-- HARD RULE 4: social handles are never visible pre-accept, enforced in the DB.
begin;
select plan(16);

-- Seed three signed-up users (trigger creates public.users + profiles).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

select is(
  (select count(*)::int from public.users),
  3,
  'signup trigger creates app user rows'
);
select is(
  (select count(*)::int from public.profiles),
  3,
  'signup trigger creates empty profiles'
);

-- Helper to impersonate a client the way PostgREST does.
create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end
$$;

-- Alice adds her Instagram handle.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.social_handles (user_id, platform, handle)
     values ('00000000-0000-0000-0000-00000000000a', 'instagram', 'alice.travels') $$,
  'owner can add own social handle'
);
select is(
  (select count(*)::int from public.social_handles),
  1,
  'owner sees own handle'
);

-- Alice cannot write handles for Bob.
select throws_ok(
  $$ insert into public.social_handles (user_id, platform, handle)
     values ('00000000-0000-0000-0000-00000000000b', 'instagram', 'impostor') $$,
  '42501',
  null,
  'cannot create handles for another user'
);

-- Bob, with no chat, sees nothing.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.social_handles),
  0,
  'no accepted chat -> handle invisible'
);

-- An accepted (active) chat between Alice and Bob unlocks the handle for Bob.
reset role;
insert into public.chats (id, status)
  values ('11111111-1111-1111-1111-111111111111', 'active');
insert into public.chat_participants (chat_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.social_handles),
  1,
  'active accepted chat -> handle visible to the other participant'
);
select is(
  (select handle from public.social_handles limit 1),
  'alice.travels',
  'visible handle is the owner''s'
);

-- Bob still cannot modify Alice's handle even though he can read it.
create function pg_temp.try_update_handle() returns int language plpgsql as $$
declare n int;
begin
  update public.social_handles set handle = 'hacked'
  where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  return n;
end
$$;
select is(
  pg_temp.try_update_handle(),
  0,
  'reader cannot update the owner''s handle'
);

-- The gate helper is caller-scoped: Bob (in the chat) gets true for Alice…
select is(
  public.has_accepted_chat('00000000-0000-0000-0000-00000000000a'),
  true,
  'helper answers for the caller''s own relationship'
);

-- Cara (no chat with Alice) still sees nothing.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.social_handles),
  0,
  'third parties still see nothing'
);

-- …and Cara cannot learn about the Alice↔Bob chat: she can only ask about
-- herself, and the old two-arg probing signature must not exist at all.
select is(
  public.has_accepted_chat('00000000-0000-0000-0000-00000000000a'),
  false,
  'helper cannot reveal other users'' relationships'
);
select throws_ok(
  $$ select public.has_accepted_chat(
       '00000000-0000-0000-0000-00000000000a',
       '00000000-0000-0000-0000-00000000000b') $$,
  '42883',
  null,
  'arbitrary-pair probing signature does not exist'
);

-- Closing (unmatching) the chat re-hides the handle.
reset role;
update public.chats set status = 'closed'
  where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.social_handles),
  0,
  'closed chat -> handle hidden again'
);

-- Signed-out (anon) clients have no access at all — tables or helpers.
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.social_handles $$,
  '42501',
  null,
  'anon role has no table privilege'
);
select throws_ok(
  $$ select public.has_accepted_chat('00000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'anon cannot execute the gate helper'
);

select * from finish();
rollback;
