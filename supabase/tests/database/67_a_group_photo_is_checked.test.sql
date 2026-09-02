-- A GROUP'S OWN PHOTO IS CHECKED BEFORE ANYBODY BUT ITS UPLOADER SEES IT.
--
-- `groups.photo_path` was a plain column with no trigger, so a group photo
-- reached every member and every invite holder unchecked while app.json
-- promised Apple that every photo is checked first (the sentence was narrowed
-- on 2026-09-01 because of it). 20260903050000 closes it the way business
-- photos and post photos were closed, and this file is the attack on every
-- reader of that path: the trigger, the two RPCs an old bundle reads, the
-- storage policy that protects an old bundle's direct table read, the
-- worker's door and the race on it, the poke and its guard, the counter
-- behind the door, and the ledger.
--
-- EVERY ASSERTION HERE WAS RUN AGAINST THE MUTATION THAT REMOVES WHAT IT
-- NAMES (2026-09-02, second pass, numbers are this file's test numbers).
-- Each mutation fails the assertion that names it; where the break is also
-- felt downstream, those are listed, so the record is what happened and not
-- what was intended:
--   * the flag branch (`if false then`)       -> 7 'with the flag on a new photo holds', and
--                                                every later assertion that needs a pending photo
--   * `photo_status = 'approved'` in my_chats  -> 13 'a member gets no path at all from the chat list', 30
--   * the same term in group_invite_preview   -> 14 'nor from the invite screen', and only it
--   * the same term in the storage policy     -> 15 'and the bucket refuses them the picture', and only it
--   * the setter check                        -> 6 'an admin cannot make the group wear a photo
--                                                somebody else uploaded', and only it
--   * the early return in the moderate trigger-> 19 'and files no second event', 22 (a rename now
--                                                files an event, so the replacement's count is off by one)
--   * `old.photo_path is distinct from new.photo_path` in the UPDATE poke
--                                             -> 20 'and does not poke the worker', and only it
--   * `v_group.photo_path is distinct from p_photo_path` in the door
--                                             -> 24 'a verdict about the previous photo approves nothing',
--                                                then 25, 27, 30, 32, 33: the stale allow lands on the
--                                                replacement, which is the race written out
--   * `new.moderation_attempts := 0` in the new-picture branch (the null
--     branch's reset left in place)           -> 46 'a replacement photo starts its count at zero', 47
--   * the path removal in the verdict         -> 39 'a refused photo is removed from the group', 49
--   * the 'rejected' carve-out in the null branch
--                                             -> 40 'and the status stays behind', and only it
--   * photo_status = null on p_clear_photo    -> 44 'clearing the photo clears the notice with it', and only it
--   * the refusal filed as 'photo_rejected'   -> 41 'the ledger records the refusal', 43 and 51 (it IS a
--                                                strike then; 42 still passes because is_strike_action
--                                                itself did not move)
begin;
select plan(51);

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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'ana@example.com'),      -- the admin, who uploads
  ('00000000-0000-0000-0000-0000000000b5', 'bruno@example.com'),    -- a member
  ('00000000-0000-0000-0000-0000000000c5', 'chiara@example.com');   -- nobody in particular

-- Functions, not temp tables: `set local role authenticated` cannot read
-- pg_temp tables, and the half of this file that matters runs as a user.
create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Porto crew' $$;

create function pg_temp.status() returns text language sql as
  $$ select photo_status::text from public.groups where name = 'Porto crew' $$;

create function pg_temp.path() returns text language sql as
  $$ select photo_path from public.groups where name = 'Porto crew' $$;

create function pg_temp.attempts() returns int language sql as
  $$ select moderation_attempts from public.groups where name = 'Porto crew' $$;

-- What the chat list hands the current role for this group.
create function pg_temp.list_path() returns text language sql as
  $$ select photo_path from public.my_chats() where chat_id = pg_temp.crew() $$;

-- What the invite screen hands the current role.
create function pg_temp.invite_path() returns text language sql as
  $$ select photo_path from public.group_invite_preview(current_setting('test.token')) $$;

-- How many chat-photos objects the current role can see through the bucket's
-- policies. This is the read an old bundle makes with a path it should not
-- have been able to use.
create function pg_temp.visible_objects() returns int language sql as
  $$ select count(*)::int from storage.objects where bucket_id = 'chat-photos' $$;

create function pg_temp.events(p_action text) returns int language sql as
  $$ select count(*)::int from public.moderation_events
      where entity_type = 'group_photo' and entity_id = pg_temp.crew() and action = p_action $$;

create function pg_temp.strikes(uid uuid) returns int language sql as
  $$ select count(*)::int from public.moderation_events
      where subject_user_id = uid and public.is_strike_action(action) $$;

-- The poke throttle row for the moderation worker. poke_worker writes it
-- (and swallows the absent pg_net), so it is the trace a poke leaves here.
create function pg_temp.poked_at() returns timestamptz language sql as
  $$ select last_poked_at from public.worker_pokes where worker = 'moderation-worker' $$;

-- ---------------------------------------------------------------------------
-- The flag-off branch, which a keyless dev project and this suite run
-- ---------------------------------------------------------------------------

select is(
  (select value from public.app_config where key = 'require_photo_moderation'),
  'false',
  'the suite runs with photo moderation off'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.create_group('Porto crew', null::date, 'everyone',
  '00000000-0000-0000-0000-0000000000a5/one.jpg');
select set_config('test.token', public.group_invite_token(pg_temp.crew()), false);

-- Bruno joins through the link, the way a member arrives.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select public.join_group_with_invite(current_setting('test.token'), (current_date + 30)::date);
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');

select is(pg_temp.status(), 'approved',
  'with the flag off a group photo is approved on insert, as a profile photo is');

select pg_temp.admin();
select is(pg_temp.events('auto_approved'), 1,
  'and the ledger records who approved it and why');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.list_path(), '00000000-0000-0000-0000-0000000000a5/one.jpg',
  'so a member is handed the path in the chat list');
select is(pg_temp.invite_path(), '00000000-0000-0000-0000-0000000000a5/one.jpg',
  'and on the invite screen');

-- The setter check, which is what stops a group being a way to read any
-- object in the bucket somebody has learned the name of.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select public.update_group(p_chat_id => pg_temp.crew(),
       p_photo_path => '00000000-0000-0000-0000-0000000000b5/theirs.jpg') $$,
  '23514', null,
  'an admin cannot make the group wear a photo somebody else uploaded'
);

-- ---------------------------------------------------------------------------
-- The flag-on branch, which is how production runs
-- ---------------------------------------------------------------------------

select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/two.jpg');
-- The uploads themselves, so the bucket's own policy can be asked.
insert into storage.objects (bucket_id, name)
values ('chat-photos', '00000000-0000-0000-0000-0000000000a5/two.jpg'),
       ('chat-photos', '00000000-0000-0000-0000-0000000000a5/three.jpg');

select is(pg_temp.status(), 'pending',
  'with the flag on a new photo holds instead of going out unscreened');

select pg_temp.admin();
select is(pg_temp.events('queued_for_llm'), 1,
  'and the worker is queued for it');
select isnt(pg_temp.poked_at(), null,
  'and poked, so the admin waits seconds rather than a cron minute');

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(pg_temp.list_path(), '00000000-0000-0000-0000-0000000000a5/two.jpg',
  'the person who uploaded it is handed the path while it waits');
select is(pg_temp.invite_path(), '00000000-0000-0000-0000-0000000000a5/two.jpg',
  'on the invite screen too');
select is(pg_temp.visible_objects(), 2,
  'and can read their own uploads, so the tile they chose is not an empty frame');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.list_path(), null,
  'a member gets no path at all from the chat list while it is being checked');
