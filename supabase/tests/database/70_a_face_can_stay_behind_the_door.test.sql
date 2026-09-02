-- A traveler who said no to the signed-out preview is in none of its rows.
--
-- Written as the attack on 20260903080000. The setting is one nullable
-- column consulted by one predicate in featured_traveler, and the two things
-- that predicate has to get right are the two things easiest to get wrong
-- silently: the DEFAULT (null must read as shown, or the day this lands
-- every guest screen in every city goes empty) and the VIEWER (a signed-in
-- traveler is admitted by the audience pair and this row must not touch
-- them).
--
-- THE FIXTURE MAKES THE OPT-OUT'S ABSENCE VISIBLE. Four eligible travelers
-- for three slots, and the one who opts out (Fay) carries the badge, so
-- without the predicate she is slot ONE, not the fourth row that falls off
-- the end. Every eligible traveler ties on hellos (no message_requests here)
-- and on created_at (one transaction, one clock), so `f.verified desc` is
-- the only key that can lift somebody, exactly the lever 10_rooms_guest_mode
-- uses. Assertion 3 is the control that proves it: before she opts out she
-- IS featured. Measured (2026-09-02): with the D22 clause deleted from
-- featured_traveler, assertions 6 and 8 fail (she is back in slot one for
-- anon and for the guest account) and nothing else in the suite moves. 7,
-- the count, passes either way - four eligible travelers, three slots - and
-- is here for the shape of the answer, not as a check on the predicate. With
-- shown_to_guests taken off the stamp trigger's list instead, 64's two
-- classification assertions fail and nothing here does.
begin;
select plan(14);

insert into auth.users (id, email, is_anonymous) values
  -- A traveler with an account, looking.
  ('00000000-0000-0000-0000-00000000d201', 'ana@example.com', false),
  -- A guest ACCOUNT: anonymous sign-in, no email, no profile to speak of.
  ('00000000-0000-0000-0000-00000000d202', null, true),
  -- Four eligible travelers in Lisbon. Fay (d2f4) is the one who opts out.
  ('00000000-0000-0000-0000-00000000d2f1', 'dan@example.com', false),
  ('00000000-0000-0000-0000-00000000d2f2', 'eve@example.com', false),
  ('00000000-0000-0000-0000-00000000d2f3', 'fin@example.com', false),
  ('00000000-0000-0000-0000-00000000d2f4', 'fay@example.com', false),
  -- A business owner, for the one refusal.
  ('00000000-0000-0000-0000-00000000d2b1', 'hostel@example.com', false);

-- Not the guest: guest_profile_stays_minimal refuses an onboarding stamp on
-- an anonymous account, which is the whole point of that trigger.
update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now()
where user_id in ('00000000-0000-0000-0000-00000000d201',
                  '00000000-0000-0000-0000-00000000d2f1',
                  '00000000-0000-0000-0000-00000000d2f2',
                  '00000000-0000-0000-0000-00000000d2f3',
                  '00000000-0000-0000-0000-00000000d2f4',
                  '00000000-0000-0000-0000-00000000d2b1');

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

create function pg_temp.fay_rows() returns int language sql as
  $$ select count(*)::int from public.featured_traveler(pg_temp.lisbon())
      where user_id = '00000000-0000-0000-0000-00000000d2f4' $$;

insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 1, current_date + 5
from unnest(array[
  '00000000-0000-0000-0000-00000000d2f1',
  '00000000-0000-0000-0000-00000000d2f2',
  '00000000-0000-0000-0000-00000000d2f3',
  '00000000-0000-0000-0000-00000000d2f4']::uuid[]) as u;

insert into public.profile_photos (user_id, storage_path, position, moderation_status) values
  ('00000000-0000-0000-0000-00000000d2f1', 'photos/dan-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-00000000d2f2', 'photos/eve-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-00000000d2f3', 'photos/fin-0.jpg', 0, 'approved'),
  ('00000000-0000-0000-0000-00000000d2f4', 'photos/fay-0.jpg', 0, 'approved');

