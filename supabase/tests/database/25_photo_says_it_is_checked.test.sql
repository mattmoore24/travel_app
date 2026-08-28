-- A room says a photo is being checked, and shows the sender their own.
--
-- The masking is the safety rule and it stays: nobody but the sender loads an
-- unscreened photo, in a room anyone can read. What changes is that masking
-- was ALL the RPC did, so the wait was drawn as an empty coloured bubble.
--
-- Two things worth guarding here, and they pull in opposite directions:
-- `photo_state` must be honest to everybody, and `image_path` must still be
-- withheld from everybody but the person who took the picture.
begin;
select plan(9);

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
  ('00000000-0000-0000-0000-0000000000a5', 'amy@example.com'),
  ('00000000-0000-0000-0000-0000000000b5', 'ben@example.com');

update public.profiles set
  display_name = 'Amy', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000a5';
update public.profiles set
  display_name = 'Ben', age = 31, home_country = 'ES',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000b5';

-- A group with both of them in it, and photo moderation on.
select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.create_group('Lisbon crew', null);

select pg_temp.admin();
-- A function rather than a temp table: the suite switches into the
-- `authenticated` role below, and that role has no privileges on anything in
-- pg_temp, so a temp table would be unreadable from exactly the half of the
-- test that matters.
-- From `groups`, not through `chats`: `chats` carries no select policy for
-- room members (harmless — my_chats is a definer function), so joining it
-- returns nothing once the suite switches into the authenticated role, and
-- every insert below would go to a null chat.
create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Lisbon crew' $$;

insert into public.room_members (chat_id, user_id, role, expires_at)
values (pg_temp.crew(), '00000000-0000-0000-0000-0000000000b5', 'member',
        now() + interval '30 days');

-- Amy posts a photo with a caption. One row, not two.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
insert into public.messages (chat_id, sender_id, image_path, body)
values (pg_temp.crew(), '00000000-0000-0000-0000-0000000000a5',
        '00000000-0000-0000-0000-0000000000a5/beach.jpg', 'look at this');

select is(
  (select count(*)::int from public.messages m where m.chat_id = pg_temp.crew()),
  1,
  'a photo and its caption are one message, not two'
);

select is(
  (select m.moderation_status::text from public.messages m where m.chat_id = pg_temp.crew()),
  'pending',
  'and the whole row waits on the verdict'
);

-- WHAT THE SENDER SEES ------------------------------------------------------

select is(
  (select r.photo_state from public.room_messages(pg_temp.crew()) r),
  'checking',
  'the sender is told their photo is being checked'
);

select is(
  (select r.image_path from public.room_messages(pg_temp.crew()) r),
  '00000000-0000-0000-0000-0000000000a5/beach.jpg',
  'and sees their own picture while it happens'
);

select is(
  (select r.body from public.room_messages(pg_temp.crew()) r),
  'look at this',
  'the caption is not held back — it is text, and text is not screened here'
);

-- WHAT EVERYBODY ELSE SEES --------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');

select is(
  (select r.photo_state from public.room_messages(pg_temp.crew()) r),
  'checking',
  'another member is told the same thing, so the wait is not a blank bubble'
);

select is(
  (select r.image_path from public.room_messages(pg_temp.crew()) r),
  null,
  'but never gets the path to an unscreened photo'
);

-- AFTER THE VERDICT ---------------------------------------------------------

select pg_temp.admin();
select public.apply_chat_photo_verdict(
  (select m.id from public.messages m where m.chat_id = pg_temp.crew()),
  '{"action":"allow","category":"ok","confidence":0.99,"reason":"fine","engine":"claude-moderator"}'::jsonb
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');

select is(
  (select r.photo_state from public.room_messages(pg_temp.crew()) r),
  'ready',
  'once it clears, the tile gives way to the picture'
);

select is(
  (select r.image_path from public.room_messages(pg_temp.crew()) r),
  '00000000-0000-0000-0000-0000000000a5/beach.jpg',
  'and the path is finally handed over'
);

select * from finish();
rollback;
