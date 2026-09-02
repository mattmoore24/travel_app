-- A VERDICT IS FOR ITS SUBJECT ALONE, AND THE TABLE IS WHERE THAT IS DECIDED.
--
-- 20260903050000 wrote the rule down and enforced half of it. The PATH was
-- masked in my_chats, in group_invite_preview and in the storage policy; the
-- STATUS was masked by src/features/groups/photo.ts and by nothing else.
-- `grant select on public.groups to authenticated` (20260821010000:42) was
-- TABLE-level, so any member of the room could read the verdict itself:
--
--   select photo_status from public.groups where name = 'Porto crew';
--   -- 'pending', and a few seconds later 'rejected'
--
-- which is precisely the transition the migration's own header says a member
-- must never be able to watch. 67_a_group_photo_is_checked did not catch it
-- because every `pg_temp.status()` call in that file is a positive assertion
-- on the value — an assertion that the ROW is right, never that a READER is
-- refused — so deleting the client guard failed nothing.
--
-- This file is that question, and only that question: who may learn that a
-- group photo is being checked, or was refused. Everything is written as the
-- attack — a member who is not the setter reaching for the fact, by the table
-- and by the function — and the setter's own read is asserted beside it, so a
-- fix that closed the leak by hiding the verdict from the person it is about
-- would fail here too.
--
-- EVERY ASSERTION WAS RUN AGAINST THE MUTATION THAT REMOVES WHAT IT NAMES
-- (2026-09-03). Each mutation is applied to 20260903130000 alone and the whole
-- suite is re-run, so "and nothing else moves" is a measurement, not a hope.
-- The record is what happened, not what was intended:
--
--   * the column grant reverted to `grant select on public.groups to
--     authenticated` — the leak exactly as found
--       -> 3 'a member cannot read the verdict off the table', 4, 5, 6,
--          7 'and `select *` is refused', 10 'not even the person whose photo
--          it is', 24 'and the table will not tell him either'.
--          Seven refusals come back "lives"; no other file in the suite moves,
--          which is what proves the client guard was never holding this.
--   * the `or g.photo_set_by = auth.uid()` masks on photo_path/photo_status in
--     group_detail replaced by the bare columns
--       -> 11 'a member is handed no path', 12 'and no verdict',
--          23 'the same nothing after the refusal as before it', and only those.
--   * the moderation_attempts mask replaced by the bare column
--       -> 26 'a member is handed zero', and only it.
--   * `new.photo_set_by := v_setter` deleted from the trigger
--       -> 2 'the trigger recorded who set it', 15, 16, 21, 22, 25. The setter
--          can no longer be recognised, so the mask closes on the one person it
--          is supposed to open for - which is why 15, 16, 22 and 25 are here
--          beside the refusals: a fix that hid the verdict from its subject
--          fails this file too.
--   * the `new.photo_set_by := null` carve-out removed from the trigger's
--     null-path branch, so a verdict clears the subject along with the path
--       -> 21 'the subject survives the path the verdict removed',
--          22 'the person whose photo it was is told', and only those.
--   * the membership gate removed from group_detail
--       -> 17 'somebody who is not in the group is handed no row at all',
--          and only it.
--   * `revoke select on public.groups from service_role` added beside the
--     other revoke
--       -> the file DIES at 32 'the moderation worker still reads the columns
--          its queue selects by' with `permission denied for table groups`,
--          having run the 31 before it. bypassrls is not bypass-grants.
--   * chat_photos_select_group reverted to naming g.photo_path and
--     g.photo_status inline instead of calling can_view_group_photo
--       -> this file DIES at 18 with `permission denied for table groups`, and
--          takes 67_a_group_photo_is_checked (at its own test 15) and
--          03_chats_storage_rls (at 'owner always reads own objects') with it.
--          An RLS policy's expression is evaluated with the READER's
--          privileges, so a policy naming a column the reader may not select
--          does not answer false - it raises. That is the whole reason
--          can_view_group_photo exists, and without it this migration would
--          have taken every chat photo in the product down with the leak.
begin;
select plan(32);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end
$$;

create function pg_temp.service() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'ana@example.com'),      -- the admin, who uploads
  ('00000000-0000-0000-0000-0000000000b5', 'bruno@example.com'),    -- a member, the attacker
  ('00000000-0000-0000-0000-0000000000c5', 'chiara@example.com');   -- not in the group at all

-- SECURITY DEFINER, so an attacker addresses the row by an id they hold
-- rather than by one RLS agreed to give them. Knowing the chat id is not the
-- secret here — being in the group is not either — the verdict is.
create function pg_temp.crew() returns uuid language sql security definer as
  $$ select chat_id from public.groups where name = 'Porto crew' $$;

