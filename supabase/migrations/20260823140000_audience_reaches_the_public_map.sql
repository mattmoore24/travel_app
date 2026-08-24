-- The audience setting reaches the guest map too
-- ===========================================================================
--
-- Founder, 2026-08-23, testing the filter: "changing the selection will
-- change both who you can see and who sees you." It did, on both signed-in
-- surfaces, and did not on the third.
--
-- 20260823030000 added discovery_pair_ok to the three surfaces it knew about:
-- get_matches, city_pins and featured_traveler. It reasoned explicitly about
-- the guest case for featured_traveler ("this one is granted to anon, so a
-- guest is the viewer: anybody who narrowed their audience is simply not
-- eligible for the slot, which falls out of audience_admits(<narrowed>, null)
-- being false") and then did not apply the same thought to
-- public_city_pins, which is the other function granted to anon.
--
-- So a traveler who set "verified only" was correctly hidden from the
-- Travelers queue and from the signed-in map, and their pin stayed on the
-- map of every signed-out visitor. That is the one direction the setting
-- exists to control, so this is a defect and not a trade.
--
-- The k-threshold argument does NOT rescue it, and should not be reached for:
-- the heatmap is exempt because a cell below k never resolves to a person,
-- and a single pin at a named venue on a named date has no k at all.
--
-- Guest here means both kinds: signed-out (auth.uid() is null, so a narrowed
-- owner's audience_admits returns false) and an anonymous guest account
-- (a real uid whose own visible_to is 'everyone', because a guest cannot
-- reach the picker, so the pair test reduces to the owner's own choice).
--
-- Curated pins keep their exemption: they have no owner to have a setting.
-- Same OUT columns, so create or replace is correct here.

create or replace function public.public_city_pins(p_city_id int)
returns table (
  id uuid,
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
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.note,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at
  from public.pins p
  join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (
      p.seeded
      or (
        public.is_discoverable_owner(p.user_id)
        and public.discovery_pair_ok(auth.uid(), p.user_id)
      )
    )
  order by p.intent_date, p.created_at
$$;

-- Restated after the replace, and unchanged: this is the guest-facing one.
revoke execute on function public.public_city_pins(int) from public;
grant execute on function public.public_city_pins(int) to anon, authenticated;

comment on function public.public_city_pins(int) is
  'Pins with no person attached, for guests. Honours the owner''s audience: '
  'somebody who narrowed to verified is not on a signed-out visitor''s map '
  'either, which is the half of "who can see you" this used to miss.';
