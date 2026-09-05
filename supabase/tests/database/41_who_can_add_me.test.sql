-- Being put in a group, and being able to say no to it in advance.
--
-- Written as an attack, because the setting is only worth anything if the
-- DATABASE keeps it: a client that hides the button proves nothing, and
-- add_to_group is callable by any PostgREST caller. The other half is who
-- added you, which must be answerable for your own membership and for nobody
-- else's.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ad01', 'dana@example.com'),
  ('00000000-0000-0000-0000-00000000ad02', 'eli@example.com'),
  ('00000000-0000-0000-0000-00000000ad03', 'fay@example.com');

update public.profiles set
  display_name = 'traveler', age = 25, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();
update public.profiles set display_name = 'Dana'
  where user_id = '00000000-0000-0000-0000-00000000ad01';
update public.profiles set display_name = 'Eli'
  where user_id = '00000000-0000-0000-0000-00000000ad02';

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

create function pg_temp.crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Add crew' $$;

create function pg_temp.first_crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'First crew' $$;

-- Created here, while the suite is still the owner: a definer function made as
-- `authenticated` is a definer function with no privileges.
create function pg_temp.token() returns text language sql
security definer set search_path = public as
  $$ select token from public.group_invites
      where chat_id = pg_temp.first_crew()
      order by created_at desc limit 1 $$;

-- THE DEFAULT ------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ad01');
select is(
  public.my_group_adds()::text,
  'known',
  'a new account can be added by anybody it has chatted with'
);

-- Two groups: one the pair actually meet in, and one to be added to. Sharing
-- a group is what knows_traveler counts, and it is what add_to_group requires.
select lives_ok(
  $$ select public.create_group('First crew', (current_date + 30)::date) $$,
  'and can start a group'
);
select lives_ok(
  $$ select public.group_invite_token(pg_temp.first_crew()) $$,
  'with a link to hand out'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ad02');
select lives_ok(
  $$ select public.join_group_with_invite(pg_temp.token(), (current_date + 5)::date) $$,
  'Eli opens the link, so the two of them now know each other'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ad01');
select lives_ok(
  $$ select public.create_group('Add crew', (current_date + 30)::date) $$,
  'Dana starts a second group'
);

select lives_ok(
  $$ select public.add_to_group(pg_temp.crew(), '00000000-0000-0000-0000-00000000ad02') $$,
  'and can add them to the group while their setting is the default'
);

-- WHO ADDED YOU ----------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ad02');
select is(
  public.who_added_me(pg_temp.crew()),
  'Dana',
  'the person who was added can find out who added them'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ad01');
select is(
  public.who_added_me(pg_temp.crew()),
  null,
  'and the person who did it is told nobody added THEM, because nobody did'
);

-- THE ATTACK: THE SETTING HOLDS AGAINST SOMEBODY WHO GENUINELY KNOWS YOU --------

select pg_temp.login('00000000-0000-0000-0000-00000000ad02');
select lives_ok(
  $$ select public.set_group_adds('link_only') $$,
  'Eli decides they only join groups by link'
);
select is(
  public.my_group_adds()::text,
  'link_only',
  'and the setting sticks'
);

select pg_temp.admin();
select lives_ok(
  $$ delete from public.room_members
      where chat_id = pg_temp.crew()
        and user_id = '00000000-0000-0000-0000-00000000ad02' $$,
  'Eli leaves the group'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ad01');
select throws_ok(
  $$ select public.add_to_group(pg_temp.crew(), '00000000-0000-0000-0000-00000000ad02') $$,
  'They only join groups by invite link.',
  'and the same person who added them before is now refused, however well they know them'
);

-- SOMEBODY WHO DOES NOT KNOW YOU IS REFUSED IN BOTH STATES ---------------------

select pg_temp.login('00000000-0000-0000-0000-00000000ad03');
select throws_ok(
  $$ select public.add_to_group(pg_temp.crew(), '00000000-0000-0000-0000-00000000ad02') $$,
  null,
  'a stranger cannot add the link_only account either'
);

select pg_temp.login('00000000-0000-0000-0000-00000000ad01');
select throws_ok(
  $$ select public.add_to_group(pg_temp.crew(), '00000000-0000-0000-0000-00000000ad03') $$,
  'You can only add people you have chatted with.',
  'and the known-people rule is untouched for an account on the default'
);

-- NOBODY READS ANYBODY ELSE'S SETTING ------------------------------------------
--
-- my_group_adds binds to auth.uid() and the column is granted to no client
-- role, so there is no shape of query that answers it for another person.

select pg_temp.login('00000000-0000-0000-0000-00000000ad03');
select throws_ok(
  $$ select group_adds from public.profiles
      where user_id = '00000000-0000-0000-0000-00000000ad02' $$,
  '42501',
  null,
  'the column itself is not readable by a client at all'
);

select * from finish();
rollback;
