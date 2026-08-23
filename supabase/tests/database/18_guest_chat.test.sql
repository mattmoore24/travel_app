-- Guests can chat, and can do nothing else.
--
-- Anonymous sign-in makes a guest an ordinary `authenticated` user, which is
-- exactly why this suite is mostly a list of refusals: everything works for
-- them by default, so every boundary has to be a deliberate one that is
-- proved here rather than assumed.
begin;
select plan(34);

insert into auth.users (id, email, is_anonymous) values
  -- A member, who runs a group and invites people to it.
  ('00000000-0000-0000-0000-00000000aa01', 'ana@example.com', false),
  -- Another member, so there is somebody for a guest to try to reach.
  ('00000000-0000-0000-0000-00000000bb01', 'bo@example.com', false),
  -- Two guests. gg02 is the one that goes stale.
  ('00000000-0000-0000-0000-00000000ee01', null, true),
  ('00000000-0000-0000-0000-00000000ee02', null, true);

update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now()
where user_id in ('00000000-0000-0000-0000-00000000aa01',
                  '00000000-0000-0000-0000-00000000bb01');

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

create function pg_temp.ana() returns uuid language sql as
  $$ select '00000000-0000-0000-0000-00000000aa01'::uuid $$;
create function pg_temp.gus() returns uuid language sql as
  $$ select '00000000-0000-0000-0000-00000000ee01'::uuid $$;
create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;


-- 1. Where guest-ness comes from -------------------------------------------------

select pg_temp.admin();
select ok(
  public.is_guest_account(pg_temp.gus()),
  'an anonymous sign-in lands as a guest');
select ok(
  not public.is_guest_account(pg_temp.ana()),
  'and an ordinary one does not');


-- 2. A name, and nothing more ----------------------------------------------------

select pg_temp.login(pg_temp.gus());
select is(public.set_guest_name('  Sam  '), 'Sam', 'a guest names themselves, trimmed');
select is(
  (select display_name from public.profiles where user_id = pg_temp.gus()),
  'Sam',
  'and it lands on their profile');
select is(public.set_guest_name('Sammy'), 'Sammy', 'and can change their mind later');
select throws_ok(
  $$ select public.set_guest_name('   ') $$,
  '23514', null,
  'but cannot be nameless');

select pg_temp.login(pg_temp.ana());
select throws_ok(
  $$ select public.set_guest_name('Ana') $$,
  '23514', null,
  'and a member does not use the guest door');

-- THE load-bearing one. Every discovery surface keys on this stamp, and it
-- sits in the client's own UPDATE grant, so without the trigger a guest
-- could type a name and make themselves browsable.
select pg_temp.login(pg_temp.gus());
select throws_ok(
  $$ update public.profiles set onboarding_completed_at = now()
     where user_id = '00000000-0000-0000-0000-00000000ee01' $$,
  '23514', null,
  'a guest cannot stamp themselves onboarded');
select throws_ok(
  $$ update public.profiles set bio = 'hello'
     where user_id = '00000000-0000-0000-0000-00000000ee01' $$,
  '23514', null,
  'nor write a bio');
select throws_ok(
  $$ update public.profiles set age = 30
     where user_id = '00000000-0000-0000-0000-00000000ee01' $$,
  '23514', null,
  'nor an age, which is what the gendered audiences filter on');


-- 3. Never in front of a stranger -------------------------------------------------

select throws_ok(
  format($$ insert into public.trips (user_id, city_id, start_date, end_date)
            values (%L, %s, current_date, current_date + 5) $$,
         pg_temp.gus(), pg_temp.lisbon()),
  '23514', null,
  'a guest posts no trips');

select pg_temp.admin();
insert into public.launch_cities (city_id, active) values (pg_temp.lisbon(), true)
  on conflict (city_id) do update set active = true;
select pg_temp.login(pg_temp.gus());
select throws_ok(
  format($$ insert into public.pins
              (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at)
            values (%L, %s, 'a bar', 'bar', 38.72, -9.14, current_date,
                    now() + interval '20 hours') $$,
         pg_temp.gus(), pg_temp.lisbon()),
  '23514', null,
  'and drops no pins');
select throws_ok(
  format($$ insert into public.profile_photos (user_id, storage_path, position)
            values (%L, %L, 0) $$, pg_temp.gus(), pg_temp.gus() || '/1.jpg'),
  '23514', null,
  'and uploads no photos');

-- These two are guarded at the TABLE, and the table is the only place a
-- guard would hold: both are written by SECURITY DEFINER functions, which
-- run as the owner and sail straight past the missing client grant. So the
-- assertions come in pairs - the RPC a guest could actually call refuses
-- them, and the privileged insert underneath it refuses them too.
select throws_ok(
  $$ select public.send_message_request(
       '00000000-0000-0000-0000-00000000bb01', 'trip_match', 'hello there you') $$,
  'recipient unavailable',
  'the say-hi RPC turns a guest away');
select pg_temp.admin();
select throws_ok(
  format($$ insert into public.message_requests
              (sender_id, recipient_id, source, first_message)
            values (%L, '00000000-0000-0000-0000-00000000bb01', 'trip_match', 'hello') $$,
         pg_temp.gus()),
  '23514', null,
  'and so does the table, for a caller that got past it');
select throws_ok(
  format($$ insert into public.verification_requests (user_id, storage_path)
            values (%L, %L) $$, pg_temp.gus(), pg_temp.gus() || '/selfie.jpg'),
  '23514', null,
  'and no badge is minted for somebody with no profile to check it against');
select pg_temp.login(pg_temp.gus());