-- The badge is what puts Fay in slot one. Her audience stays 'everyone', so
-- nothing but the new column can take her off the guest's screen.
update public.profiles set verified = true
 where user_id = '00000000-0000-0000-0000-00000000d2f4';

-- The owner's business, inserted directly so it is listed at once.
insert into public.businesses (city_id, name, category, lat, lng, owner_user_id, state)
values (pg_temp.lisbon(), 'Casa Azul', 'hostel', 38.7108, -9.1400,
        '00000000-0000-0000-0000-00000000d2b1', 'listed');

-- THE DEFAULT IS OPTED IN ----------------------------------------------------

select is(
  (select shown_to_guests from public.profiles
    where user_id = '00000000-0000-0000-0000-00000000d2f4'),
  null,
  'a row nobody has touched carries null'
);
select pg_temp.login('00000000-0000-0000-0000-00000000d2f4');
select is(
  public.my_shown_to_guests(), true,
  'and the client reads null as shown, so nothing changes for anybody who has not opened the row'
);

-- THE CONTROL: before she says no, the badge makes her the lead ---------------
select pg_temp.guest();
select is(
  (select user_id from public.featured_traveler(pg_temp.lisbon()) limit 1),
  '00000000-0000-0000-0000-00000000d2f4',
  'before opting out, Fay is slot one for a signed-out device'
);

-- SHE SAYS NO ----------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000d2f4');
select is(
  public.set_shown_to_guests(false), false,
  'a traveler can turn the signed-out preview off for herself'
);
select is(
  public.my_shown_to_guests(), false,
  'and reads it back'
);

-- A NULL VIEWER NEVER SEES HER -------------------------------------------------
select pg_temp.guest();
select is(
  pg_temp.fay_rows(), 0,
  'an opted-out traveler never leaves featured_traveler for a signed-out device'
);
select is(
  (select count(*)::int from public.featured_traveler(pg_temp.lisbon())),
  3,
  'and the slot she gave up goes to the next traveler, not to a gap'
);

-- NOR A GUEST ACCOUNT, which is the same "no account" from the product's side
select pg_temp.login('00000000-0000-0000-0000-00000000d202');
select is(
  pg_temp.fay_rows(), 0,
  'nor for an anonymous sign-in, which is shown the same preview'
);

-- A SIGNED-IN TRAVELER STILL DOES: this row is about people without an account
select pg_temp.login('00000000-0000-0000-0000-00000000d201');
select is(
  pg_temp.fay_rows(), 1,
  'a traveler with an account still sees her: the audience setting is the rule between two accounts'
);

-- AND IT IS REVERSIBLE: true is honoured as well as null ------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000d2f4');
select public.set_shown_to_guests(true);
select pg_temp.guest();
select is(
  pg_temp.fay_rows(), 1,
  'turning it back on puts her back in front of a signed-out device'
);

-- THE COLUMN HAS NO CLIENT DOOR ----------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000d201');
select throws_ok(
  $$ select shown_to_guests from public.profiles $$,
  '42501',
  null,
  'one traveler''s setting is not a column any client can read'
);
select ok(
  not has_function_privilege('anon', 'public.set_shown_to_guests(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.my_shown_to_guests()', 'execute'),
  'a signed-out device can neither read nor set it'
);
select ok(
  has_function_privilege('authenticated', 'public.set_shown_to_guests(boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.my_shown_to_guests()', 'execute'),
  'and an account can do both, which is the whole client surface'
);

-- A business has no face on this surface and no setting for it (rule 8).
select pg_temp.login('00000000-0000-0000-0000-00000000d2b1');
select throws_ok(
  $$ select public.set_shown_to_guests(false) $$,
  '42501',
  null,
  'a business account cannot set who sees it'
);

select * from finish();
rollback;
