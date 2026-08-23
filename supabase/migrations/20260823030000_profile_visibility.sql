-- Who can see you
-- ===========================================================================
--
-- A traveler can narrow the audience for their profile and their pins to
-- verified people, or to verified men, or to verified women. Default is
-- everyone, and only a verified account may pick anything else. The
-- badge is the cost of asking other people to have one.
--
-- Three things about the shape of this, because they are the whole design:
--
-- 1. IT CUTS BOTH WAYS. Choosing an audience chooses who you are shown TO
--    and who you are SHOWN. If you ask to be seen only by verified women,
--    the Travelers queue and the map show you only verified women. That is
--    what makes it a preference rather than a cloak, and it is why the check
--    below is a symmetric pair function rather than a one-sided filter.
--
-- 2. IT DOES NOT TOUCH CHAT. Rooms, groups, existing threads and first
--    messages are all unaffected: anyone can talk to anyone, verified or
--    not. This setting is about the two DISCOVERY surfaces, Travelers and
--    Map, and nothing else. Deliberately not wired into
--    send_message_request, traveler_trips, or any profile read - a profile
--    you reached from a chat still opens.
--
-- 3. IT DOES NOT TOUCH THE HEATMAP. Heat cells are an aggregate with a
--    k-threshold, and re-filtering them per viewer would LOWER the count in
--    a cell for some viewers, which is exactly the direction that breaks the
--    k guarantee (rule 6: a cell must never resolve to a person). A hidden
--    traveler still adds anonymous weight to a cell; they never appear as a
--    pin. That is the safe side of the trade.
--
-- Honest consequence, stated once here and again in the app: 'verified men'
-- and 'verified women' match the gender on a profile, so travelers who are
-- nonbinary or who have not set a gender are not in either of those two
-- audiences. The app says so on the picker rather than letting people find
-- out by wondering where everyone went.

create type public.profile_audience as enum (
  'everyone',
  'verified',
  'verified_men',
  'verified_women'
);

alter table public.profiles
  add column visible_to public.profile_audience not null default 'everyone';

-- Deliberately NOT granted to authenticated in either direction. Reading it
-- would leak one traveler's setting to another (knowing somebody restricted
-- themselves to verified women is itself information), and writing it
-- directly would route around the verified check. Both go through the two
-- RPCs at the bottom of this file.


-- The pair test ---------------------------------------------------------------

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

-- Guests never call these directly; featured_traveler is SECURITY DEFINER
-- and calls them as the owner. `authenticated` KEEPS execute (Supabase's
-- default privileges on this schema grant it explicitly, and revoking from
-- PUBLIC does not take that away), which is required: get_matches and
-- city_pins are SECURITY INVOKER on purpose, so the caller must be able to
-- run the predicate. That is not a new leak - discovery_pair_ok(me, X)
-- returning false says only "X is hidden from you", which is the same thing
-- their absence from the Travelers queue already says.
revoke execute on function
  public.audience_admits(public.profile_audience, uuid),
  public.discovery_pair_ok(uuid, uuid)
  from public, anon;


-- Surface 1: Travelers ---------------------------------------------------------
--
-- Body copied verbatim from 20260821090000_trip_date_slack.sql, with one
-- join condition added. Same OUT columns, so replace rather than drop.

