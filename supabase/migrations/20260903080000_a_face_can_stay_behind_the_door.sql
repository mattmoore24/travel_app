-- A face can stay behind the door
-- ===========================================================================
--
-- Since 20260902260000 (tq-guest-more-faces) a device with NO ACCOUNT is shown
-- three travelers for a city: face, name, age, a seal and dates. Posting a
-- trip is what puts somebody in that set, and the only way out of it has been
-- to narrow the audience (which costs a verified badge and empties the
-- person's own Travelers queue) or to delete the trip - which the privacy
-- policy's own featured-traveler paragraph was found telling a woman to do.
-- UX_PLAN.md D22 recommends the cheap thing: let a traveler say no to the
-- signed-out preview and nothing else.
--
-- THREE PIECES, and the entry point of each is named because a capability
-- with nothing on the other end has shipped here eight times.
--
--   1. profiles.shown_to_guests, NULLABLE. Null is "never touched" and reads
--      as shown, so nothing changes for anybody who has not opened the row:
--      the default is opted IN, which is what the pgTAP file asserts first.
--      Not a new enum value, and not a new state - a new server fact arrives
--      as a nullable column here.
--
--   2. my_shown_to_guests() / set_shown_to_guests(boolean), the definer pair
--      that IS the client surface, mirroring my_visibility / set_visibility
--      (20260823040000:105-133) and my_group_adds / set_group_adds
--      (20260901190000). The column carries no grant in either direction:
--      profiles is column-granted precisely so that everything on it is
--      opt-in, and one traveler's setting is nobody else's to read. The
--      screen is src/app/visibility.tsx, one row under the audience picker,
--      through useOwnGuestPreview / useSetGuestPreview in
--      src/features/profile/hooks.ts.
--
--   3. featured_traveler() consults it. Restated whole from 20260902260000 -
--      every guard, the distinct-on subquery, the one ordering, the lead-only
--      bio - with ONE predicate added and nothing else moved. The OUT columns
--      do not change, so this is create or replace and not a drop; the grant
--      is restated anyway so the file reads on its own. featured-photo (the
--      edge function that signs the faces) has no row source of its own: it
--      calls this same function AS THE CALLER and signs a URL per row it gets
--      back, so an opted-out traveler leaves neither call.
--
-- WHO IS A GUEST HERE. Two kinds of viewer have no account: a signed-out
-- device (auth.uid() is null, the anon key) and an anonymous sign-in
-- (is_guest_account(), a row in auth.users with no email and no profile to
-- speak of). Both are shown the same Travelers preview (src/app/(tabs)/
-- travelers.tsx renders GuestTravelers for useIsGuest(), which is both), so
-- the setting has to answer for both or it answers for neither. A signed-in
-- traveler is unaffected: the audience setting is the rule between two
-- people with accounts, and this row is only about people without one.
--
-- WHY THIS ROW ONLY MATTERS WHILE THE AUDIENCE IS 'everyone'. audience_admits
-- admits a null viewer under 'everyone' and under nothing else
-- (20260823040000:31), so a narrowed profile already never reaches a guest.
-- The screen renders the row only in that case, which is why the column is
-- consulted here and not inside discovery_pair_ok: a person who narrows,
-- opts out, and widens again gets the opt-out they set, and the predicate
-- below is the single place it is enforced.
--
-- THE STAMP. profiles_updated_at (20260903020000) stamps for a named list of
-- EDIT columns, and 64_only_an_edit_earns_a_stamp classifies every column on
-- the table as either on that list or bookkeeping, so a new column is a
-- decision somebody records. This one is an edit: it is a choice a person
-- makes about themselves, exactly like visible_to and group_adds, which are
-- both on the list. So the trigger is restated below with shown_to_guests
-- added to both tuples and nothing else changed - the WHEN clause is the
-- whole of what keeps a bookkeeping write (last_seen_on, locale,
-- wants_business) from publishing a bulk-readable "opened the app at 14:02",
-- and it stays scoped to the columns it cares about. The other BEFORE UPDATE
-- triggers on profiles are scoped or pure (20260903030000 lists them), so
-- this write spends no cap and files no row.
--
-- DEPLOY WINDOW. A phone on the previous bundle calls featured_traveler with
-- the same signature and never calls the two new functions, so it keeps
-- working against this schema. A phone on the NEXT bundle against the
-- previous schema reads a missing RPC as "shown" (the hook's default) and its
-- one write fails with the ordinary save alert; nothing else on the screen
-- depends on it.

alter table public.profiles
  add column shown_to_guests boolean;

comment on column public.profiles.shown_to_guests is
  'Whether the three-face signed-out preview (featured_traveler) may include '
  'this traveler. NULL is the default and means yes, so nobody who has not '
  'touched the row changes. False takes them off that one surface for '
  'viewers with no account and changes nothing for anybody signed in. No '
  'client grant: my_shown_to_guests / set_shown_to_guests are the whole '
  'surface (D22).';

-- ---------------------------------------------------------------------------
-- A change to it is an edit
-- ---------------------------------------------------------------------------
--
-- 20260903020000:118-134, with shown_to_guests added to both tuples. Column
-- scoped, as every BEFORE UPDATE trigger on a table a bookkeeping write
-- touches has to be.

drop trigger profiles_updated_at on public.profiles;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  when (
    (new.display_name, new.age, new.home_city, new.home_country,
     new.occupation, new.languages, new.bio, new.gender,
     new.verified, new.verification, new.visible_to, new.group_adds,
     new.shown_to_guests, new.onboarding_completed_at)
    is distinct from
    (old.display_name, old.age, old.home_city, old.home_country,
     old.occupation, old.languages, old.bio, old.gender,
     old.verified, old.verification, old.visible_to, old.group_adds,
     old.shown_to_guests, old.onboarding_completed_at)
  )
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Reading and setting it
-- ---------------------------------------------------------------------------

create function public.my_shown_to_guests()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(shown_to_guests, true) from public.profiles where user_id = auth.uid()
$$;

create function public.set_shown_to_guests(p_shown boolean)
returns boolean
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
  perform public.assert_not_business('set who sees it');
  update public.profiles set shown_to_guests = p_shown where user_id = v_user;
  return p_shown;
end
$$;

revoke execute on function public.my_shown_to_guests() from public, anon;
grant execute on function public.my_shown_to_guests() to authenticated;
revoke execute on function public.set_shown_to_guests(boolean) from public, anon;
grant execute on function public.set_shown_to_guests(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- featured_traveler consults it
-- ---------------------------------------------------------------------------
--
-- Body from 20260902260000_a_guest_sees_more_than_one.sql, unchanged except
-- for the predicate marked below. 10_rooms_guest_mode.test.sql asserts the
-- ordering string against pg_get_functiondef, so it is byte for byte.

create or replace function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text,
  approximate boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.user_id,
    g.display_name,
    g.age,
    g.verified,
    -- The lead card's bio, and nobody else's.
    case when g.slot = 1 then g.bio end as bio,
    g.city_name,
    g.their_start,
    g.their_end,
    g.photo_path,
    g.approximate
  from (
    select
      f.*,
      -- ONE ordering for the whole function: it picks the three, it names the
      -- lead, and it is the order the rows come back in. `f.user_id` last is
      -- what makes it total, so the client's call and featured-photo's cut the
      -- same three people; 10_rooms_guest_mode.test.sql asserts it is still
      -- written here, because no query this fixture can run detects its
      -- absence.
      row_number() over (
        order by f.hellos desc, f.verified desc, f.created_at desc, f.user_id
      ) as slot
    from (
      -- One row per traveler, and it is their soonest window in this city.
      select distinct on (t.user_id)
        t.user_id,
        p.display_name,
        p.age,
        p.verified,
        p.bio,
        c.name as city_name,
        t.start_date as their_start,
        t.end_date as their_end,
        (select pp.storage_path from public.profile_photos pp
          where pp.user_id = t.user_id and pp.moderation_status = 'approved'
          order by pp.position limit 1) as photo_path,
        t.approximate,
        t.created_at,
        -- The ranking: who this city is actually writing to. Computed once
        -- here rather than inside the window's ORDER BY so it is not re-run
        -- per comparison.
        (select count(*) from public.message_requests r
          where r.recipient_id = t.user_id
            and r.created_at > now() - interval '30 days') as hellos
      from public.trips t
      join public.profiles p on p.user_id = t.user_id
      join public.cities c on c.id = t.city_id
      join public.users u on u.id = t.user_id
      where t.city_id = p_city_id
        and t.status = 'active'
        and u.status = 'active'
        and p.onboarding_completed_at is not null
        and t.end_date >= current_date - 1
        and t.start_date <= current_date + 14
        and not public.viewer_is_business()
        and exists (
          select 1 from public.profile_photos pp
          where pp.user_id = t.user_id
            and pp.moderation_status = 'approved'
            and pp.position = 0
        )
        and public.discovery_pair_ok(auth.uid(), t.user_id)
        and not public.is_blocked_pair(t.user_id)
        -- D22. A traveler who said no to the signed-out preview is in no row
        -- for a viewer with no account: a signed-out device (auth.uid() null)
        -- or an anonymous sign-in. A signed-in traveler is admitted by the
        -- audience pair above and this clause is true for them regardless.
        and (
          coalesce(p.shown_to_guests, true)
          or (auth.uid() is not null and not public.is_guest_account(auth.uid()))
        )
      order by t.user_id, t.start_date, t.id
    ) f
  ) g
  where g.slot <= 3
  order by g.slot
$$;

grant execute on function public.featured_traveler(int) to anon, authenticated;

comment on function public.featured_traveler(int) is
  'Up to three travelers a signed-out visitor may be shown for a city, one '
  'row each, ordered by who this city is writing to. Only the first row '
  'carries a bio. Carries whether each window is a guess, so no card states a '
  'date its owner did not. Skips anybody who set shown_to_guests false for a '
  'viewer with no account (D22).';

notify pgrst, 'reload schema';
