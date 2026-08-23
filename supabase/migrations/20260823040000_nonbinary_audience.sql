-- A nonbinary audience, so the setting is not a two-gender setting
-- ===========================================================================
--
-- The first cut of "who can see you" shipped with everyone / verified /
-- verified_men / verified_women, which left verified nonbinary travelers as
-- the only group that could be asked for but never asked. Founder decision
-- (2026-08-23): give them their own audience. `verified_nonbinary` matches
-- profiles.gender = 'nonbinary', exactly as the other two match 'man' and
-- 'woman'.
--
-- Note this rebuilds the enum rather than using `alter type ... add value`.
-- Postgres refuses to USE a new enum value in the same transaction that
-- added it, and this migration has to both add the value AND rebuild the
-- function that compares against it. Whether the deploy tool wraps a
-- migration file in a transaction is not something a migration should have
-- to bet on, so the type is swapped instead: correct either way.

-- pg_depend blocks dropping a type while any function still carries it in a
-- signature, so those go first. discovery_pair_ok does not carry the type,
-- but it is rebuilt anyway so every reference is re-parsed against the new
-- type in one pass rather than left to plan invalidation.
drop function public.set_visibility(public.profile_audience);
drop function public.my_visibility();
drop function public.discovery_pair_ok(uuid, uuid);
drop function public.audience_admits(public.profile_audience, uuid);

alter table public.profiles alter column visible_to drop default;
alter type public.profile_audience rename to profile_audience_v1;

create type public.profile_audience as enum (
  'everyone',
  'verified',
  'verified_men',
  'verified_women',
  'verified_nonbinary'
);

alter table public.profiles
  alter column visible_to type public.profile_audience
  using visible_to::text::public.profile_audience;
alter table public.profiles
  alter column visible_to set default 'everyone';

drop type public.profile_audience_v1;


-- Rebuilt, with the third gendered audience in the ladder ---------------------

-- Does this audience setting admit this person? p_user null (a guest) is
-- admitted by 'everyone' and by nothing else.
create function public.audience_admits(p_audience public.profile_audience, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_audience = 'everyone' then true
    when p_user is null then false
    else exists (
      select 1 from public.profiles p
      where p.user_id = p_user
        and p.verified
        and (
          p_audience = 'verified'
          or (p_audience = 'verified_men' and p.gender = 'man')
          or (p_audience = 'verified_women' and p.gender = 'woman')
          or (p_audience = 'verified_nonbinary' and p.gender = 'nonbinary')
        )
    )
  end
$$;

-- Both directions, in one call. Every discovery surface asks this and
-- nothing else, so there is one definition of "these two may see each other"
-- rather than the same predicate half-copied into four places.
create function public.discovery_pair_ok(p_viewer uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Your own pin and your own card never disappear on you, whatever you
    -- picked. Without this a verified man who chose 'verified women' would
    -- vanish from his own map.
    p_viewer is not distinct from p_subject
    or (
      public.audience_admits(
        (select visible_to from public.profiles where user_id = p_subject),
        p_viewer
      )
      and public.audience_admits(
        -- A guest has no setting of their own, so they restrict nobody.
        coalesce(
          (select visible_to from public.profiles where user_id = p_viewer),
          'everyone'
        ),
        p_subject
      )
    )
$$;

create function public.my_visibility()
returns public.profile_audience
language sql
stable
security definer
set search_path = public
as $$
  select visible_to from public.profiles where user_id = auth.uid()
$$;

create function public.set_visibility(p_audience public.profile_audience)
returns public.profile_audience
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Narrowing your audience to verified people costs a verified badge.
  if p_audience <> 'everyone'
     and not exists (select 1 from public.profiles where user_id = v_user and verified) then
    raise exception 'get verified before choosing who can see you'
      using errcode = 'check_violation';
  end if;
  update public.profiles set visible_to = p_audience where user_id = v_user;
  return p_audience;
end
$$;

-- Every grant the drops above removed, restated. `authenticated` keeps
-- execute on the two predicates because get_matches and city_pins are
-- SECURITY INVOKER on purpose and the caller has to be able to run them.
revoke execute on function
  public.audience_admits(public.profile_audience, uuid),
  public.discovery_pair_ok(uuid, uuid)
  from public, anon;
revoke execute on function public.my_visibility() from public, anon;
revoke execute on function public.set_visibility(public.profile_audience) from public, anon;
grant execute on function public.my_visibility() to authenticated;
grant execute on function public.set_visibility(public.profile_audience) to authenticated;