select is(pg_temp.invite_path(), null,
  'nor from the invite screen');
select is(pg_temp.visible_objects(), 0,
  'and the bucket refuses them the picture, which is what protects a phone '
  'still on the old bundle reading groups.photo_path straight off the table');

-- A client cannot reach the verdict from either side.
select throws_ok(
  $$ update public.groups set photo_status = 'approved' where chat_id = pg_temp.crew() $$,
  '42501', null,
  'a member cannot write the table at all'
);
select throws_ok(
  $$ select public.apply_group_photo_verdict(pg_temp.crew(),
       '00000000-0000-0000-0000-0000000000a5/two.jpg', '{"action":"allow"}'::jsonb) $$,
  null,
  'and cannot hand down the verdict: that door is the worker''s'
);

-- Bookkeeping on the row is not a photo change. A rename names photo_path
-- in its SET list (update_group coalesces the old value back in), which is
-- exactly the write the early return exists for - and the poke's guard. The
-- throttle row is aged past its window first, so a poke that did fire would
-- land on it rather than be swallowed as a repeat.
select pg_temp.admin();
update public.worker_pokes set last_poked_at = now() - interval '1 minute'
 where worker = 'moderation-worker';
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(), p_name => 'Porto crew');
select is(pg_temp.status(), 'pending', 'a rename does not touch the verdict');
select pg_temp.admin();
select is(pg_temp.events('queued_for_llm'), 1,
  'and files no second event: nothing about the photo moved');
select is(pg_temp.poked_at(), now() - interval '1 minute',
  'and does not poke the worker: nothing about the photo moved');

-- ---------------------------------------------------------------------------
-- THE RACE. The worker has signed two.jpg and is waiting on the model. Before
-- the verdict lands, the admin picks three.jpg. A group is one row: the
-- trigger sets three.jpg pending, and a verdict keyed on the chat alone
-- would now approve a picture nobody has looked at.
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/three.jpg');
select is(pg_temp.status(), 'pending', 'a replacement photo holds like the first one did');
select pg_temp.admin();
select is(pg_temp.events('queued_for_llm'), 2, 'and is queued in its own right');
select is(pg_temp.poked_at(), now(),
  'and pokes the worker, which is what proves the rename above did not');

