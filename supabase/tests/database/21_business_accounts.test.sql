-- Business accounts, phase 13: identity and §7 rule 8.
--
-- Written as attacks. The rule this file exists to defend is rule 8 - "a
-- business account never initiates contact with a traveler, never joins a
-- traveler's group, and never reads traveler discovery surfaces" - and the
-- whole point of enforcing it in the database is that a client is a thing
-- somebody can replace. So every assertion below acts AS the business and
-- expects to be refused.
begin;
select plan(41);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'traveler@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'hostel@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');

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
  perform set_config('request.jwt.claims', null, true);
  reset role;
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- One real traveler, finished onboarding.
update public.profiles set
  display_name = 'Ana', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000a1';

-- REGISTERING --------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.register_business('Home Lisbon Hostel', 'hostel',
       (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
       38.7108, -9.1400) $$,
  'an account with no finished profile can register a business'
);

-- The keystone of the model: a business account is an ordinary auth user
-- whose onboarding_completed_at stays NULL forever, so it can never be
-- matched, spotlit or queued as a traveler.
select is(
  (select onboarding_completed_at from public.profiles
    where user_id = '00000000-0000-0000-0000-0000000000b1'),
  null,
  'and registering never finishes a traveler profile'
);
-- Through the admin, because a CLIENT may not ask this question at all any
-- more: the answer is exactly what the column-scoped grant hiding
-- businesses.owner_user_id exists to withhold, and PostgREST would have
-- served it for any user id lifted off a profile page. The two assertions
-- below are the property, and the third is the door being shut.
select pg_temp.admin();
select ok(
  public.is_business_account('00000000-0000-0000-0000-0000000000b1'),
  'is_business_account knows who it is'
);
select ok(
  not public.is_business_account('00000000-0000-0000-0000-0000000000a1'),
  'and a traveler is not one'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.is_business_account('00000000-0000-0000-0000-0000000000b1') $$,
  '42501',
  null,
  'and no client can ask it about somebody else'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

-- THE GEOFENCE, which did not exist until 20260829160000. A marker can sit
-- anywhere inside the plain -90..90 CHECKs, and until now nothing stopped a
-- listing claiming Lisbon from a marker in Porto — while the signup screen's
-- own comment said the server refused exactly that.
select pg_temp.admin();
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'porto@example.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select throws_ok(
  $$ select public.register_business('Porto Bar', 'bar',
       (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
       41.1496, -8.6109) $$,
  '23514',
  null,
  'a business marker outside the city radius is refused, like a pin'
);
select lives_ok(
  $$ select public.register_business('Bairro Bar', 'bar',
       (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
       38.7130, -9.1450, 'Rua da Rosa 12') $$,
  'and one inside it goes through, carrying the address it typed'
);
select pg_temp.admin();
select is(
  (select address from public.businesses where name = 'Bairro Bar'),
  'Rua da Rosa 12',
  'the address is stored as typed'
);
select is(
  (select place_label from public.businesses where name = 'Bairro Bar'),
  null,
  'and it did not go into place_label, which is the finding-the-door note'
);

-- Moving the marker is not an ordinary edit: the column grant withholds
-- lat/lng, so it goes through a function that re-runs the geofence.
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select throws_ok(
  $$ select public.update_business_location(41.1496, -8.6109) $$,
  '23514',
  null,
  'and moving it out of the city is refused too'
);
select lives_ok(
  $$ select public.update_business_location(38.7100, -9.1390) $$,
  'moving it within the city is fine'
);
select pg_temp.admin();
select is(
  (select address from public.businesses where name = 'Bairro Bar'),
  'Rua da Rosa 12',
  'and moving the marker leaves the typed address exactly as it was'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$ select public.register_business('Second Place', 'bar',
       (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
       38.71, -9.14) $$,
  'this account already runs a business',
  'one business per account'
);

-- The two account kinds must never overlap on one auth row, because every
-- guard below is a single question with a single answer.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.register_business('Ana Bar', 'bar',
       (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
       38.71, -9.14) $$,
  'this account is already a traveler',
  'and a traveler cannot become a business on the same account'
);

-- DARK UNTIL CONFIRMED -----------------------------------------------------

-- A brand new business lands `unconfirmed`, which means invisible on every
-- surface. That is what stops an unverified listing being the phishing
-- surface while it waits for its email link.
select pg_temp.guest();
select is(
  (select count(*)::int from public.city_rooms(
     (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Home Lisbon Hostel'),
  0,
  'an unconfirmed business is absent from the city list'
);
select is(
  (select count(*)::int from public.businesses where name = 'Home Lisbon Hostel'),
  0,
  'and unreadable at the table, for anon'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*)::int from public.businesses where name = 'Home Lisbon Hostel'),
  0,
  'and for a signed-in traveler'
);
select throws_ok(
  $$ select public.join_room(
       (select chat_id from public.businesses where name = 'Home Lisbon Hostel'), null) $$,
  'room unavailable',
  'and its chat cannot be joined'
);

-- The owner is the one exception: they see their own listing while it waits,
-- because that is the screen that tells them what is outstanding.
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.businesses where name = 'Home Lisbon Hostel'),
  1,
  'the owner still sees their own listing while it is dark'
);

select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
  where name = 'Home Lisbon Hostel';

select pg_temp.guest();
select is(
  (select count(*)::int from public.city_rooms(
     (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Home Lisbon Hostel'),
  1,
  'confirming the email is what puts it on the map'
);

-- WHAT A CLIENT MAY READ ---------------------------------------------------

-- The old grant was full-row, which was harmless while every column was
-- public. owner_user_id, the listing state and the verification timestamp
-- would all have been readable by the anon key that ships inside the app.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select owner_user_id from public.businesses $$,
  '42501',
  null,
  'a client cannot read who owns a business'
);
select throws_ok(
  $$ select state from public.businesses $$,
  '42501',
  null,
  'nor the listing state, which would leak the moderation queue'
);
select throws_ok(
  $$ select verified_at from public.businesses $$,
  '42501',
  null,
  'nor the raw verification timestamp'
);
select lives_ok(
  $$ select id, name, category, lat, lng, verified from public.businesses $$,
  'but the public columns and the badge boolean read fine'
);
select is(
  (select verified from public.businesses where name = 'Home Lisbon Hostel'),
  false,
  'and a business that has not sent a storefront photo is not verified'
);

-- WHAT A CLIENT MAY WRITE --------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

-- Note the WHERE: `id`, never `owner_user_id`. A client holds no SELECT
-- privilege on owner_user_id, and Postgres requires SELECT on every column a
-- statement NAMES, including in a WHERE - so filtering by owner is a
-- permission error even for the owner. RLS does the scoping instead: the
-- policy's `owner_user_id = auth.uid()` is evaluated by the system, not by
-- the caller, so it needs no grant. This is exactly how the client has to
-- write it too.
select lives_ok(
  $$ update public.businesses set description = 'Beds, roof, coffee.'
      where name = 'Home Lisbon Hostel' $$,
  'an owner edits their own description'
);
-- A business that could move its own marker could verify a surf shack and
-- then become the Marriott, which is the whole attack rename-and-move
-- exists to close.
select throws_ok(
  $$ update public.businesses set lat = 0
      where name = 'Home Lisbon Hostel' $$,
  '42501',
  null,
  'but cannot move its own marker'
);
select throws_ok(
  $$ update public.businesses set verified_at = now()
      where name = 'Home Lisbon Hostel' $$,
  '42501',
  null,
  'and cannot award itself the badge'
);
select throws_ok(
  $$ update public.businesses set description = 'you are so sexy'
      where name = 'Home Lisbon Hostel' $$,
  'that text breaks our house rules',
  'business text is screened like a bio'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (select count(*)::int from public.businesses
    where name = 'Home Lisbon Hostel' and description = 'Beds, roof, coffee.'),
  1,
  'a stranger reads the description'
);
with attempt as (
  update public.businesses set description = 'mine now'
    where name = 'Home Lisbon Hostel' returning 1
)
select is(
  (select count(*)::int from attempt),
  0,
  'and changes nothing, because RLS scopes the update to the owner'
);

-- MY OWN BUSINESS ----------------------------------------------------------

-- "Am I a business, and which one" cannot be asked at the table: a client
-- holds no SELECT on owner_user_id, and a plain select returns every listed
-- place with no way to tell which is yours. One RPC answers both.
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select name from public.my_business()),
  'Home Lisbon Hostel',
  'my_business finds the caller their own listing'
);
select is(
  (select state::text from public.my_business()),
  'listed',
  'and tells them its state, which no other client may read'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*)::int from public.my_business()),
  0,
  'and gives a traveler nothing'
);

