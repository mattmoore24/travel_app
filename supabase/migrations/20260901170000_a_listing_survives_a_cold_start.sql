-- A half-finished listing stops turning into traveler onboarding.
--
-- "Run a business? Put it on the map" sets an in-memory flag and replaces into
-- the listing form. The flag is zustand, so killing the app loses it, and from
-- that moment owesOnboarding reads the account as a traveler who has not
-- finished: the tabs are filtered out of the tree and traveler onboarding is
-- mounted instead. The bar owner reopens the app and is asked for their first
-- name, their age and their photos, in the one flow a business must never
-- finish, because completing it stamps onboarding_completed_at and
-- register_business then refuses the account outright.
--
-- So the answer lives in the database, where a cold start and a reinstall
-- cannot lose it.
--
-- SERVER-OWNED, deliberately. profiles carries column-level grants and this
-- column is given none, exactly like the verification evidence beside it:
-- profiles_select_visible lets any authenticated account read a visible
-- traveler's row, so a granted column would tell every reader who is in the
-- middle of listing a business. The two functions below are the only way in
-- and out, and both are scoped to auth.uid() rather than taking a user id.

alter table public.profiles
  add column if not exists wants_business boolean not null default false;

comment on column public.profiles.wants_business is
  'Started listing a business and has not finished. Server-owned: no column grant, read and written only through listing_intent() and set_listing_intent().';

-- Say what the account is doing. Idempotent, and it answers with what it
-- stored so a caller never has to read back through a column it cannot see.
create or replace function public.set_listing_intent(p_wants boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wants boolean := coalesce(p_wants, false);
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update public.profiles
     set wants_business = v_wants
   where user_id = v_user;
  return v_wants;
end;
$$;

comment on function public.set_listing_intent(boolean) is
  'Record that the caller is part way through listing a business. Scoped to auth.uid(): there is no parameter for whose flag to set.';

-- Read your own, and only your own.
create or replace function public.listing_intent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.wants_business from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

comment on function public.listing_intent() is
  'Whether the caller is part way through listing a business. Takes no user id on purpose.';

revoke all on function public.set_listing_intent(boolean) from public;
revoke all on function public.listing_intent() from public;
grant execute on function public.set_listing_intent(boolean) to authenticated;
grant execute on function public.listing_intent() to authenticated;
