-- WHERE THE BADGE WAS EARNED, NOT WHERE THE ROW WAS LAST SAVED
--
-- 20260902100000 stopped a ten-metre nudge from costing the storefront check,
-- which was the bug it was written for and which it fixes. It measures the
-- nudge as `haversine_km(old.lat, old.lng, new.lat, new.lng) > 0.075` - the
-- distance from the PREVIOUS ROW. That comparison has no memory, so seventy
-- metres, saved, then seventy metres again, and again, is an unbounded walk
-- across a city with the verified badge intact at the end of it. A business
-- could be checked at one address and be sitting at another, still wearing
-- the mark that says somebody looked.
--
-- The name half of the same trigger does not have this hole: two names are
-- either the same string or they are not, and normalisation is idempotent, so
-- there is no sequence of "almost the same" renames that adds up to a
-- different business. Only distance accumulates, so only distance needs an
-- anchor.
--
-- The anchor is where the business stood when the badge was granted. Every
-- existing setter of verified_at is an ordinary UPDATE in another function
-- (business_listing:433, places_polish:149 and :246), and rewriting all three
-- to carry two more columns is three chances to miss one. So the anchor is
-- maintained HERE, in the trigger that already runs BEFORE UPDATE on this
-- table: it is stamped in the same statement that grants the badge, and
-- cleared in the same statement that takes it away. A setter added tomorrow
-- gets the behaviour without knowing this column exists.
--
-- Rows verified before this migration have no anchor. They fall back to
-- old.lat/old.lng, which is exactly today's behaviour - no worse, and the
-- first re-verification gives them a real one.

alter table public.businesses
  add column if not exists verified_lat double precision,
  add column if not exists verified_lng double precision;

comment on column public.businesses.verified_lat is
  'Where the business stood when verified_at was last granted. The reset '
  'threshold is measured from here, not from the previous row, so a walk in '
  'sub-threshold steps cannot keep a badge earned somewhere else. Null for '
  'rows verified before 20260902120000, which fall back to the previous row.';

create or replace function public.business_rename_resets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text := public.immutable_unaccent(
    lower(btrim(regexp_replace(coalesce(old.name, ''), '\s+', ' ', 'g'))));
  v_new_name text := public.immutable_unaccent(
    lower(btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'))));
  -- The anchor, or the previous row for a listing that predates it.
  v_from_lat double precision := coalesce(old.verified_lat, old.lat);
  v_from_lng double precision := coalesce(old.verified_lng, old.lng);
  v_reset boolean;
begin
  -- The display_name mirror stays on ANY literal name change, normalisation
  -- included. A place renamed everywhere except on the messages it has
  -- already sent, and every one it sends next, is a different bug and this
  -- one still has to fix it (20260827160000:352-357).
  if new.name is distinct from old.name then
    update public.profiles set display_name = new.name
     where user_id = new.owner_user_id and new.owner_user_id is not null;
  end if;

  v_reset := v_new_name is distinct from v_old_name
     or new.city_id is distinct from old.city_id
     -- haversine_km, the same great-circle helper the pin geofence uses
     -- (20260816210000:65). Null-safe by construction: lat and lng are both
     -- NOT NULL on this table, and the anchor coalesces to them, so the
     -- comparison cannot go NULL and quietly answer false.
     or public.haversine_km(v_from_lat, v_from_lng, new.lat, new.lng) > 0.075;

  if v_reset then
    new.verified_at := null;
    -- The anchor goes with the badge. Leaving it behind would measure the
    -- next nudge from a position nobody has checked.
    new.verified_lat := null;
    new.verified_lng := null;
    if old.state = 'listed' then
      new.state := 'unconfirmed';
      new.listed_at := null;
    end if;
  elsif new.verified_at is not null and old.verified_at is null then
    -- The badge was just granted, by whichever function did it. This is the
    -- one statement that knows both that it happened and where the business
    -- is, so it is where the anchor is stamped.
    new.verified_lat := new.lat;
    new.verified_lng := new.lng;
  end if;
  return new;
end
$$;

revoke execute on function public.business_rename_resets() from public, anon, authenticated;