-- §7 RULE 8: A BUSINESS NEVER REACHES OUT ----------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

select throws_ok(
  $$ insert into public.trips (user_id, city_id, start_date, end_date)
     values ('00000000-0000-0000-0000-0000000000b1',
             (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
             current_date + 1, current_date + 5) $$,
  '42501',
  null,
  'a business posts no trips'
);
select throws_ok(
  $$ insert into public.pins (user_id, city_id, lat, lng, category, note, intent_date, expires_at)
     values ('00000000-0000-0000-0000-0000000000b1',
             (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
             38.71, -9.14, 'bar', 'come to us', current_date + 1, now() + interval '2 days') $$,
  '42501',
  null,
  'and drops no pins, so it never counts toward the heatmap'
);
select throws_ok(
  $$ insert into public.message_requests (sender_id, recipient_id, source, first_message)
     values ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000a1', 'trip_match', 'hello traveler') $$,
  '42501',
  null,
  'and never messages a traveler first, which is the whole anti-spam rule'
);
select throws_ok(
  $$ insert into public.verification_requests (user_id, storage_path)
     values ('00000000-0000-0000-0000-0000000000b1', 'x/y.jpg') $$,
  '42501',
  null,
  'and never takes the traveler selfie check, which proves a face'
);
select throws_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position)
     values ('00000000-0000-0000-0000-0000000000b1', 'x/y.jpg', 0) $$,
  '42501',
  null,
  'and has no personal photos'
);
-- Not even its own room: a business moderates through business_staff, which
-- is a different relationship with no expiry.
select throws_ok(
  $$ insert into public.room_members (chat_id, user_id, departure_date, expires_at)
     values ((select chat_id from public.businesses where name = 'Home Lisbon Hostel'),
             '00000000-0000-0000-0000-0000000000b1', current_date + 3, now() + interval '6 days') $$,
  '42501',
  null,
  'and joins no rooms, not even the one it runs'
);

-- ITS OWN ROOM -------------------------------------------------------------

-- The owner is not a business_staff row, so without the owner arm in
-- my_chats a business would open Chats and find the room it runs missing.
select is(
  (select count(*)::int from public.my_chats()
    where title = 'Home Lisbon Hostel'),
  1,
  'but the owner still finds its own room in Chats'
);

select * from finish();
rollback;
