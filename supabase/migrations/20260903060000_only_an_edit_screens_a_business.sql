-- ONLY AN EDIT TO A BUSINESS'S WORDS IS A REASON TO READ THEM AGAIN
--
-- `businesses_screen` (20260827100000:395) fires BEFORE INSERT OR UPDATE on
-- public.businesses with no WHEN clause, and screen_business_text() (current
-- definition 20260901140000_the_rules_have_one_name.sql:126) does two things
-- on every row it sees: runs the blocklist over five text columns, and stamps
-- updated_at = now(). It never asks whether any of the five changed.
--
-- THE ENUMERATION, so it is not re-asked. Every write to public.businesses
-- that is not an owner editing text, from `grep -n "update public.businesses"
-- supabase/migrations`, plus the one client path:
--
--   confirm_business_email          state, listed_at      (20260827160000:566)
--   apply_business_verification_verdict  verified_at     (20260903010000:115)
--   admin_resolve_business_verification  verified_at     (20260827160000:246)
--   apply_business_scan_verdict     state, verified_at    (20260827120000:703)
--   admin_resolve_business_report   state, verified_at, active
--                                                          (20260827120000:753-759)
--   update_business_location        lat, lng, city_id, address
--                                                          (20260829160000:218)
--   owner toggling public_preview   the RLS update path; the column is in
--                                   the client's UPDATE grant and is a switch,
--                                   not a sentence
--   businesses_rename_resets        the sibling BEFORE UPDATE trigger. Not a
--                                   write of its own: it amends NEW in the
--                                   same statement, and its body is already
--                                   guarded top to bottom by "did the name,
--                                   the city or the marker move".
--   no cron writes this table, and no counter lives on it: photos are rows
--   in business_photos, posts are rows in business_posts.
--
-- WHAT EACH ONE COST, established rather than assumed:
--
--   1. The classifier re-ran. screen_first_message is the regex blocklist,
--      not a model call, so the CPU is small - but the blocklist is a table
--      the founder grows, and a pattern added after a business wrote its
--      description makes every non-text write to that row RAISE 'that text
--      breaks our house rules'. Follow that through the list above and it is
--      not a nuisance: apply_business_scan_verdict's `state = 'flagged'` is
--      the write that takes a plausible IMPERSONATOR off the map, and it
--      would have failed on the impersonator's own year-old bio. The
--      verification verdict would have failed ten times and then failsafe-
--      refused a real business ("We could not process those photos") for a
--      sentence it did not change. An owner flipping public_preview off would
--      have been told their text breaks the rules on a screen with no text
--      on it.
--
--   2. updated_at was stamped. Unlike profiles.updated_at this one is NOT a
--      leak: the column is absent from the client select grant
--      (20260827100000:136-139), no RPC returns it, and no view but the
--      service role's can see it. So it says nothing about the owner's day to
--      anybody who can ask. It was still wrong - "last edited" meant "last
--      touched by anything, including a moderator" - and a column that is
--      not readable today is one grant away from being the profiles leak
--      tomorrow. It goes inside the same guard.
--
-- THE SHAPE is 20260903030000's, not 20260903020000's: the condition lives in
-- the function body, next to the list of columns it screens, rather than in
-- a WHEN clause upstairs. screen_business_text already owns the list of five
-- columns; a WHEN clause would be a second copy of that list, and the two
-- drift in the direction that fails OPEN - whoever adds a sixth screened
-- column to the concat_ws adds it to the body and the WHEN silently stops
-- the screen from running for an edit to that column alone.
--
-- The INSERT branch is unchanged: a new row's words have never been read.
-- 68_only_an_edit_screens_a_business fails with the guard removed, on both
-- halves.

create or replace function public.screen_business_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edited boolean;
begin
  -- Two branches rather than one OR. Not because reading OLD on INSERT
  -- raises: on Postgres 11 and later it is NULL and does not (measured on
  -- 16.13; the "unassigned record" rule this table's neighbours cite is
  -- pre-11 behaviour). With OLD all null, the row-wise comparison below
  -- would come out "distinct" and mark every insert an edit, which is the
  -- right answer arrived at by accident. The branch says it on purpose.
  if tg_op = 'INSERT' then
    v_edited := true;
  else
    -- Row-wise IS DISTINCT FROM: null-safe per field, so the first time an
    -- owner writes a description over NULL still counts as the edit it is.
    v_edited := (new.name, new.description, new.place_label, new.hours_note, new.address)
      is distinct from
      (old.name, old.description, old.place_label, old.hours_note, old.address);
  end if;

  -- NOTHING PERSISTENT HAPPENS OUTSIDE THIS BRANCH. A verdict, a listing
  -- state change, a marker move or a switch flipped is not an edit to the
  -- words, so the words are not read again and the edit stamp does not move.
  if v_edited then
    if (public.screen_first_message(
          concat_ws(' ', new.name, new.description, new.place_label, new.hours_note, new.address)
        ) ->> 'action') = 'block' then
      raise exception 'that text breaks our house rules'
        using errcode = 'check_violation', hint = 'guidelines';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

revoke execute on function public.screen_business_text() from public, anon, authenticated;

comment on function public.screen_business_text() is
  'Screens a business''s five free-text columns and stamps updated_at, and '
  'does both ONLY when one of those columns changed (or on insert). Until '
  '20260903060000 it ran on every write to the row, so a moderator''s verdict '
  'or a flip of public_preview re-read words that had not changed and could be '
  'refused by a blocklist pattern added since - which would have stopped '
  'apply_business_scan_verdict from taking an impersonator down.';

comment on column public.businesses.updated_at is
  'When the business''s own words were last EDITED, and only that. Not in the '
  'client select grant and returned by no RPC; kept honest anyway, because a '
  'column nobody can read today is one grant away from being '
  'profiles.updated_at''s leak (20260903020000). See 20260903060000.';
