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
select plan(19);

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

-- A REFUSED PROFILE PHOTO SAYS WHY -----------------------------------------
--
-- Two rejections that must never read the same. `photo_rejected_failsafe` is
-- the classifier giving up: explicitly not a strike, and telling that person
-- they broke the rules is the whole bug 20260901100000 exists to fix. The row
-- has to carry enough for the screen to tell them apart, and no more - the
-- model's free-text reason is deliberately not stored.

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
insert into public.profile_photos (user_id, storage_path, position)
values ('00000000-0000-0000-0000-0000000000a5',
        '00000000-0000-0000-0000-0000000000a5/timeout.jpg', 0);

select pg_temp.admin();
select public.apply_photo_verdict(
  (select id from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/timeout.jpg'),
  '{"action":"block","category":"moderation_unavailable","reason":"classification failed 3 times","engine":"failsafe"}'::jsonb
);

select is(
  (select moderation_engine from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/timeout.jpg'),
  'failsafe',
  'a check that gave up is recorded as the failsafe engine'
);

select is(
  (select moderation_category from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/timeout.jpg'),
  'moderation_unavailable',
  'and the category it came with is kept as written'
);

-- bool_or over the two rejection actions, not the bare action: the insert
-- trigger already logged queued_for_llm against this photo, so a scalar
-- subquery over every event for it returns two rows and dies.
select is(
  (select bool_or(public.is_strike_action(e.action)) from public.moderation_events e
    where e.entity_id = (select id from public.profile_photos
      where storage_path = '00000000-0000-0000-0000-0000000000a5/timeout.jpg')
      and e.action in ('photo_rejected', 'photo_rejected_failsafe')),
  false,
  'still not a strike: apply_strike_policy never counts a failsafe'
);

select is(
  (select q.body from public.push_queue q
    where q.user_id = '00000000-0000-0000-0000-0000000000a5'
      and q.title = 'Photo could not be checked'),
  'Our automatic check could not read one of your photos, so nobody else can see it. Nothing about it broke a rule. Upload it again and the check runs once more.',
  'and the push says a machine decided, and says it was not a rules breach'
);

-- The other kind: a real rules rejection, which keeps the category the screen
-- turns into a sentence of its own.
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
insert into public.profile_photos (user_id, storage_path, position)
values ('00000000-0000-0000-0000-0000000000a5',
        '00000000-0000-0000-0000-0000000000a5/broke.jpg', 1);

select pg_temp.admin();
select public.apply_photo_verdict(
  (select id from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/broke.jpg'),
  '{"action":"block","category":"explicit","confidence":0.97,"reason":"model prose that must never reach a screen","engine":"claude-moderator"}'::jsonb
);

select is(
  (select moderation_category from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/broke.jpg'),
  'explicit',
  'a rules rejection keeps its category, which is what names the reason'
);

select is(
  (select moderation_engine from public.profile_photos
    where storage_path = '00000000-0000-0000-0000-0000000000a5/broke.jpg'),
  'claude-moderator',
  'and the engine, so the screen can tell it from a timeout'
);

select is(
  (select bool_or(public.is_strike_action(e.action)) from public.moderation_events e
    where e.entity_id = (select id from public.profile_photos
      where storage_path = '00000000-0000-0000-0000-0000000000a5/broke.jpg')
      and e.action in ('photo_rejected', 'photo_rejected_failsafe')),
  true,
  'this one IS a strike'
);

select is(
  (select q.body from public.push_queue q
    where q.user_id = '00000000-0000-0000-0000-0000000000a5'
      and q.title = 'Photo removed'),
  'One of your photos breaks our house rules, so nobody else can see it. An automatic check made that call. Open your photos to see why, and tap Contact us if it got it wrong.',
  'the push names the house rules, says a machine decided, and offers a person'
);

-- THE ATTACK ----------------------------------------------------------------
--
-- The reason is the owner''s business and nobody else''s. profile_photos has
-- no column-level select grant, so what keeps a stranger out is RLS: the
-- approved-only policy hides the whole ROW, columns included.

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select is(
  (select count(*)::int from public.profile_photos
    where user_id = '00000000-0000-0000-0000-0000000000a5'
      and moderation_category is not null),
  0,
  'a stranger cannot read why somebody else''s photo was refused'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is(
  (select count(*)::int from public.profile_photos
    where user_id = '00000000-0000-0000-0000-0000000000a5'
      and moderation_category is not null),
  2,
  'the owner can, which is the only way the screen can say why'
);

select * from finish();
rollback;
