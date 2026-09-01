-- A DAILY BOOKKEEPING WRITE TURNED profiles.updated_at INTO A PRESENCE FEED
--
-- 20260902210000 added `touch_last_seen()` for the liquidity number, and
-- argued its own safety carefully: `last_seen_on` is a DATE, not a timestamp,
-- it is left out of the client select grant, and no view exposes it. Every
-- one of those statements is true, and together they are not enough.
--
-- `touch_last_seen()` is an UPDATE on public.profiles. profiles carries a
-- BEFORE UPDATE trigger (20260816190000:175) that stamps
-- `new.updated_at := now()` - a full timestamptz - and `updated_at` IS in the
-- client select grant (:353-357), behind `profiles_select_visible`, whose
-- predicate is only "the account is active".
--
-- So: Ana opens the app at 07:12. The function fires once (the
-- `last_seen_on < current_date` guard makes it exactly once a day) and the
-- trigger writes updated_at = 07:12:41. Any signed-in account can then ask
--
--   select user_id, display_name, updated_at from profiles
--    order by updated_at desc limit 1000
--
-- and read back every active traveler ranked by when they last opened the
-- app, to the second. Before this, updated_at moved only when somebody
-- EDITED their profile, which is a fact about the profile. Afterwards it is a
-- fact about the person's day, in bulk, to anybody with an account - the
-- presence signal hard rule 2 and the design brief both ban by name, arrived
-- at sideways through a column nobody was looking at.
--
-- THE FIX: the stamp is for edits, so it fires only on an edit. `WHEN` on the
-- trigger, evaluated per row before the function runs, so a write that
-- changes nothing but last_seen_on leaves updated_at exactly where it was.
-- `touch_last_seen()` is the only writer of last_seen_on in the schema
-- (grep: this migration and 20260902210000 are the only files that name it in
-- a SET), and it changes nothing else, so no real profile edit loses its
-- stamp.
--
-- `is not distinct from` rather than `=`, because last_seen_on starts NULL
-- and `null = null` is null, which a WHEN reads as false - the first touch of
-- a new account would have been the one write that still leaked.

drop trigger profiles_updated_at on public.profiles;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  when (new.last_seen_on is not distinct from old.last_seen_on)
  execute function public.set_updated_at();

comment on column public.profiles.updated_at is
  'When this profile was last EDITED. Deliberately not touched by '
  'touch_last_seen(): updated_at is client-readable for every visible '
  'account, so a daily bookkeeping write would make it a bulk-readable '
  'record of when each traveler last opened the app. See '
  '20260902220000.';
