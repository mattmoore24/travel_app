-- Establishment rooms, guest mode, reactions, and the traveler horizon.
begin;
select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com'),
  ('00000000-0000-0000-0000-0000000000ff', 'staff@hostel.example');

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

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- THE MATCHING HORIZON ---------------------------------------------------------
-- Alice and Bob overlap next week; Cara overlaps with Alice, but past the
-- horizon. That window is a season now (180 days, set in
-- 20260819210000_profile_first) rather than a fortnight, so Cara moves out
-- with it — the point of the fixture is the boundary, not the number.
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.lisbon(), current_date + 2, current_date + 300),
  ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(), current_date + 3, current_date + 9),
  ('00000000-0000-0000-0000-00000000000c', pg_temp.lisbon(), current_date + 200, current_date + 205);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.get_matches()
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'a traveler arriving inside the horizon is matched'
);
select is(
  (select count(*)::int from public.get_matches()
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  0,
  'an overlap beyond the matching horizon is not shown yet'
);
select is(
  (select their_end from public.get_matches()
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  current_date + 9,
  'matches carry the full stay so the card can show its length'
);
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000000c', 'trip_match', 'hi!', 'bio') $$,
  'recipient unavailable',
  'requests obey the same window as browsing'
);

-- GUEST MODE: THE MAP ------------------------------------------------------------
select pg_temp.admin();
insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                         intent_date, expires_at, seeded, seed_note)
values (null, pg_temp.lisbon(), 'LX Factory market', 'other', 38.7025, -9.1782,
        current_date, now() + interval '48 hours', true, 'Meet at the main gate');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                         intent_date, expires_at)
values ('00000000-0000-0000-0000-00000000000b', pg_temp.lisbon(),
        'Miradouro Santa Catarina', 'monument', 38.7089, -9.1487,
        current_date, now() + interval '30 hours');

select pg_temp.guest();
select is(
  (select count(*)::int from public.public_city_pins(pg_temp.lisbon())),
  2,
  'a signed-out visitor sees both curated and user pins on the map'
);
select is(
  (select seed_note from public.public_city_pins(pg_temp.lisbon()) where seeded),
  'Meet at the main gate',
  'curated pins keep their note'
);
select is(
  (select count(*)::int
   from information_schema.columns
   where table_name = 'public_city_pins' or column_name in ('display_name', 'photo_path')
     and table_name = 'public_city_pins'),
  0,
  'the guest pin feed has no identity columns at all'
);
select throws_ok(
  $$ select * from public.pins $$,
  '42501',
  null,
  'guests cannot read the pins table directly'
);
select throws_ok(
  $$ select * from public.city_pins(pg_temp.lisbon()) $$,
  '42501',
  null,
  'guests cannot call the identity-carrying pin feed'
);
select lives_ok(
  $$ select * from public.public_heat_cells(pg_temp.lisbon()) $$,
  'guests can render the heat layer'
);
select lives_ok(
  $$ select * from public.search_cities('lis') $$,
  'guests can search cities'
);

-- GUEST MODE: THE FEATURED TRAVELER ------------------------------------------------
--
-- This is the ONE person a signed-out visitor sees, and the pitch of the
-- screen is "here is somebody real, here right now". A faceless card makes
-- the opposite case, so a face is a requirement rather than a nicety.

select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  0,
  'nobody is featured while nobody in town has a photo'
);

select pg_temp.admin();
insert into public.profile_photos (user_id, storage_path, position, moderation_status)
values ('00000000-0000-0000-0000-00000000000b', 'photos/bob-0.jpg', 0, 'approved');
select pg_temp.guest();

select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  1,
  'guests see exactly one traveler card'
);
select is(
  (select user_id from public.featured_traveler(pg_temp.lisbon())),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'and it is the one with a face'
);
select throws_ok(
  $$ select * from public.get_matches() $$,
  '42501',
  null,
  'guests cannot page through every traveler'
);
select throws_ok(
  $$ select * from public.profiles $$,
  '42501',
  null,
  'guests cannot read profiles directly'
);
select throws_ok(
  $$ select * from public.social_handles $$,
  '42501',
  null,
  'guests cannot read social handles'
);

-- ESTABLISHMENT ROOMS --------------------------------------------------------------
select pg_temp.admin();
insert into public.chats (id, kind) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'room');
insert into public.establishments (id, city_id, name, kind, lat, lng, chat_id)
values ('cccccccc-0000-4000-8000-000000000001', pg_temp.lisbon(),
        'Home Lisbon Hostel', 'hostel', 38.7100, -9.1400,
        'bbbbbbbb-0000-4000-8000-000000000001');
insert into public.establishment_staff (establishment_id, user_id)
values ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-0000-0000-0000000000ff');

-- Joining sets an expiry from the stated departure date.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (public.join_room('bbbbbbbb-0000-4000-8000-000000000001', current_date + 3)) ->> 'joined',
  'true',
  'a traveler can join a room by stating when they leave'
);
select is(
  (select (expires_at::date - current_date)::int from public.room_members
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  10,
  'membership ends 7 days after the stated departure'
);
select public.join_room('bbbbbbbb-0000-4000-8000-000000000001', current_date + 90);
select is(
  (select (expires_at::date - current_date)::int from public.room_members
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  30,
  'a long stay is capped at 30 days in the room'
);
-- Back to a normal stay for the rest of the file.
select public.join_room('bbbbbbbb-0000-4000-8000-000000000001', current_date + 3);

-- Members post; non-members cannot.
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body) values
     ('bbbbbbbb-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-00000000000a',
      'Anyone up for the sunset walk tonight?') $$,
  'a member can post in the room'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body) values
     ('bbbbbbbb-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-00000000000c', 'hello') $$,
  '42501',
  null,
  'a non-member cannot post in the room'
);
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000001')),
  1,
  'a signed-in non-member reads the room through the public preview, same as a guest'
);