create or replace function public.get_matches()
returns table (
  trip_id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  occupation text,
  gender public.gender,
  city_id int,
  city_name text,
  city_country text,
  overlap_start date,
  overlap_end date,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
as $$
  select *
  from (
    select distinct on (theirs.id)
      theirs.id as trip_id,
      theirs.user_id as user_id,
      p.display_name as display_name,
      p.age as age,
      p.verified as verified,
      p.languages as languages,
      p.bio as bio,
      p.occupation as occupation,
      p.gender as gender,
      c.id as city_id,
      c.name as city_name,
      c.country_name as city_country,
      greatest(mine.start_date, theirs.start_date) as overlap_start,
      least(mine.end_date, theirs.end_date) as overlap_end,
      theirs.start_date as their_start,
      theirs.end_date as their_end,
      (select pp.storage_path from public.profile_photos pp
        where pp.user_id = theirs.user_id and pp.moderation_status = 'approved'
        order by pp.position limit 1) as photo_path
    from public.trips mine
    join public.trips theirs
      on theirs.city_id = mine.city_id
     and theirs.user_id <> mine.user_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.end_date >= current_date - 1
    join public.profiles p on p.user_id = theirs.user_id
    join public.cities c on c.id = theirs.city_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date - 1
      and greatest(mine.start_date, theirs.start_date) <= current_date + 180
      -- Who can see you, both ways.
      and public.discovery_pair_ok(auth.uid(), theirs.user_id)
    order by theirs.id, greatest(mine.start_date, theirs.start_date)
  ) m
  order by m.overlap_start, m.their_start, m.trip_id
$$;

revoke execute on function public.get_matches() from public, anon;


-- Surface 2: the map ------------------------------------------------------------
--
-- Body copied verbatim from 20260819235000_pin_details.sql, with one
-- predicate added. Curated pins have no owner and are always shown.

create or replace function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  note text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz
)
language sql
stable
as $$
  select
    p.id,
    p.user_id,
    pr.display_name,
    pr.age,
    pr.verified,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = p.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    p.venue_name,
    p.note,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    p.seed_note,
    p.expires_at
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.created_at
$$;

revoke execute on function public.city_pins(int) from public, anon;
grant execute on function public.city_pins(int) to authenticated;


-- Surface 3: the featured traveler -----------------------------------------------
--
-- Body copied verbatim from 20260822140000_featured_and_caps.sql, with one
-- predicate added. This one is granted to anon, so a guest is the viewer:
-- anybody who narrowed their audience is simply not eligible for the slot,
-- which falls out of audience_admits(<narrowed>, null) being false.

create or replace function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    c.name,
    t.start_date,
    t.end_date,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = t.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
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
    and exists (
      select 1 from public.profile_photos pp
      where pp.user_id = t.user_id
        and pp.moderation_status = 'approved'
        and pp.position = 0
    )
    and public.discovery_pair_ok(auth.uid(), t.user_id)
  order by
    (select count(*) from public.message_requests r
      where r.recipient_id = t.user_id
        and r.created_at > now() - interval '30 days') desc,
    p.verified desc,
    t.created_at desc
  limit 1
$$;

grant execute on function public.featured_traveler(int) to anon, authenticated;


-- Reading and writing your own setting -------------------------------------------

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
  -- The rule the founder asked for, enforced here rather than in the app:
  -- narrowing your audience to verified people costs a verified badge.
  if p_audience <> 'everyone'
     and not exists (select 1 from public.profiles where user_id = v_user and verified) then
    raise exception 'get verified before choosing who can see you'
      using errcode = 'check_violation';
  end if;
  update public.profiles set visible_to = p_audience where user_id = v_user;
  return p_audience;
end
$$;

revoke execute on function public.my_visibility() from public, anon;
revoke execute on function public.set_visibility(public.profile_audience) from public, anon;
grant execute on function public.my_visibility() to authenticated;
grant execute on function public.set_visibility(public.profile_audience) to authenticated;

-- Defence in depth: a badge can be taken away (suspension review, a photo
-- set replaced). A setting that outlived the badge that justified it would
-- be a rule enforced only at write time, so losing the badge drops the
-- setting back to the default in the same statement.
create function public.reset_visibility_when_unverified()
returns trigger
language plpgsql
as $$
begin
  if old.verified and not new.verified then
    new.visible_to := 'everyone';
  end if;
  return new;
end
$$;

create trigger profiles_reset_visibility
  before update of verified on public.profiles
  for each row execute function public.reset_visibility_when_unverified();
