-- THE SAME LAUNCH WRITE, THE OTHER TRIGGER - AND THIS ONE LOCKS PEOPLE OUT.
--
-- 20260903020000 asked what a BEFORE UPDATE trigger on profiles stamps on a
-- client-readable column, and answered it for `profiles_updated_at`. It asked
-- that of ONE of the four triggers on the table. `profiles_screen_text`
-- (20260817150000:210) is attached with no `when` clause, and the first two
-- statements of `screen_profile_text()`
-- (current definition: 20260901140000_the_rules_have_one_name.sql:45) run on
-- EVERY update of the row, before the function has looked at whether any text
-- changed:
--
--   1. it raises 'daily profile update limit reached' once thirty
--      moderation_events rows with entity_type='profile', action='updated'
--      exist for this account in the last 24 hours;
--   2. it INSERTS one of exactly those rows, carrying created_at = now().
--
-- `writeDeviceLocale` (src/lib/device-locale.ts) fires on every SIGNED_IN and
-- INITIAL_SESSION - once per cold start - and `touch_last_seen()` fires once a
-- day. Neither is an edit and neither is text. Both spend a unit of a safety
-- rate limit and both file an audit row.
--
-- THE LOCKOUT, which is the blocking half. The cap is counted BEFORE the
-- insert and raises for the whole statement, so after thirty cold starts in a
-- day the account cannot update its own profile AT ALL - not the row, not one
-- column. Everything that reaches `update public.profiles` raises:
-- updateOwnProfile, the onboarding_completed_at write that is the single fact
-- making somebody discoverable, set_visibility(), set_group_adds(),
-- set_listing_intent(), the display-name mirror on a business rename, and
-- apply_verification_verdict's write - a moderator's decision failing on a
-- traveler's own launch count. Thirty launches is a bad travel day with a
-- flaky connection, not abuse.
--
-- IS THE AUDIT ROW ITSELF A LEAK? Established rather than assumed, because it
-- decides how bad the second half is: NO. `public.moderation_events` has RLS
-- enabled with no client policy at all, is revoked from `anon` and from
-- `authenticated` (20260816190000:252, :336, :374), and appears in no view or
-- security-definer function a client can call. So the second-granularity
-- record of when each account opened the app is server-side only - it is not
-- the bulk-readable presence feed 20260903020000 closed, and §7 rule 2 is not
-- breached by it. It is still a per-launch behavioural record the product
-- never decided to keep, in the table whose whole purpose is moderation
-- decisions, where "this account was updated 30 times today" now means "this
-- phone was picked up 30 times today". Both halves go.
--
-- ---------------------------------------------------------------------------
-- WHERE THE FIX GOES, AND WHY NOT ON THE TRIGGER
-- ---------------------------------------------------------------------------
--
-- The sibling trigger got a WHEN clause, and the same treatment was available
-- here: `when (new.display_name is distinct from old.display_name or
-- new.bio is distinct from old.bio)`. It is NOT what this migration does, and
-- the reason is that the two cases are not alike.
--
-- `set_updated_at()` has no opinion of its own - the WHEN clause IS the whole
-- logic, and there is nowhere else for it to live. `screen_profile_text()`
-- already contains that exact condition, because it is the condition that
-- decides what gets screened. Putting a copy of it on the trigger creates two
-- lists of screened columns that must agree, and they drift in the dangerous
-- direction: whoever adds `occupation` to the text this function screens will
-- add it to the `if` inside the body, and the WHEN clause upstairs will then
-- silently stop the screen from ever running for an occupation-only edit.
-- That is a moderation control failing OPEN, quietly, and hard rule 5's
-- neighbours are not something to protect with a duplicated list.
--
-- So the cap and the audit row move INSIDE the check that already exists.
-- One condition decides all three things it guards - screen the text, count
-- the edit, file the row - and it cannot drift from itself. A write that
-- edits no text now costs nothing: no count, no insert, no cap.
--
-- Everything else is preserved exactly:
--   - the cap is still checked BEFORE the audit row is filed, so a text edit
--     is refused at the thirty-first rather than the thirty-second;
--   - a BLOCKED edit still files nothing, because the raise aborts the
--     transaction the insert lives in - the same note the body already
--     carries;
--   - the message, the errcode and the `profile_daily_cap` /`guidelines`
--     hints are byte-identical, so src/lib/failure-message.ts needs nothing.
--
-- The cap's own meaning gets narrower and truer. Its author wrote it as text
-- velocity - "the regex pre-filter catches the obvious cases at write time
-- (same blocklist as first messages); update velocity is capped alongside it"
-- (20260817150000:171) - and `screen_profile_text` is the only writer of the
-- rows it counts (grep: no other insert names entity_type='profile' with
-- action='updated'). It was never a general profile-write throttle; it was a
-- text-edit throttle that happened to be counting launches.
--
-- ---------------------------------------------------------------------------
-- EVERY TRIGGER ON public.profiles, BECAUSE THE THIRD MUST NOT COST A ROUND
-- ---------------------------------------------------------------------------
--
-- Two columns and then a second trigger have each had to be found separately.
-- The table carries exactly four triggers. Each is stated here with the
-- question "what does a write that is not an edit cost here?" answered, and
-- 65_only_an_edit_spends_the_cap asserts the list so a fifth cannot arrive
-- unclassified:
--
--   profiles_updated_at      (BEFORE UPDATE, WHEN edited-columns)
--     Stamps a client-readable updated_at. FIXED 20260903020000; the WHEN
--     clause names the columns that ARE an edit.
--
--   profiles_screen_text     (BEFORE UPDATE, no WHEN)
--     This migration. Spent a safety cap and filed a dated audit row on every
--     write, edit or not.
--
--   profiles_reset_visibility (BEFORE UPDATE OF verified)
--     SAFE, twice over. `update of verified` fires only for a statement that
--     NAMES that column, and `verified` is not in the client's update grant
--     (20260816190000:350) so no client statement can name it. The body then
--     no-ops unless verified actually went true -> false, and its only effect
--     is on the row's own visible_to - a real consequence of losing a badge,
--     not bookkeeping.
--
--   profiles_guest_minimal   (BEFORE UPDATE, no WHEN)
--     SAFE, but for a weaker reason worth writing down: it does run in full on
--     every update, and it is only harmless because it is a pure assertion. It
--     writes no row, stamps no column, keeps no counter, and reads only NEW -
--     which for a bookkeeping write is unchanged from OLD, so a guest whose
--     row is already minimal passes it every time. If anybody ever gives it a
--     counter, a stamp or an insert, it becomes this migration again.
--
-- The rule the next person needs, in one line: a BEFORE UPDATE trigger on
-- profiles must either be scoped to the columns it cares about, or do nothing
-- persistent until it has established that one of them changed.

