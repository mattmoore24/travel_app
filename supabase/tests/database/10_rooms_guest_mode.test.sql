-- Establishment rooms, guest mode, reactions, and the traveler horizon.
begin;
select plan(67);

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

-- THE CALLER HAS TO BE ABLE TO CALL IT, and that is newly load-bearing.
--
-- supabase/functions/featured-photo/index.ts used to ask for these rows with
-- the SERVICE role, which is how the block filter came to be off on the photo
-- side of the screen. It asks as the caller now, so a signed-out visitor's
-- faces depend on `anon` holding EXECUTE and a guest ACCOUNT's on
-- `authenticated` holding it - a dependency that function did not have while
-- it ran as admin.
--
-- BOTH GRANTS ARE ALREADY REDUNDANT, which is the reason to assert them
-- rather than trust them. 20260902260000 grants both explicitly, the shim's
-- `alter default privileges ... grant all on functions` covers both again
-- (real Supabase does the same), and Postgres hands PUBLIC execute on a new
-- function on top of that. Measured: dropping either name from the grant, or
-- revoking it from that role alone, changes not one answer in this file. What
-- fails is `revoke ... from public, <role>` - this repo's own lockdown idiom,
-- the one at 20260830000000:57 - and that is precisely the well-meant change
-- that would take the guest's faces away without touching a line of the
-- function.
--
-- They sit ABOVE the first call rather than beside the others. Revoking from
-- anon makes that call raise, which aborts the transaction and every
-- assertion after it, so an assertion placed later could never be the one to
-- report it.
select ok(
  has_function_privilege('anon', 'public.featured_traveler(int)', 'execute'),
  'a signed-out visitor may call the function its faces come from'
);
select ok(
  has_function_privilege('authenticated', 'public.featured_traveler(int)', 'execute'),
  'and so may a guest account, which is an anonymous authenticated user'
);

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
  'one traveler in town with a face is one card, not an empty screen'
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

-- GUEST MODE: THREE FACES, AND WHAT IS IN NONE OF THEM -----------------------------
--
-- One card became three (20260902260000), because one face cannot answer "are
-- there people here on my dates" and a dead city is this category's number one
-- killer. That is a real widening: three strangers reach a signed-out device
-- where one did.
--
-- SO EVERY EXCLUSION IS ASSERTED OVER THE WHOLE RESULT, NOT OVER ITS FIRST
-- ROW. A filter written as `where` on a single-row function and a filter
-- applied to the top of a list are indistinguishable while the list is one
-- long, and the whole class of bug this file is now guarding is the one that
-- only appears at row two. Every check below counts matching rows in the FULL
-- return and expects zero.
--
-- The fixture: SEVEN travelers in town with an approved face, plus three who
-- must never appear for three different reasons.
--
-- Seven eligible travelers for three slots, so the cut and the ranking are
-- both doing visible work: with four, "three came back" and "everybody
-- eligible came back minus one" are the same sentence, and the block
-- assertions at the end of this section would be satisfied by a function that
-- simply returned whoever was left.
select pg_temp.admin();
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'feat-dora@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'feat-eli@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'feat-fin@example.com'),
  ('00000000-0000-0000-0000-0000000000f4', 'feat-gil@example.com'),
  ('00000000-0000-0000-0000-0000000000f5', 'feat-hana@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'feat-ines@example.com'),
  ('00000000-0000-0000-0000-0000000000f7', 'feat-joao@example.com'),
  ('00000000-0000-0000-0000-0000000000f8', 'feat-kit@example.com'),
  ('00000000-0000-0000-0000-0000000000f9', 'feat-lena@example.com');

-- The blanket update at the top of this file ran before these rows existed.
update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
 where user_id in ('00000000-0000-0000-0000-0000000000f1',
                   '00000000-0000-0000-0000-0000000000f2',
                   '00000000-0000-0000-0000-0000000000f3',
                   '00000000-0000-0000-0000-0000000000f4',
                   '00000000-0000-0000-0000-0000000000f5',
                   '00000000-0000-0000-0000-0000000000f6',
                   '00000000-0000-0000-0000-0000000000f7',
                   '00000000-0000-0000-0000-0000000000f8',
                   '00000000-0000-0000-0000-0000000000f9');

-- Bios, so the "only the lead carries one" assertions below have something to
-- find. Bob leads; Dora and Eli take the two rows under him.
update public.profiles set bio = 'Here for the tiles and the pasteis.'
 where user_id in ('00000000-0000-0000-0000-00000000000b',
                   '00000000-0000-0000-0000-0000000000f1',
                   '00000000-0000-0000-0000-0000000000f2');

-- Dora holds TWO Lisbon windows inside the fortnight. `trips` has no unique
-- constraint on (user_id, city_id) and the cap is five active trips, so
-- without the dedupe one traveler could take every slot and the screen would
-- answer "are there people here" with the same face three times. Invisible
-- while the answer was one row long.
insert into public.trips (user_id, city_id, start_date, end_date, approximate) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.lisbon(),
   current_date, current_date + 4, false),
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.lisbon(),
   current_date + 6, current_date + 10, false),
  -- Eli's window is a guess, not a claim (20260902230000).
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.lisbon(),
   current_date + 1, current_date + 5, true),
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.lisbon(),
   current_date + 2, current_date + 6, false),
  ('00000000-0000-0000-0000-0000000000f4', pg_temp.lisbon(),
   current_date + 1, current_date + 6, false),
  ('00000000-0000-0000-0000-0000000000f5', pg_temp.lisbon(),
   current_date + 1, current_date + 6, false),
  ('00000000-0000-0000-0000-0000000000f7', pg_temp.lisbon(),
   current_date + 1, current_date + 6, false),
  ('00000000-0000-0000-0000-0000000000f8', pg_temp.lisbon(),
   current_date + 2, current_date + 7, false),
  ('00000000-0000-0000-0000-0000000000f9', pg_temp.lisbon(),
   current_date + 3, current_date + 8, false);

