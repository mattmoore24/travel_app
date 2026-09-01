-- OPENING THE APP IS NOT A PROFILE EDIT, AND IT MUST NOT BE ABLE TO LOCK
-- SOMEBODY OUT OF THEIR OWN PROFILE.
--
-- `profiles_screen_text` (20260817150000:210) is a BEFORE UPDATE trigger with
-- no WHEN clause, and until 20260903030000 the first two statements of
-- `screen_profile_text()` ran on EVERY update of the row, before it had looked
-- at whether any text changed: it raised once thirty
-- (entity_type='profile', action='updated') moderation_events rows existed for
-- the account in 24 hours, and then filed one more of exactly those rows,
-- carrying created_at = now().
--
-- The client writes profiles once per cold start (src/lib/device-locale.ts,
-- from use-auth-listener's SIGNED_IN / INITIAL_SESSION) and once a day
-- (touch_last_seen). Neither is an edit. So thirty cold starts in a day spent
-- a safety rate limit that has nothing to do with them, and from the
-- thirty-first the account could not update its own profile AT ALL - not
-- onboarding_completed_at, which is the single fact that makes somebody
-- discoverable, not set_visibility, not a moderator's verification verdict.
--
-- This file is that attack. The counterpart it must not break is that a real
-- text edit still costs a unit, still files a row, and still caps at thirty.
--
-- WHY THIS FILE COUNTS ROWS RATHER THAN TIMESTAMPS. `now()` is the
-- TRANSACTION's timestamp and a pgTAP file is one transaction, so anything
-- compared against `now()` here compares `now()` with `now()` - the trap that
-- made 59_bookkeeping_is_not_presence pass with its own guard deleted. There
-- is nothing to park here: the quantity under test is how many audit rows
-- exist, which is a count, and a count cannot be mistaken for itself.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'sofia@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'yuki@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'marco@example.com');

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

-- The rows the cap counts, for one account. Read as the superuser: this table
-- is revoked from anon and authenticated and carries no client policy, which
-- is asserted at the bottom of this file.
create function pg_temp.filed(uid uuid) returns int language sql as $$
  select count(*)::int from public.moderation_events
   where subject_user_id = uid
     and entity_type = 'profile' and action = 'updated'
$$;

-- One cold start, n times, SWALLOWING a refusal exactly the way the client
-- does - writeDeviceLocale catches its own error and lets the next launch try
-- again - and returning how many were refused.
--
-- This is not politeness. A loop that lets the raise out would abort the whole
-- pgTAP transaction at launch thirty-one, and the assertions after it would
-- never run: the lockout would show up as a file that died rather than as the
-- two named things it actually breaks. Swallowing per launch leaves the thirty
-- audit rows behind, which is the state the account is really in when it next
-- tries to save its profile.
create function pg_temp.launch(uid uuid, n int) returns int language plpgsql as $$
declare
  v_refused int := 0;
begin
  for i in 1..n loop
    begin
      update public.profiles set locale = 'ja-JP' where user_id = uid;
    exception when others then
      v_refused := v_refused + 1;
    end;
  end loop;
  return v_refused;
end
$$;

-- ---------------------------------------------------------------------------
-- WHAT A WRITE COSTS: SOFIA
-- ---------------------------------------------------------------------------

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 0,
  'a brand new account has filed no moderation row');

-- THE ATTACK. The app opens and the client writes the phone's language. This
-- is not an edit, nobody typed it, and the person is not even looking at their
-- profile.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.profiles set locale = 'th-TH'
 where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 0,
  'opening the app files no moderation row and spends no unit of the cap');

-- The other bookkeeping write on this table, for the same reason.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.touch_last_seen();
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 0,
  'and neither does the once-a-day liquidity tick');

-- AND THE GUARD HAS NOT GONE TOO FAR. An edit to the text this function exists
-- to screen still costs exactly what it always did.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.profiles set display_name = 'Sofia'
 where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 1,
  'a display name edit still files exactly one row, which is what the cap counts');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.profiles set bio = 'hiking + night buses'
 where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 2,
  'and so does a bio edit');

-- Saving the same text again is not an edit. This is what stops a client that
-- PUTs the whole profile on every launch from spending the cap by itself.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.profiles set display_name = 'Sofia', bio = 'hiking + night buses'
 where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a1'), 2,
  're-saving the same text is not an edit and files nothing');

