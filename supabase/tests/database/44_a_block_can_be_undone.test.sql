-- Unblocking, and the three things it must not quietly undo with itself.
--
-- The app grew a Blocked list with an Unblock on every row, and the whole
-- mechanism is `delete from blocks` against policies that have existed since
-- 20260816200000. No migration, which is exactly why this file exists: an
-- undo built entirely out of a delete has to be shown NOT to reach anything
-- else the delete happens to sit next to.
--
-- Written as attacks:
--   1. one traveler cannot delete another's block (or unblocking would be a
--      way to make somebody visible to you again),
--   2. the chat the block closed stays closed - sever_on_block is one-way by
--      design, and a person unblocking must not silently reopen a
--      conversation the other side never re-consented to,
--   3. the moderation audit row survives, and
--   4. because it survives, block/unblock cycling cannot launder the daily
--      cap. The audit worried it could; 20260817150000 counts through
--      moderation_events precisely 'because unblocking deletes the blocks
--      row', and that reasoning is now pinned rather than assumed.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'block-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'block-bob@example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'block-cara@example.com');

update public.profiles set
  display_name = 'traveler', age = 30, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Alice'
  where user_id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set display_name = 'Bob'
  where user_id = '00000000-0000-0000-0000-0000000000b2';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

-- The chat the block is going to close.
insert into public.chats (id, status)
  values ('bbbbbbbb-1111-1111-1111-111111111111', 'active');
insert into public.chat_participants (chat_id, user_id) values
  ('bbbbbbbb-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1'),
  ('bbbbbbbb-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

-- Alice blocks Bob. This is the app's own write, unchanged.
select lives_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b2') $$,
  'a traveler can block somebody'
);

-- The list the screen reads: her own blocks, and nobody else's.
select is(
  (select count(*)::int from public.blocks),
  1,
  'the blocked list shows the blocks this account made'
);
-- And the names beside them. The FK points at public.users, so the screen
-- reads profiles separately - which is only possible because is_visible_owner
-- is `status = active` and says nothing about blocked pairs.
select is(
  (select display_name from public.profiles
   where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'Bob',
  'the blocked person still has a readable name to show in the list'
);

select is(
  (select status::text from public.chats
   where id = 'bbbbbbbb-1111-1111-1111-111111111111'),
  'closed',
  'the block closed the chat'
);

-- ATTACK: Cara tries to undo Alice's block, which would put her back in front
-- of somebody who decided otherwise.
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select lives_ok(
  $$ delete from public.blocks
     where blocker_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'another traveler''s delete is not an error, it simply matches nothing'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.blocks),
  1,
  'and the block is still there'
);

-- Alice unblocks Bob herself.
select lives_ok(
  $$ delete from public.blocks
     where blocked_id = '00000000-0000-0000-0000-0000000000b2' $$,
  'the owner of a block can undo it'
);

-- The two things the undo must NOT reach.
select is(
  (select status::text from public.chats
   where id = 'bbbbbbbb-1111-1111-1111-111111111111'),
  'closed',
  'unblocking does not reopen the chat the block closed'
);

reset role;
select is(
  (select count(*)::int from public.moderation_events
   where subject_user_id = '00000000-0000-0000-0000-0000000000b1'
     and entity_type = 'block' and action = 'created'),
  1,
  'the block''s audit row survives the unblock'
);

-- ATTACK: fifty block/unblock cycles, then a fifty-first block. If the cap
-- counted rows in `blocks` it would now be zero and the door wide open.
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
do $$
begin
  -- One is already spent above, so 49 more cycles reaches fifty audit rows.
  for i in 1..49 loop
    insert into public.blocks (blocker_id, blocked_id)
      values ('00000000-0000-0000-0000-0000000000b1',
              '00000000-0000-0000-0000-0000000000b2');
    delete from public.blocks
      where blocked_id = '00000000-0000-0000-0000-0000000000b2';
  end loop;
end
$$;
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b3') $$,
  '23514',
  null,
  'cycling block and unblock cannot launder the daily cap'
);

select * from finish();
rollback;