-- What the ROW says, as opposed to what a role may read: the same three
-- helpers 67 uses, for the assertions that are about the trigger rather than
-- about the reader.
create function pg_temp.status() returns text language sql security definer as
  $$ select photo_status::text from public.groups where chat_id = pg_temp.crew() $$;

create function pg_temp.set_by() returns text language sql security definer as
  $$ select photo_set_by::text from public.groups where chat_id = pg_temp.crew() $$;

-- What group_detail hands the CURRENT role. Invoker rights on purpose: these
-- three are the answer to "what does this person get", and the answer has to
-- be the caller's, not the owner's.
create function pg_temp.detail_path() returns text language sql as
  $$ select photo_path from public.group_detail(pg_temp.crew()) $$;

create function pg_temp.detail_status() returns text language sql as
  $$ select photo_status::text from public.group_detail(pg_temp.crew()) $$;

create function pg_temp.detail_attempts() returns int language sql as
  $$ select moderation_attempts from public.group_detail(pg_temp.crew()) $$;

create function pg_temp.detail_name() returns text language sql as
  $$ select name from public.group_detail(pg_temp.crew()) $$;

create function pg_temp.detail_rows() returns int language sql as
  $$ select count(*)::int from public.group_detail(pg_temp.crew()) $$;

-- How many chat-photos objects the current role can be handed a URL for.
create function pg_temp.visible_objects() returns int language sql as
  $$ select count(*)::int from storage.objects where bucket_id = 'chat-photos' $$;

-- ---------------------------------------------------------------------------
-- A photo that is being checked. This is how production runs, and it is the
-- only state in which there is anything to leak.
-- ---------------------------------------------------------------------------

select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.create_group('Porto crew', null::date, 'everyone',
  '00000000-0000-0000-0000-0000000000a5/one.jpg');
select set_config('test.token', public.group_invite_token(pg_temp.crew()), false);

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select public.join_group_with_invite(current_setting('test.token'), (current_date + 30)::date);

-- The uploads themselves, so the bucket's own policies can be asked.
select pg_temp.admin();
insert into storage.objects (bucket_id, name)
values ('chat-photos', '00000000-0000-0000-0000-0000000000a5/one.jpg'),
       ('chat-photos', '00000000-0000-0000-0000-0000000000a5/two.jpg');

-- 1, 2: there is genuinely something to hide, and the row knows whose it is.
select is(pg_temp.status(), 'pending',
  'the group photo is being checked, so there is a verdict in flight to leak');
select is(pg_temp.set_by(), '00000000-0000-0000-0000-0000000000a5',
  'and the trigger recorded who set it, which is the subject of that verdict');

-- ---------------------------------------------------------------------------
-- THE ATTACK. Bruno is a member in good standing. He has an anon key, the
-- group's name, and a REST client.
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');

-- 3: the finding, verbatim.
select throws_ok(
  $$ select photo_status from public.groups where name = 'Porto crew' $$,
  '42501', null,
  'a member cannot read the verdict off the table: this select is the finding'
);
-- 4-6: nor any of the three columns that say the same thing another way.
select throws_ok(
  $$ select photo_path from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'nor the raw path, which is a photo existing at all'
);
select throws_ok(
  $$ select moderation_attempts from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'nor the worker''s counter, which is a photo being retried'
);
select throws_ok(
  $$ select photo_set_by from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'nor whose photo it is'
);
-- 7: and the whole row is refused as one, which is also what stops the
-- previous bundle drawing an unchecked picture.
select throws_ok(
  $$ select * from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'and `select *` is refused, because Postgres refuses a star select unless every column is granted'
);

-- 8, 9: and none of that has taken away what a member is actually there for.
select lives_ok(
  $$ select chat_id, created_by, name, speaking, invites, max_stay_until,
            pin_id, plan_ended_at, created_at
       from public.groups where chat_id = pg_temp.crew() $$,
  'everything a member legitimately reads off the row still reads'
);
select is(
  (select name from public.groups where chat_id = pg_temp.crew()),
  'Porto crew',
  'and comes back, so the assertion above is not passing on an empty table'
);

-- 10: the grant is not personal. The setter does not read it off the table
-- either — she reads her own through the function, the way my_chats already
-- hands her her own path.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select photo_status from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'not even the person whose photo it is reads the column off the table'
);

-- ---------------------------------------------------------------------------
-- The door that replaced it hands each person their own answer
-- ---------------------------------------------------------------------------

-- 11-14: to a member, no photo. Not "pending, path withheld", which is the
-- same tell one step removed.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.detail_path(), null,
  'through group_detail a member is handed no path while a photo is checked');
select is(pg_temp.detail_status(), null,
  'and no verdict: to them there is no photo, not a photo being checked');
select is(pg_temp.detail_attempts(), 0,
  'and no count of the tries');
select is(pg_temp.detail_name(), 'Porto crew',
  'while the rest of the group still arrives');