-- Ines went home. The trigger refuses a trip wholly in the past, which is
-- right for a traveler and in the way here.
alter table public.trips disable trigger trips_validate_dates;
insert into public.trips (user_id, city_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000000f6', pg_temp.lisbon(),
   current_date - 9, current_date - 3);
alter table public.trips enable trigger trips_validate_dates;

insert into public.profile_photos (user_id, storage_path, position, moderation_status) values
  ('00000000-0000-0000-0000-0000000000f1', 'photos/dora-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', 'photos/eli-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', 'photos/fin-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f4', 'photos/gil-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f5', 'photos/hana-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f6', 'photos/ines-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f7', 'photos/joao-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f8', 'photos/kit-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-0000000000f9', 'photos/lena-0.jpg', 0, 'approved');

-- Gil narrowed his audience to verified travelers. A guest is nobody in
-- particular, so he is eligible for no slot at all - not the first one, and
-- not the third.
update public.profiles set verified = true
 where user_id = '00000000-0000-0000-0000-0000000000f4';
update public.profiles set visible_to = 'verified'
 where user_id = '00000000-0000-0000-0000-0000000000f4';
-- Hana's account is closed. Ines went home before today (her trip is
-- inserted above, past-dated with the validation trigger held off).
update public.users set status = 'banned'
 where id = '00000000-0000-0000-0000-0000000000f5';

-- AND BOTH OF THEM CARRY THE BADGE, which is the whole of what makes the two
-- assertions about them able to fail at all.
--
-- Every eligible traveler here ties on hellos (nothing in this file inserts a
-- message_request) and on created_at (one transaction, one clock), so
-- `f.verified desc` is the only key that can lift somebody above the rest -
-- the same lever the fixture already uses on Gil two statements up. With the
-- badge, deleting `u.status = 'active'` from featured_traveler puts Hana in
-- slot 1 and deleting `t.end_date >= current_date - 1` puts Ines in slot 1.
-- Without it they sort by user_id, land seventh and eighth of the nine, and
-- fall off the end of a three-row answer whether their guard is there or not -
-- so the assertions passed either way, and the only pgTAP coverage the
-- banned-account and ended-trip guards had proved nothing at all. Both
-- verified by deleting each predicate from the migration in turn.
update public.profiles set verified = true
 where user_id in ('00000000-0000-0000-0000-0000000000f5',
                   '00000000-0000-0000-0000-0000000000f6');

select pg_temp.guest();

select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  3,
  'a guest is shown three travelers, never the whole city'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'a traveler with two windows in the same city takes one slot, not two'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f4'),
  0,
  'a traveler who narrowed their audience is in NONE of the three rows'
);
-- Hana would be slot 1 without `u.status = 'active'`; see the badge note in
-- the fixture. This fails when that predicate goes.
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f5'),
  0,
  'nor is a closed account, in any row'
);
-- And Ines would be slot 1 without `t.end_date >= current_date - 1`. Same
-- note, same measurement.
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f6'),
  0,
  'nor a traveler whose trip has already ended'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'nor anybody who has not put a face on their own profile'
);

