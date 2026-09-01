-- A write the app makes for itself must not become a fact about somebody's day.
--
-- touch_last_seen() stamps a DATE, is left out of the client select grant,
-- and appears in no view. All true, and not enough: it is an UPDATE on
-- profiles, profiles stamps updated_at on every update, and updated_at IS
-- client-readable for every visible account. So the daily write published a
-- to-the-second "last opened the app" for every traveler, in bulk, to anybody
-- with an account.
--
-- This is written as the attack, because the fix is one WHEN clause on a
-- trigger and the next person to touch that trigger will not know why it is
-- there.
--
-- REPAIRED 2026-09-03, AND THE REPAIR IS THE INTERESTING PART. Every
-- assertion below used to compare updated_at against a value captured from
-- the same row a few statements earlier. `now()` is the TRANSACTION's
-- timestamp and a pgTAP file is one transaction, so a stamp written by the
-- trigger is byte-identical to the one captured before the call: "it did not
-- move" and "it was re-stamped this instant" were the same value. The file
-- passed with its own WHEN clause deleted from 20260902220000 - measured, not
-- suspected. It now parks updated_at in 2020 first, with the trigger disabled
-- so that the parking write cannot itself be the thing under test, and asks
-- whether it moved. Do not reintroduce a mark captured from a live row here
-- or in 64_only_an_edit_earns_a_stamp.
--
-- The clause this file guards now lives in 20260903020000, which inverted it:
-- profiles.locale arrived as a second bookkeeping column with the same leak,
-- and the trigger stamps for named EDIT columns rather than skipping named
-- bookkeeping ones. last_seen_on is not in that list, which is why everything
-- below still holds.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'ana@example.com');

create function pg_temp.stamp() returns timestamptz language sql as
  $$ select updated_at from public.profiles
      where user_id = '00000000-0000-0000-0000-0000000000d1' $$;

create function pg_temp.seen() returns date language sql as
  $$ select last_seen_on from public.profiles
      where user_id = '00000000-0000-0000-0000-0000000000d1' $$;

create function pg_temp.park() returns void language plpgsql as $$
begin
  alter table public.profiles disable trigger profiles_updated_at;
  update public.profiles set updated_at = timestamptz '2020-01-01 00:00:00+00'
   where user_id = '00000000-0000-0000-0000-0000000000d1';
  alter table public.profiles enable trigger profiles_updated_at;
end
$$;

create function pg_temp.parked() returns timestamptz language sql immutable as
  $$ select timestamptz '2020-01-01 00:00:00+00' $$;

select pg_temp.park();

update public.profiles
   set display_name = 'Ana', onboarding_completed_at = now()
 where user_id = '00000000-0000-0000-0000-0000000000d1';

-- A real edit still stamps. If this ever fails the fix has gone too far and
-- "when did this profile change" has stopped being answerable.
select is(
  pg_temp.stamp(), now(),
  'an edit to a profile still stamps updated_at'
);

select is(pg_temp.seen(), null, 'and has never opened the app yet');

-- THE FIRST TOUCH, which is the one an `=` comparison would have leaked:
-- last_seen_on starts NULL, and `null = null` is null, which a WHEN reads as
-- false - so the trigger would have fired exactly once per account, on the
-- day it mattered most.
select pg_temp.park();

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d1',
                    'role', 'authenticated')::text, true);

set local role authenticated;
select public.touch_last_seen();
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.seen(), current_date,
  'touching last-seen records the day, which is what the liquidity number reads'
);

select is(
  pg_temp.stamp(), pg_temp.parked(),
  'and does NOT move updated_at, so it publishes nothing about when they opened it'
);

-- The second touch of the same day is a no-op by its own guard; assert it
-- cannot move the stamp either, since that is the path a tab remount takes.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d1',
                    'role', 'authenticated')::text, true);
set local role authenticated;
select public.touch_last_seen();
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.stamp(), pg_temp.parked(),
  'and neither does the second call of the same day'
);

-- And the grant that makes this matter is still what it was: updated_at is
-- readable by a client, which is WHY the write above must not touch it. If
-- this ever fails, re-read the fix - it may have become unnecessary, or the
-- leak may have moved.
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_name = 'profiles' and column_name = 'updated_at'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1,
  'updated_at is still client-readable, which is what made this a leak'
);

select * from finish();
rollback;