-- The consequence all of that exists for. Ana is in Lisbon this week; if a
-- guest could reach any discovery surface, this is where they would surface.
select pg_temp.admin();
insert into public.trips (user_id, city_id, start_date, end_date)
values (pg_temp.ana(), pg_temp.lisbon(), current_date, current_date + 10),
       ('00000000-0000-0000-0000-00000000bb01', pg_temp.lisbon(),
        current_date, current_date + 10);
select pg_temp.login(pg_temp.ana());
select ok(
  pg_temp.gus() not in (select user_id from public.get_matches()),
  'so no guest is ever in the Travelers queue');
select ok(
  '00000000-0000-0000-0000-00000000bb01' in (select user_id from public.get_matches()),
  'while the member sitting beside them still is');


-- 4. What a guest is actually for --------------------------------------------------

select pg_temp.login(pg_temp.ana());
select lives_ok(
  $$ select public.create_group('Dorm 4 crew', (current_date + 30)::date) $$,
  'a member starts a group');

create function pg_temp.crew() returns uuid language sql as
  $$ select chat_id from public.groups where name = 'Dorm 4 crew' $$;

select set_config('test.token',
  (select public.group_invite_token(pg_temp.crew())), false);

select pg_temp.login(pg_temp.gus());
select is(
  (select (public.group_invite_preview(current_setting('test.token'))).name),
  'Dorm 4 crew',
  'a guest holding the link sees what it is');
select lives_ok(
  format($$ select public.join_group_with_invite(%L, (current_date + 5)::date) $$,
         current_setting('test.token')),
  'and can accept it');
select ok(
  exists (select 1 from public.room_members
          where chat_id = pg_temp.crew() and user_id = pg_temp.gus()),
  'which puts them in the room');
select lives_ok(
  format($$ insert into public.messages (chat_id, sender_id, body)
            values (%L, %L, 'hello, just checked in') $$,
         pg_temp.crew(), pg_temp.gus()),
  'and they can answer it');

-- Their name is what the room sees. Nothing else about them exists.
select is(
  (select display_name from public.profiles where user_id = pg_temp.gus()),
  'Sammy',
  'under the name they picked');


-- 5. The ceilings ------------------------------------------------------------------

select throws_ok(
  format($$ insert into public.messages (chat_id, sender_id, body, image_path)
            values (%L, %L, 'look', 'x/y.jpg') $$, pg_temp.crew(), pg_temp.gus()),
  '23514', null,
  'a guest sends no photos, so a free identity never reaches the classifier');

-- Ten rooms is generous for one person and cheap to paper if it were not
-- capped. The eleventh is the assertion.
select pg_temp.admin();
insert into public.chats (id, kind, status)
select gen_random_uuid(), 'room', 'active' from generate_series(1, 10);
insert into public.room_members (chat_id, user_id, departure_date, expires_at)
select c.id, pg_temp.gus(), current_date + 5, now() + interval '5 days'
from (select id from public.chats where kind = 'room' and id <> pg_temp.crew()
      order by id limit 9) c;
select throws_ok(
  format($$ insert into public.room_members (chat_id, user_id, departure_date, expires_at)
            select id, %L, current_date + 5, now() + interval '5 days'
            from public.chats where kind = 'room' and id <> %L
              and id not in (select chat_id from public.room_members where user_id = %L)
            limit 1 $$, pg_temp.gus(), pg_temp.crew(), pg_temp.gus()),
  '23514', null,
  'and cannot be in more than ten chats at once');


-- 6. Becoming a member -------------------------------------------------------------
--
-- The whole reason anonymous auth was the right mechanism. GoTrue clears
-- is_anonymous on the SAME row when an email is added, so this one statement
-- is the entire conversion.

select pg_temp.admin();
update auth.users set is_anonymous = false, email = 'sam@example.com'
where id = pg_temp.gus();

-- No trigger, no stored copy, no window where the two disagree: the flag IS
-- auth.users.is_anonymous, so clearing it converts them in the same
-- statement.
select ok(
  not public.is_guest_account(pg_temp.gus()),
  'adding an email turns a guest into a member');
select ok(
  exists (select 1 from public.room_members
          where chat_id = pg_temp.crew() and user_id = pg_temp.gus()),
  'and they keep the room they joined');
select ok(
  exists (select 1 from public.messages
          where chat_id = pg_temp.crew() and sender_id = pg_temp.gus()),
  'and what they said in it');
select is(
  (select display_name from public.profiles where user_id = pg_temp.gus()),
  'Sammy',
  'and the name they were known by');

-- And the refusals lift with the flag, in the same statement.
select pg_temp.login(pg_temp.gus());
select lives_ok(
  $$ update public.profiles set onboarding_completed_at = now(), age = 28
     where user_id = '00000000-0000-0000-0000-00000000ee01' $$,
  'a former guest can finish a real profile');


-- 7. The janitor --------------------------------------------------------------------

select pg_temp.admin();
-- gg02 never did anything and arrived a year ago. gg01 is now a member, and
-- members are not the janitor's business at all.
update public.users set created_at = now() - interval '365 days'
where id = '00000000-0000-0000-0000-00000000ee02';

-- The SQL half only NAMES them. Deleting is the guest-janitor worker's job,
-- through the admin API, because SQL cannot be trusted to remove an auth row
-- (see the migration header).
select bag_eq(
  $$ select user_id from public.stale_guest_ids() $$,
  $$ values ('00000000-0000-0000-0000-00000000ee02'::uuid) $$,
  'a guest idle for a month is named for removal, and only them');

-- What the worker then does, and the reason the window is 30 days: it takes
-- their messages with it.
delete from auth.users where id = '00000000-0000-0000-0000-00000000ee02';
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-00000000ee02'),
  0,
  'and removing them cascades the whole way down');
select is(
  (select count(*)::int from public.stale_guest_ids()),
  0,
  'after which a second sweep finds nothing to do');

select * from finish();
rollback;
