-- A FINISHED PROFILE HAS AN AGE.
--
-- The 18+ rule was enforced in two places that both looked like the server and
-- only one of which was.
--
-- WHAT WAS ALREADY RIGHT: `profiles.age` carries
--   check (age is null or age between 18 and 120)
-- so nobody can RECORD an age under eighteen. That constraint is real and it
-- is not what this migration is about.
--
-- WHAT WAS NOT: the column is nullable, `authenticated` holds
--   grant update (display_name, age, ..., onboarding_completed_at) on public.profiles
-- (20260816190000:350), and `is_discoverable_owner` asks only for
-- `u.status = 'active'` and `onboarding_completed_at is not null`. So a caller
-- talking to the API directly could stamp itself complete with age NULL, or
-- stamp itself complete and then set age back to NULL, and be discoverable
-- either way with no age on record at all. Not an age under eighteen -- no age.
--
-- The app never does this: the basics step gates its Continue on
-- `basicsProblem({ name, age, gender }) == null`
-- (src/app/onboarding/index.tsx:220), and the final step writes
-- `onboarding_completed_at` alone onto a row whose age is already there. Which
-- is exactly the problem: the gate was in the client, on a rule the product
-- brief and the App Store listing both state as a fact about the service.
--
-- Verified before writing this, so the fix hides nobody:
--   select count(*) from public.profiles
--   where onboarding_completed_at is not null and age is null;   -- 0
--
-- WHY A TRIGGER AND NOT A COLUMN CHECK. A table CHECK would be evaluated on
-- every row including the ones a business account owns, and a business is
-- precisely an account whose onboarding_completed_at stays NULL
-- (20260827100000:178) -- so the condition has to be "complete implies an age",
-- which is what this is, rather than "always an age".
--
-- WHY NOT is_discoverable_owner. It would work and it is tempting, but that
-- function is called from a dozen feed paths and a stable predicate there is
-- worth more than a second copy of this rule. The invariant is established at
-- WRITE time, which is the one place it can be established once.
create or replace function public.a_finished_profile_has_an_age()
returns trigger
language plpgsql
as $$
begin
  -- Both directions in one condition: stamping complete without an age, and
  -- clearing the age on a row that is already complete.
  if new.onboarding_completed_at is not null and new.age is null then
    raise exception 'a finished profile needs an age'
      using errcode = 'check_violation', hint = 'age_required';
  end if;
  return new;
end
$$;

revoke all on function public.a_finished_profile_has_an_age() from public, anon, authenticated;

drop trigger if exists profiles_finished_has_an_age on public.profiles;
create trigger profiles_finished_has_an_age
  before insert or update on public.profiles
  for each row execute function public.a_finished_profile_has_an_age();

notify pgrst, 'reload schema';
