-- A PIN YOU CAN TAKE DOWN.
--
-- Deleting your own pin has returned 403 since 2026-08-31. Found on 2026-09-08
-- by a demo re-seed, not by a test and not by a person, which is its own
-- finding: nothing in the suite deletes a pin as its owner.
--
-- THE CHAIN. 20260831180000 added a BEFORE DELETE trigger on public.pins so a
-- group card keeps saying "burned out" after expire_pins hard-deletes the row
-- underneath it:
--
--   create function public.groups_remember_the_plan_ended()
--   returns trigger language plpgsql as $$          <- no SECURITY DEFINER
--   begin
--     update public.groups set plan_ended_at = now()
--      where pin_id = old.id and plan_ended_at is null;
--     return old;
--   end $$;
--
-- SECURITY INVOKER, so the UPDATE runs with the CALLER's rights. And
-- `authenticated` has never held UPDATE on public.groups - 20260821010000:42
-- granted `select` and nothing since has widened it (20260903130000 narrowed
-- that select to column level). Live ACL today: authenticated=m/postgres, which
-- is MAINTAIN alone.
--
-- So the trigger raises 42501 "permission denied for table groups" and takes
-- the DELETE down with it. src/features/pins/api.ts:220 deletes a pin exactly
-- this way, as the signed-in user, so the failure is the product's, not the
-- seeder's: a traveler pressing take-down gets a 403.
--
-- IT FIRES EVEN WHEN THE USER OWNS NO GROUP. Postgres checks the UPDATE
-- privilege when it plans the statement, not after matching rows, so
-- `where pin_id = old.id` finding nothing does not save it. Every pin delete
-- fails, not just pins that belong to a group.
--
-- WHY expire_pins NEVER NOTICED: that runs from pg_cron as postgres, which owns
-- the table. The sweep worked, so pins did disappear on schedule and the only
-- broken path was the one a person presses.
--
-- THE FIX is SECURITY DEFINER, because stamping plan_ended_at is the SERVER's
-- bookkeeping about a row the user is allowed to delete - not an edit the user
-- is making to a group. Granting `authenticated` UPDATE on public.groups would
-- be the other way to satisfy the trigger and it would be much worse: every
-- member of every group could then write any column of any group row they can
-- see, to fix a stamp none of them asked for.
--
-- search_path is pinned because every one of the 205 definer functions in this
-- schema pins it, and 80_the_doors_stay_shut.test.sql fails if a new one does
-- not.
create or replace function public.groups_remember_the_plan_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.groups
     set plan_ended_at = now()
   where pin_id = old.id
     and plan_ended_at is null;
  return old;
end
$$;

-- Trigger functions are not an API (20260906090000). Restated because this is a
-- CREATE OR REPLACE and the function is now definer, which makes a stray
-- EXECUTE grant worth more than it was.
revoke all on function public.groups_remember_the_plan_ended()
  from public, anon, authenticated;

comment on function public.groups_remember_the_plan_ended() is
  'Stamps groups.plan_ended_at as the pin leaves. SECURITY DEFINER on purpose: '
  'the caller is deleting their own pin and must not need UPDATE on '
  'public.groups to do it.';

notify pgrst, 'reload schema';