-- The signed-out preview.
select pg_temp.guest();
select is(
  (select count(*)::int from public.city_rooms(pg_temp.lisbon())),
  1,
  'guests can see which rooms exist in a city'
);
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000001')),
  1,
  'guests can read a public-preview room'
);

-- WHAT THE ROOM IS CALLED --------------------------------------------------
--
-- The header on a public preview used to read the literal words "Guest room"
-- to everybody who was not already a member — which is exactly the people it
-- was supposed to be selling the place to.

select isnt(
  (select name from public.room_info('bbbbbbbb-0000-4000-8000-000000000001')),
  null,
  'a visitor can find out what the room is actually called'
);
select is(
  (select is_group from public.room_info('bbbbbbbb-0000-4000-8000-000000000001')),
  false,
  'and whether it is a venue or a traveler group'
);
select throws_ok(
  $$ insert into public.messages (chat_id, sender_id, body) values
     ('bbbbbbbb-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-00000000000a', 'guest post') $$,
  '42501',
  null,
  'guests can never post — read-only by construction'
);
select pg_temp.admin();
update public.establishments set public_preview = false
  where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.guest();
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000001')),
  0,
  'an establishment can switch the public preview off'
);
-- And that closes the name with it: room_info adds no visibility of its own.
select is(
  (select count(*)::int from public.room_info('bbbbbbbb-0000-4000-8000-000000000001')),
  0,
  'switching the preview off hides the name from strangers too'
);
select pg_temp.admin();
update public.establishments set public_preview = true
  where id = 'cccccccc-0000-4000-8000-000000000001';

-- A member still sees the name whatever the preview flag says.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.room_info('bbbbbbbb-0000-4000-8000-000000000001')),
  1,
  'a member can always read the name of a room they are in'
);

-- Moderator tools.
select pg_temp.login('00000000-0000-0000-0000-0000000000ff');
select lives_ok(
  $$ select public.room_remove_message(
       (select id from public.messages
         where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001' limit 1)) $$,
  'a moderator can remove a message'
);
select is(
  (select body from public.messages
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001' limit 1),
  null,
  'removed content is cleared but the row survives as evidence'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select public.room_remove_member('bbbbbbbb-0000-4000-8000-000000000001',
                                      '00000000-0000-0000-0000-00000000000a') $$,
  'room not found',
  'a normal member cannot remove anyone'
);

-- REACTIONS -----------------------------------------------------------------------
select pg_temp.admin();
insert into public.messages (id, chat_id, sender_id, body) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-00000000000a', 'Meeting at reception at 7');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.message_reactions (message_id, user_id, emoji) values
     ('dddddddd-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-00000000000a', '🙌') $$,
  'a member can react to a message'
);
select is(
  (select count::int from public.message_reaction_summary(
     'bbbbbbbb-0000-4000-8000-000000000001')
   where message_id = 'dddddddd-0000-4000-8000-000000000001'),
  1,
  'reactions aggregate for rendering'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ insert into public.message_reactions (message_id, user_id, emoji) values
     ('dddddddd-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-00000000000c', '👍') $$,
  '42501',
  null,
  'a non-member cannot react'
);

-- PIN / MUTE / ARCHIVE + EXPIRY SWEEP ------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.set_chat_pref('bbbbbbbb-0000-4000-8000-000000000001', true, true, null) $$,
  'a member can pin and mute a chat'
);
select is(
  (select pinned and muted from public.my_chats()
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  true,
  'the chat list reflects pin and mute state'
);
select is(
  (select count(*)::int from public.my_chats(true)),
  0,
  'nothing is archived yet'
);
select pg_temp.admin();
update public.room_members set expires_at = now() - interval '1 hour'
  where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001';
select is(
  public.expire_room_members(),
  1,
  'the sweep removes members whose stay window has passed'
);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.my_chats()
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  0,
  'an expired member no longer sees the room'
);

-- The cron worker invoker is SECURITY DEFINER and posts a service-role bearer
-- token, so reaching it from a session role would be a real escalation.
select has_function('public', 'invoke_edge_worker', array['text'],
  'the worker invoker exists');
select ok(
  not has_function_privilege('anon', 'public.invoke_edge_worker(text)', 'execute'),
  'anon cannot invoke the edge workers'
);
select ok(
  not has_function_privilege('authenticated', 'public.invoke_edge_worker(text)', 'execute'),
  'authenticated cannot invoke the edge workers'
);
-- The name is concatenated into a URL, so anything outside the allowlist must
-- be refused rather than fetched. Runs as admin because a session role cannot
-- reach the function at all (asserted above).
select pg_temp.admin();
select throws_ok(
  $$select public.invoke_edge_worker('../../admin')$$,
  '23514',
  null,
  'an unknown worker name is refused, not interpolated into a URL'
);

-- worker_status reports infrastructure state; it must not be reachable from a
-- session role either.
select ok(
  not has_function_privilege('anon', 'public.worker_status()', 'execute'),
  'anon cannot read worker diagnostics'
);
select ok(
  not has_function_privilege('authenticated', 'public.worker_status()', 'execute'),
  'authenticated cannot read worker diagnostics'
);

select * from finish();
rollback;