-- ---------------------------------------------------------------------------
-- THE LOCKOUT: YUKI HAS OPENED THE APP FIFTY TIMES TODAY
-- ---------------------------------------------------------------------------
--
-- Fifty is a bad travel day on a flaky connection, not abuse. Under the old
-- function the thirty-first of these raised, and everything after it - every
-- write to this person's own profile - raised with it.

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(
  pg_temp.launch('00000000-0000-0000-0000-0000000000a2', 50), 0,
  'fifty cold starts in one day are fifty writes to profiles and not one is refused'
);

-- The write that makes somebody discoverable at all. If this raises, the
-- account is a ghost: it exists, it cannot be seen, and nothing it does can
-- change that until tomorrow.
select lives_ok(
  $$ update public.profiles
        set display_name = 'Yuki', age = 29, home_country = 'JP',
            languages = array['ja', 'en'], onboarding_completed_at = now()
      where user_id = '00000000-0000-0000-0000-0000000000a2' $$,
  'and the account can still finish onboarding afterwards'
);
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a2'), 1,
  'with the fifty launches costing nothing and the one edit costing one');

-- ---------------------------------------------------------------------------
-- THE CAP STILL CAPS: MARCO EDITS HIS NAME ALL DAY
-- ---------------------------------------------------------------------------
--
-- The cap is the reason the audit row exists, and narrowing what spends it
-- must not stop it working on what it was written for.

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ do $edits$
     begin
       for i in 1..30 loop
         update public.profiles set display_name = 'Marco ' || i
          where user_id = '00000000-0000-0000-0000-0000000000a3';
       end loop;
     end
     $edits$ $$,
  'thirty text edits in twenty-four hours are allowed'
);

select throws_ok(
  $$ update public.profiles set display_name = 'Marco again'
      where user_id = '00000000-0000-0000-0000-0000000000a3' $$,
  '23514',
  'daily profile update limit reached',
  'and the thirty-first is refused: the cap still caps'
);

-- ...and being capped on TEXT does not lock the account out of the writes the
-- app makes for itself. This is the half that turns a rate limit into a
-- lockout when the two are counted together.
select lives_ok(
  $$ update public.profiles set locale = 'it-IT'
      where user_id = '00000000-0000-0000-0000-0000000000a3' $$,
  'while a capped account can still be opened, because a launch is not an edit'
);
select pg_temp.admin();

select is(pg_temp.filed('00000000-0000-0000-0000-0000000000a3'), 30,
  'and the refused edit and the launch after it filed nothing');

-- ---------------------------------------------------------------------------
-- WHO CAN READ THE THING THIS TRIGGER WRITES
-- ---------------------------------------------------------------------------
--
-- Established rather than assumed, because it decides how bad the audit row
-- was: moderation_events has RLS on with no client policy and is revoked from
-- both client roles, so the per-launch record was server-side only and never
-- the bulk-readable presence feed 20260903020000 closed. If this ever fails,
-- every row this trigger files becomes a §7 rule 2 problem as well.

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select count(*) from public.moderation_events $$,
  '42501',
  null,
  'and no client can read the audit trail this trigger writes into'
);
select pg_temp.admin();

-- ---------------------------------------------------------------------------
-- EVERY TRIGGER ON THE TABLE, NAMED
-- ---------------------------------------------------------------------------
--
-- Two columns and then a second trigger have each had to be discovered
-- separately, a day apart, by somebody re-asking the same question. This is
-- the list, so a fifth trigger fails a test until whoever adds it has answered
-- "what does a write that is not an edit cost here?" - the same job
-- 64_only_an_edit_earns_a_stamp does for a new COLUMN. The answers as of
-- 20260903030000 are in that migration's header; the two unlisted here are
-- safe for reasons written down there, not by luck.

select is(
  (select array_agg(t.tgname::text order by t.tgname::text collate "C")
     from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal),
  array['profiles_guest_minimal', 'profiles_reset_visibility',
        'profiles_screen_text', 'profiles_updated_at']::text[],
  'these are all the triggers on profiles, and a new one has to be classified'
);

select * from finish();
rollback;