-- The worker's verdict about two.jpg arrives.
select is(
  public.apply_group_photo_verdict(pg_temp.crew(),
    '00000000-0000-0000-0000-0000000000a5/two.jpg',
    '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb),
  false,
  'a verdict about the previous photo approves nothing: the door says so'
);
select is(pg_temp.status(), 'pending', 'and the replacement is still waiting on its own');
select is(pg_temp.path(), '00000000-0000-0000-0000-0000000000a5/three.jpg',
  'still wearing the replacement');
select is(pg_temp.events('group_photo_approved'), 0, 'with nothing in the ledger');

-- And the failsafe about two.jpg, had the model been failing instead.
select is(
  public.apply_group_photo_verdict(pg_temp.crew(),
    '00000000-0000-0000-0000-0000000000a5/two.jpg',
    '{"action":"block","category":"moderation_unavailable","engine":"failsafe"}'::jsonb),
  false,
  'the previous photo''s failsafe removes nothing either'
);
select is(pg_temp.path(), '00000000-0000-0000-0000-0000000000a5/three.jpg',
  'the replacement is not the one that kept failing');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.list_path(), null,
  'and a member still has no path: nobody has looked at this one');

-- The worker's counter, which does not name photo_path and so never enters
-- the trigger.
select pg_temp.admin();
select public.note_group_photo_attempt(pg_temp.crew());
select is(pg_temp.attempts(), 1, 'the worker can count an attempt');
select is(pg_temp.status(), 'pending', 'without disturbing the verdict');

-- The verdict about the photo the group actually wears lands.
select is(
  public.apply_group_photo_verdict(pg_temp.crew(),
    '00000000-0000-0000-0000-0000000000a5/three.jpg',
    '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb),
  true,
  'the worker can approve the photo it looked at'
);
select is(pg_temp.status(), 'approved', 'and the row says so');
select is(pg_temp.events('group_photo_approved'), 1, 'and the ledger says so');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(pg_temp.list_path(), '00000000-0000-0000-0000-0000000000a5/three.jpg',
  'after which a member is handed the path');
select is(pg_temp.visible_objects(), 1,
  'and the bucket signs it for them, and only it: two.jpg is nobody''s group photo');

-- ---------------------------------------------------------------------------
-- A refused photo is removed, the admin is told, and nobody gets a strike
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/four.jpg');
select is(pg_temp.status(), 'pending', 'another replacement holds again');

select pg_temp.admin();
select public.apply_group_photo_verdict(pg_temp.crew(),
  '00000000-0000-0000-0000-0000000000a5/four.jpg',
  '{"action":"block","category":"explicit","engine":"claude-moderator"}'::jsonb);
select is(pg_temp.path(), null, 'a refused photo is removed from the group');
select is(pg_temp.status(), 'rejected',
  'and the status stays behind so the group page can say pick another');
select is(pg_temp.events('group_photo_rejected'), 1, 'the ledger records the refusal');
select ok(not public.is_strike_action('group_photo_rejected'),
  'which is not a strike action');
select is(pg_temp.strikes('00000000-0000-0000-0000-0000000000a5'), 0,
  'so the person who chose the picture has no strike against them');

-- The admin can put the notice away by having no photo at all. This is what
-- the group page's "Go without a photo" sends.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(), p_clear_photo => true);
select is(pg_temp.status(), null, 'clearing the photo clears the notice with it');

-- ---------------------------------------------------------------------------
-- The failsafe: MAX_ATTEMPTS refusals end in removal, never in pending forever
-- ---------------------------------------------------------------------------

select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/five.jpg');
select pg_temp.admin();
select public.note_group_photo_attempt(pg_temp.crew()) from generate_series(1, 3);
select is(pg_temp.attempts(), 3, 'three failed classifications are three on the counter');

-- A replacement WITHOUT a clear in between, so the count is reset by the
-- new-picture branch of the trigger and not by the null-path branch a clear
-- goes through. (With that reset deleted, this is the assertion that fails.)
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.update_group(p_chat_id => pg_temp.crew(),
  p_photo_path => '00000000-0000-0000-0000-0000000000a5/six.jpg');
select is(pg_temp.attempts(), 0, 'a replacement photo starts its count at zero');

select pg_temp.admin();
select public.note_group_photo_attempt(pg_temp.crew()) from generate_series(1, 10);
select is(pg_temp.attempts(), 10, 'ten failed classifications are ten on the counter');
-- What the worker does at MAX_ATTEMPTS (moderation-worker/index.ts, queue
-- 3d): the same door, the same path, engine 'failsafe'.
select is(
  public.apply_group_photo_verdict(pg_temp.crew(),
    '00000000-0000-0000-0000-0000000000a5/six.jpg',
    '{"action":"block","category":"moderation_unavailable","engine":"failsafe",
      "reason":"classification failed 10 times"}'::jsonb),
  true,
  'and the failsafe walks through the door'
);
select is(pg_temp.path(), null, 'and removes the photo rather than leaving it pending');
select is(pg_temp.events('group_photo_rejected_failsafe'), 1,
  'saying in the ledger that it was the failsafe, not the model');
select is(pg_temp.strikes('00000000-0000-0000-0000-0000000000a5'), 0,
  'and that is not a strike either');

select * from finish();
rollback;
