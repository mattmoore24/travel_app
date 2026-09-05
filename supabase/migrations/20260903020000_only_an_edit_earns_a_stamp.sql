-- THE SAME LEAK, ONE COLUMN AND ONE DAY LATER
--
-- 20260902220000 closed a presence feed: touch_last_seen() wrote a DATE to an
-- ungranted column, that write tripped profiles' BEFORE UPDATE trigger, the
-- trigger stamps `updated_at = now()` - a full timestamptz - and updated_at
-- IS in the client select grant (20260816190000:353-357) behind
-- profiles_select_visible, whose only predicate is that the account is
-- active. So
--
--   select user_id, display_name, updated_at from profiles
--    order by updated_at desc limit 1000
--
-- came back as every active traveler ranked by when they last opened the app.
--
-- 20260903010000 added profiles.locale, and src/lib/device-locale.ts writes
-- it from src/features/auth/use-auth-listener.ts on SIGNED_IN and
-- INITIAL_SESSION: once per launch. Same table, same trigger, same granted
-- column, same query. The only thing that changed is that it is now WORSE
-- than the leak that was closed yesterday - last_seen_on's own
-- `last_seen_on < current_date` guard held the write to once a day, and this
-- one has no such guard, so the ranking refreshes at LAUNCH granularity
-- instead of daily.
--
-- THE CLIENT CANNOT FIX IT. The obvious answer is "don't write a value that
-- has not changed", and locale is deliberately not in any select grant
-- (20260903010000: a granted column would hand every traveler who can see you
-- your phone's language along with your bio), so the client has nothing to
-- compare against. The guard has to be on the trigger.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE, WHICH IS THE POINT OF THIS MIGRATION
-- ---------------------------------------------------------------------------
--
-- THE OBVIOUS ONE-LINE FIX DOES NOT WORK, and that is the first reason this
-- migration is a different shape rather than one more exception. Adding
-- `and new.locale is not distinct from old.locale` to yesterday's WHEN clause
-- looks like the same fix in one line. It is not a smaller version of this
-- one; it does not close the leak at all after the first launch.
--
-- Follow one account. Launch one writes 'th-TH' over a NULL, the clause reads
-- "locale changed", the WHEN is false and nothing is stamped - so the one-line
-- fix appears to work. Launch two writes 'th-TH' again over 'th-TH'. The
-- client has no way not to: it re-reads the phone's tag every cold start and
-- has no readable copy of what it last wrote (locale carries no select grant).
-- So the clause reads "locale is unchanged", the WHEN passes, and updated_at
-- is stamped with now() - exactly as it was before the fix, on every launch
-- from the second onward. A deny-list on a value cannot suppress a write that
-- rewrites the same value, and a once-per-launch write is almost always
-- rewriting the same value. It would have suppressed only the rare launch
-- after somebody changed their phone's language.
--
-- MEASURED, NOT REASONED - the deny-list clause was written into this trigger
-- and the suite was run. 64_only_an_edit_earns_a_stamp's assertion 'and
-- neither does the next launch, which writes the same tag again' IS that
-- second launch, and it fails under the one-liner: the stamp moves off 2020
-- to now(). The deny-list fails 'an edit that travels with a locale write
-- still stamps' too, for the opposite reason. docs/ARCHITECTURE.md records
-- the same finding in the same words.
--
-- The second reason is the one that outlives this column. Two columns added to
-- a deny-list one at a time, a day apart, say plainly what happens to the
-- third: whoever adds the next bookkeeping column to profiles has to know
-- about a trigger three migrations away, and the cost of not knowing is a
-- privacy leak that no test they wrote will catch.
--
-- So the clause is INVERTED. It no longer says which columns are not an edit;
-- it says which columns ARE one, and stamps only when one of those changed.
-- A column added tomorrow is, by default, not in that list, so by default it
-- does not stamp and does not publish anything. Forgetting now costs a stale
-- timestamp on a column nothing in the app reads (grep: `updated_at` is
-- selected as part of PROFILE_COLUMNS in src/lib/database.types.ts and its
-- VALUE is read by no screen and no test fixture that asserts on it), where
-- forgetting before cost a bulk-readable record of when each traveler opened
-- the app. That asymmetry is the whole argument: both shapes need
-- maintenance, and only one of them fails safe when it does not get it.
--
-- The deny-list also fails in the other direction, and there it is a plain bug
-- rather than a leak: `when (locale unchanged and last_seen unchanged)` is
-- false for a write that changes a bio AND the locale, so a real edit riding
-- along with a bookkeeping column would silently lose its stamp. Nothing does
-- that today - the client's locale write is locale-only - but the next person
-- to batch two writes into one round trip would have got it for free. The
-- inverted clause is true whenever an edited column moved, whatever else moved
-- with it. 64_only_an_edit_earns_a_stamp asserts exactly that case.
--
-- `is distinct from` rather than `<>`, for the reason yesterday's fix gives
-- inverted: bio, age, home_city and most of this list start NULL, and
-- `null <> 'hiking'` is null, which a WHEN reads as false - so the FIRST time
-- anybody wrote a bio, the one edit that most deserves a stamp, would not
-- have got one. Row-wise `IS DISTINCT FROM` is null-safe per field
-- (Postgres 9.24.5, composite type comparison).
--
-- WHAT THE LIST MEANS. A column is on it when a change to it is a fact about
-- the PROFILE - something the person or a moderator decided. It is off it
-- when the app wrote it for its own bookkeeping:
--
--   last_seen_on  the liquidity number's daily tick (20260902210000)
--   locale        the phone's language, once per launch (20260903010000)
--   wants_business  where somebody is in the business listing flow; its own
--                   column comment calls it server-owned, it carries no grant
--                   in either direction, and "started listing a bar at 14:02"
--                   is not something updated_at should be publishing either
--   created_at, user_id  never change
--   updated_at    the stamp itself
--
-- WHAT WOULD END THIS CLASS OF BUG ENTIRELY, and why it is not this
-- migration: revoke select (updated_at) on profiles from authenticated. The
-- trigger only has to be careful because the column is bulk-readable, and
-- nothing in the app reads its value. It cannot be done here because
-- PROFILE_COLUMNS names updated_at in every profile query the currently
-- installed builds make, and Postgres refuses a select listing a column the
-- role cannot read - so revoking it would answer every profile screen on
-- every phone in the wild with `permission denied` the moment the migration
-- deployed. The order is: drop it from PROFILE_COLUMNS, ship that, let it
-- reach the builds, then revoke. Recorded in docs/ARCHITECTURE.md so the
-- third bookkeeping column has somewhere to go besides this list.

drop trigger profiles_updated_at on public.profiles;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  when (
    (new.display_name, new.age, new.home_city, new.home_country,
     new.occupation, new.languages, new.bio, new.gender,
     new.verified, new.verification, new.visible_to, new.group_adds,
     new.onboarding_completed_at)
    is distinct from
    (old.display_name, old.age, old.home_city, old.home_country,
     old.occupation, old.languages, old.bio, old.gender,
     old.verified, old.verification, old.visible_to, old.group_adds,
     old.onboarding_completed_at)
  )
  execute function public.set_updated_at();

comment on column public.profiles.updated_at is
  'When this profile was last EDITED, and only that. updated_at is '
  'client-readable for every visible account, so any write the app makes for '
  'its own bookkeeping - touch_last_seen(), the once-per-launch locale write, '
  'the business listing flag - would otherwise publish a bulk-readable record '
  'of when each traveler last opened the app. The trigger stamps only when a '
  'column somebody EDITED changed; a new column is not an edit unless it is '
  'added to that list on purpose. See 20260903020000.';