-- THE ORDER IS TOTAL, and that is a privacy assertion rather than a tidiness
-- one. The card and the faces are two separate calls to this function - the
-- client's, and featured-photo's, which that function makes with the CALLER's
-- own JWT and then signs a URL per row it gets back (the service role signs;
-- it no longer chooses, because an admin call has no auth.uid() and every
-- guard in here would answer for nobody). Every ELIGIBLE traveler here ties on
-- hellos, on the badge and on created_at (now() is the transaction's clock, so
-- every fixture row in this file shares it) - the three excluded ones carry
-- the badge on purpose, see the fixture - so the `f.user_id` tiebreak is the
-- whole of what
-- decides which three of the seven come back. Without it the two calls can cut
-- a different three, and the screen gets a card it has no face for.
--
-- TWO ASSERTIONS, AND ONLY THE SECOND ONE TESTS THE TIEBREAK. The first pins
-- who comes back and in what order, which is worth having and is what caught
-- the dedupe and the exclusions above landing in one string. It does NOT catch
-- a missing tiebreak, and it used to claim it did: deleting `, f.user_id` from
-- the migration left the whole suite green. Measured again after the rewrite,
-- at 4, 5, 6, 7, 8, 10, 16 and 30 fully tied travelers, and with the tie group
-- forced to sort from the back of the input to the front - the answer never
-- changed. A sort handed rows that compare equal returns them in the order it
-- received them, and that order is the subquery's `order by t.user_id`, which
-- is the order the tiebreak asks for. The two are indistinguishable from
-- inside one session, and the guarantee the two CALLERS need is not.
--
-- So the tiebreak is asserted against the deployed definition instead. That is
-- not a weaker test of it; it is the only one that fails.
select is(
  (select string_agg(user_id::text, ',') from public.featured_traveler(pg_temp.lisbon())),
  '00000000-0000-0000-0000-00000000000b,'
  '00000000-0000-0000-0000-0000000000f1,'
  '00000000-0000-0000-0000-0000000000f2',
  'the three come back deduplicated, filtered, and in ranking order'
);
select matches(
  pg_get_functiondef('public.featured_traveler(int)'::regprocedure),
  'order by f\.hellos desc, f\.verified desc, f\.created_at desc, f\.user_id',
  'and the user_id tiebreak is what makes that order total'
);

-- The flag, so a card can say "Around Sep 3" rather than stating a day its
-- owner told the app they were guessing at.
select is(
  (select approximate from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f2'),
  true,
  'a rough window arrives marked as a guess'
);
select is(
  (select approximate from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  false,
  'and a real one arrives as the claim it is'
);

-- WHAT IS TRANSPORTED, not what is drawn. The rows under the lead render as a
-- face, a name, an age, a seal and dates, so that is all the server sends
-- them: three faces was the change, three strangers' bios reaching a
-- signed-out device was not. `languages` was leaving the database for every
-- row and being printed nowhere at all, so it is gone from the signature.
select isnt(
  (select bio from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  null,
  'the lead card gets the bio it prints'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id <> '00000000-0000-0000-0000-00000000000b' and bio is not null),
  0,
  'and no row under it carries a bio at all, printed or not'
);
select throws_ok(
  $$ select languages from public.featured_traveler(pg_temp.lisbon()) $$,
  '42703',
  null,
  'languages never leaves the database for a device with no account'
);

-- A BLOCK REACHES THIS SURFACE TOO -------------------------------------------
--
-- The block confirmation promises, in the user's own words, "They're gone from
-- the map and Travelers", and a guest ACCOUNT can block somebody. This
-- function carried no blocks filter at all until 20260902260000, so under
-- `limit 1` a blocked traveler could take the one slot and under `limit 3`
-- three of them. `blocks` is caller-scoped through auth.uid(), so the
-- assertions have to be made as somebody rather than as a signed-out visitor.
select pg_temp.admin();
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'somebody this account blocked is in none of the three rows'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  3,
  'and the slot they lose goes to the next traveler, not to a gap'
);

-- Caller-scoped, not a takedown: a block is one person's decision about one
-- other person, and it must not remove anybody from everybody else's screen.
select pg_temp.guest();
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'while a visitor who blocked nobody still sees them'
);
select pg_temp.admin();
delete from public.blocks
 where blocker_id = '00000000-0000-0000-0000-00000000000a'
   and blocked_id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.guest();

-- BUSINESS ROOMS -------------------------------------------------------------------
select pg_temp.admin();
insert into public.chats (id, kind) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'room');
insert into public.businesses
  (id, city_id, name, category, lat, lng, chat_id, state, listed_at)
values ('cccccccc-0000-4000-8000-000000000001', pg_temp.lisbon(),
        'Home Lisbon Hostel', 'hostel', 38.7100, -9.1400,
        'bbbbbbbb-0000-4000-8000-000000000001', 'listed', now());
insert into public.business_staff (business_id, user_id)
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
  6,
  'membership ends 3 days after the stated departure'
);
select public.join_room('bbbbbbbb-0000-4000-8000-000000000001', current_date + 200);
select is(
  (select (expires_at::date - current_date)::int from public.room_members
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  90,
  'a long stay is capped at 90 days in the room'
);
-- "I'm not sure" is a real answer, so the column that drives expiry has to
-- be allowed to be empty. Ninety days, the same cap, from today.
select public.join_room('bbbbbbbb-0000-4000-8000-000000000001', null);
select is(
  (select (expires_at::date - current_date)::int from public.room_members
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  90,
  'and "I am not sure" gives you the full ninety'
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
update public.businesses set public_preview = false
  where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.guest();
select is(
  (select count(*)::int from public.room_messages('bbbbbbbb-0000-4000-8000-000000000001')),
  0,
  'a business can switch the public preview off'
);
-- And that closes the name with it: room_info adds no visibility of its own.
select is(
  (select count(*)::int from public.room_info('bbbbbbbb-0000-4000-8000-000000000001')),
  0,
  'switching the preview off hides the name from strangers too'
);
select pg_temp.admin();
update public.businesses set public_preview = true
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