create or replace function public.screen_profile_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verdict jsonb;
begin
  -- NOTHING PERSISTENT HAPPENS OUTSIDE THIS BRANCH. profiles is written by
  -- the app for its own bookkeeping - the phone's language once per launch,
  -- last_seen_on once a day, the business listing flag - and none of those is
  -- an edit to screen, an edit to count, or an edit to file.
  if new.display_name is distinct from old.display_name
     or new.bio is distinct from old.bio then

    -- Text-edit velocity. Counted before the row below is filed, so the
    -- thirty-first edit in 24 hours is the one refused.
    if (select count(*) from public.moderation_events
        where subject_user_id = new.user_id
          and entity_type = 'profile' and action = 'updated'
          and created_at > now() - interval '24 hours') >= 30 then
      raise exception 'daily profile update limit reached'
        using errcode = 'check_violation', hint = 'profile_daily_cap';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source)
    values (new.user_id, 'profile', new.user_id, 'updated', 'rate-limit');

    v_verdict := public.screen_first_message(
      coalesce(new.display_name, '') || ' ' || coalesce(new.bio, ''));
    if v_verdict ->> 'action' = 'block' then
      -- No audit row survives here: the raise aborts this transaction, so the
      -- insert above is rolled back with it and a refused edit spends no cap.
      -- The enforcement is the rejection itself - the text never goes public.
      -- (LLM-grade bio review stays a flagged follow-up in ARCHITECTURE.)
      raise exception 'that text breaks our house rules'
        using errcode = 'check_violation', hint = 'guidelines';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.screen_profile_text() from public, anon, authenticated;

comment on function public.screen_profile_text() is
  'Screens display_name and bio on update, and caps TEXT EDITS at thirty per '
  '24 hours. Everything it does - the count, the moderation_events row and '
  'the screen itself - is inside one check that display_name or bio actually '
  'changed. It ran the cap and the insert unconditionally until 20260903030000, '
  'which meant a once-per-launch bookkeeping write spent a safety cap and '
  'filed a dated audit row, and thirty cold starts in a day locked an account '
  'out of every write to its own profile. A trigger on profiles does nothing '
  'persistent until it knows an edited column moved.';
