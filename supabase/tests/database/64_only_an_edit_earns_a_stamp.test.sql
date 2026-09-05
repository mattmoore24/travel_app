-- A WRITE THE APP MAKES FOR ITSELF MUST NOT BECOME A FACT ABOUT SOMEBODY'S DAY
-- - and this is the second column to try, one day after the first.
--
-- profiles.locale (20260903010000) is written once per launch by
-- src/lib/device-locale.ts. profiles stamps updated_at on update, and
-- updated_at is client-readable for every visible account, so
-- `select user_id, display_name, updated_at from profiles order by
-- updated_at desc` was a ranking of every active traveler by when they last
-- opened the app - at LAUNCH granularity, where last_seen_on's leak was
-- daily. 20260903020000 inverted the trigger's WHEN clause so it stamps only
-- for columns somebody EDITS, and this file is the attack it has to survive.
--
-- READ THIS BEFORE ADDING AN ASSERTION HERE OR IN 59: `now()` is the
-- TRANSACTION's timestamp, and every pgTAP file is one transaction. So a
-- stamp written by the trigger is byte-identical to one written three
-- statements earlier, and "it did not move" and "it was re-stamped this
-- instant" are the same value. Comparing the two proves nothing: 59 did
-- exactly that and passed with its own guard deleted from the migration
-- (verified 2026-09-03). Every assertion below parks updated_at in 2020
-- first, with the trigger disabled so the parking write cannot itself be the
-- thing under test, and then asks whether it moved.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'noor@example.com');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end
$$;

create function pg_temp.stamp() returns timestamptz language sql as
  $$ select updated_at from public.profiles
      where user_id = '00000000-0000-0000-0000-0000000000e1' $$;

create function pg_temp.tag() returns text language sql as
  $$ select locale from public.profiles
      where user_id = '00000000-0000-0000-0000-0000000000e1' $$;

-- Park updated_at somewhere no `now()` can be mistaken for. The trigger is
-- disabled for this one write so that parking is not itself a test of the
-- guard - otherwise a broken guard would re-stamp the row here and every
-- assertion afterwards would be measuring the wrong thing.
create function pg_temp.park() returns void language plpgsql as $$
begin
  alter table public.profiles disable trigger profiles_updated_at;
  update public.profiles set updated_at = timestamptz '2020-01-01 00:00:00+00'
   where user_id = '00000000-0000-0000-0000-0000000000e1';
  alter table public.profiles enable trigger profiles_updated_at;
end
$$;

create function pg_temp.parked() returns timestamptz language sql immutable as
  $$ select timestamptz '2020-01-01 00:00:00+00' $$;

-- Noor fills in a profile like anybody else, so the row under test is a real
-- one rather than the empty row the signup trigger made.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles
   set display_name = 'Noor', bio = 'hiking + street food',
       onboarding_completed_at = now()
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(pg_temp.tag(), null, 'the account has never told us its language');

-- ---------------------------------------------------------------------------
-- THE ATTACK: the app opens, the client writes the phone's language
-- ---------------------------------------------------------------------------
--
-- This is the FIRST locale write of the account, which is the one that
-- matters: locale starts NULL, and any guard written with `=` reads
-- `null = null` as null and therefore as false, so the first launch of every
-- account would be the one write that still leaked.
select pg_temp.park();
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles set locale = 'th-TH'
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.tag(), 'th-TH',
  'the client can write its phone language, which is what the column is for'
);

select is(
  pg_temp.stamp(), pg_temp.parked(),
  'and that write does NOT move updated_at, so opening the app publishes nothing'
);

-- The second launch of the same process writes the same tag again. Nothing
-- changed, so there is nothing to say about it either.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles set locale = 'th-TH'
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.stamp(), pg_temp.parked(),
  'and neither does the next launch, which writes the same tag again'
);

-- ---------------------------------------------------------------------------
-- AND THE FIX HAS NOT GONE TOO FAR
-- ---------------------------------------------------------------------------
--
-- "When did this profile change" has to stay answerable. If the assertions
-- below ever fail, updated_at has stopped meaning anything.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles set bio = 'hiking, street food, night buses'
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.stamp(), now(),
  'an edit to a profile still stamps updated_at'
);

-- A write that carries BOTH an edited field and a bookkeeping one. This is
-- the case the obvious fix gets wrong: a deny-list clause reading "stamp
-- unless locale changed" is false here, and a real edit loses its stamp
-- because it happened to travel with the phone's language.
select pg_temp.park();
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles set bio = 'hiking, street food, sleeper trains',
                           locale = 'pt-PT'
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.stamp(), now(),
  'an edit that travels with a locale write still stamps'
);

select is(pg_temp.tag(), 'pt-PT', 'and the locale rode along with it');

-- Saving a profile again without changing anything is not an edit. This is
-- what stops a client that PUTs the whole profile on every launch from being
-- the next presence feed all by itself.
select pg_temp.park();
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update public.profiles set bio = 'hiking, street food, sleeper trains',
                           display_name = 'Noor'
 where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.stamp(), pg_temp.parked(),
  're-saving a profile unchanged is not an edit and does not stamp'
);

-- ---------------------------------------------------------------------------
-- EVERY COLUMN ON THE TABLE IS CLASSIFIED, ON PURPOSE
-- ---------------------------------------------------------------------------
--
-- Two columns have now had to be exempted from this trigger one at a time, a
-- day apart, and the person who adds the third will not have read either
-- migration. So the trigger names the columns that ARE an edit and a new
-- column is silent by default, and the two assertions below make "silent by
-- default" a decision somebody records rather than one they make by
-- forgetting: a column added to profiles fails one of them until it appears
-- in the trigger's list or in the bookkeeping list here.
--
-- `\m..\M` are word boundaries, so `age` does not match inside `languages`
-- and `updated_at` does not match inside the trigger's own name.
create function pg_temp.named_in_trigger(p_wanted boolean) returns text[]
language sql stable as $$
  select coalesce(array_agg(c.column_name::text order by c.column_name::text collate "C"), '{}')
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and p_wanted = ((select pg_get_triggerdef(t.oid) from pg_trigger t
                       where t.tgrelid = 'public.profiles'::regclass
                         and t.tgname = 'profiles_updated_at')
                     ~ ('\m' || c.column_name::text || '\M'))
$$;

select is(
  pg_temp.named_in_trigger(true),
  array['age', 'bio', 'display_name', 'gender', 'group_adds', 'home_city',
        'home_country', 'languages', 'occupation', 'onboarding_completed_at',
        'shown_to_guests', 'verification', 'verified', 'visible_to']::text[],
  'these columns are what an edit MEANS, and a change to one of them stamps'
);

select is(
  pg_temp.named_in_trigger(false),
  array['created_at', 'last_seen_on', 'locale', 'travelers_radius_km',
        'updated_at', 'user_id', 'wants_business']::text[],
  'and these are bookkeeping or immutable, so writing one publishes nothing'
);

-- The grant that makes all of the above matter is still what it was. If this
-- ever fails, re-read the fix: it may have become unnecessary, or the leak
-- may have moved somewhere else.
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_name = 'profiles' and column_name = 'updated_at'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1,
  'updated_at is still client-readable, which is what makes this a leak'
);

select * from finish();
rollback;