-- 15, 16: and to its subject, everything about it. Withholding it here would
-- hide nothing (chat_photos_select_own signs her own upload regardless) and
-- leave the one person who chose the picture looking at an empty frame.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(pg_temp.detail_path(), '00000000-0000-0000-0000-0000000000a5/one.jpg',
  'the person who uploaded it is handed the path while it waits');
select is(pg_temp.detail_status(), 'pending',
  'and told it is being checked');

-- 17: a stranger gets no row at all, the gate groups_select_member kept and a
-- definer function has to keep for itself.
select pg_temp.login('00000000-0000-0000-0000-0000000000c5');
select is(pg_temp.detail_rows(), 0,
  'somebody who is not in the group is handed no row at all');

-- 18, 19: the bucket, which is where a path that leaked would have to be spent.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.visible_objects(), 0,
  'the bucket refuses a member the picture while it is being checked');
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(pg_temp.visible_objects(), 2,
  'and still signs the setter her own uploads, which is why she is shown hers');

-- ---------------------------------------------------------------------------
-- THE REFUSAL. This is the moment the whole rule exists for: the row moves,
-- and only one person may see it move.
-- ---------------------------------------------------------------------------

select pg_temp.admin();
select public.apply_group_photo_verdict(pg_temp.crew(),
  '00000000-0000-0000-0000-0000000000a5/one.jpg',
  '{"action":"block","category":"explicit","engine":"claude-moderator"}'::jsonb);

-- 20, 21: the verdict removed the path, so the path can no longer say whose
-- photo it was. photo_set_by is what remembers, and it is the reason the
-- column exists at all.
select is(pg_temp.status(), 'rejected', 'a refused photo leaves its verdict on the row');
select is(pg_temp.set_by(), '00000000-0000-0000-0000-0000000000a5',
  'and the subject survives the path the verdict removed');

-- 22: the person it is about is told, which is what puts "That photo was not
-- approved and has been removed. Pick another." on the group page.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(pg_temp.detail_status(), 'rejected',
  'the person whose photo it was is told it was refused');

-- 23, 24: and the member sees exactly what he saw a minute ago. There is no
-- transition to read, which is the whole of it: a member who could watch
-- "being checked" turn into nothing would know the picture was refused.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.detail_status(), null,
  'a member sees the same nothing after the refusal as before it');
select throws_ok(
  $$ select photo_status from public.groups where chat_id = pg_temp.crew() $$,
  '42501', null,
  'and the table will not tell him either'
);

-- ---------------------------------------------------------------------------
-- The counter, which is the same fact counted
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/two.jpg');
select pg_temp.admin();
select public.note_group_photo_attempt(pg_temp.crew()) from generate_series(1, 2);

-- 25, 26
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(pg_temp.detail_attempts(), 2,
  'the setter is handed the worker''s count of tries on her own photo');
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.detail_attempts(), 0,
  'and a member is handed zero, not a counter climbing on a photo he cannot see');

-- ---------------------------------------------------------------------------
-- And once it clears, it is everybody's again. A mask that never opened
-- would pass every assertion above and break the feature.
-- ---------------------------------------------------------------------------

select pg_temp.admin();
select public.apply_group_photo_verdict(pg_temp.crew(),
  '00000000-0000-0000-0000-0000000000a5/two.jpg',
  '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb);

-- 27-29
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.detail_path(), '00000000-0000-0000-0000-0000000000a5/two.jpg',
  'an approved photo is handed to every member again');
select is(pg_temp.detail_status(), 'approved',
  'and says so');
select is(pg_temp.visible_objects(), 1,
  'and the bucket signs it, which can_view_group_photo has to keep doing now '
  'that the policy cannot read the columns as the reader');

-- ---------------------------------------------------------------------------
-- The doors either side of it
-- ---------------------------------------------------------------------------

-- 30: writing the verdict was never a client's, and still is not.
select throws_ok(
  $$ update public.groups set photo_status = 'approved' where chat_id = pg_temp.crew() $$,
  '42501', null,
  'a member cannot write the verdict either'
);

-- 31: and a signed-out reader cannot call the door at all.
select pg_temp.anon();
select throws_ok(
  $$ select * from public.group_detail(pg_temp.crew()) $$,
  '42501', null,
  'a signed-out reader cannot call group_detail'
);

-- 32: the other side of the same revoke. It names public, anon and
-- authenticated; service_role keeps its own grant, and the moderation
-- worker's queue (moderation-worker/index.ts) is
-- `select chat_id, photo_path, moderation_attempts from groups where
-- photo_status = 'pending'`. A `revoke all` here instead would empty that
-- queue silently and every group photo would hold at pending for ever.
select pg_temp.service();
select is(
  (select photo_status::text from public.groups where chat_id = pg_temp.crew()),
  'approved',
  'and the moderation worker still reads the columns its queue selects by'
);

select * from finish();
rollback;
