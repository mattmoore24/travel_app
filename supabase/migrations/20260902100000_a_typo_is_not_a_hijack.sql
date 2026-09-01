-- ---------------------------------------------------------------------------
-- A typo is not a hijack
-- ---------------------------------------------------------------------------
--
-- `business_rename_resets` compared name, city_id, lat and lng with
-- `is distinct from`. So changing "Cafe Janis" to "Café Janis", or dragging
-- the marker the ten metres from the middle of the road onto the actual door,
-- nulled `verified_at` and dropped a listed business back to 'unconfirmed'.
--
-- The badge was earned by somebody standing outside their own business taking
-- two photos of the front, and it was destroyed by fixing a spelling mistake.
-- The alert on the edit screen warned about it honestly, which means the app
-- was honestly telling owners that the safest thing they could do was leave a
-- wrong name and a wrong marker alone. Those are exactly the corrections that
-- make the map better.
--
-- What the reset is FOR (20260827120000:477-481) is the one attack a
-- confirmation step genuinely stops: verify a surf shack, then rename it to
-- the Marriott. Two changes keep that shut while letting accuracy through.
--
--   1. Names are compared NORMALISED — accents folded, case folded, runs of
--      whitespace collapsed. 'Café Janis' and 'Cafe Janis' are the same name;
--      'Surf Shack' and 'Marriott' are not, and no amount of normalising will
--      make them so.
--   2. The marker is compared by DISTANCE rather than by equality, at 75
--      metres. That is wider than a doorway and narrower than a different
--      building, which is the whole argument: a nudge onto the door is free,
--      a walk to the hotel down the street is not.
--
-- A city change keeps the full reset unconditionally. So does a rename that
-- survives normalisation, and so does a move past the threshold.
--
-- Deliberately NOT going further and preserving `verified_at` through a
-- genuine rename. The re-confirmation email goes to the same inbox the surf
-- shack registered, so the badge would survive the exact attack the reset
-- exists to stop.
--
-- No signature change and no OUT columns — this is a trigger function, so the
-- drop-and-regrant rule in AGENTS.md does not apply and there is nothing to
-- re-state. `create or replace` keeps the existing `businesses_rename_resets`
-- trigger pointing at it and keeps the revoke from 20260827120000:509 in
-- place.

create or replace function public.business_rename_resets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The name as somebody would say it out loud, which is the comparison that
  -- decides whether this is a different business or the same one spelled
  -- better. immutable_unaccent is the helper the city search already uses
  -- (20260816200000:19).
  v_old_name text := public.immutable_unaccent(
    lower(btrim(regexp_replace(coalesce(old.name, ''), '\s+', ' ', 'g'))));
  v_new_name text := public.immutable_unaccent(
    lower(btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'))));
begin
  -- The display_name mirror stays on ANY literal name change, normalisation
  -- included. A place renamed everywhere except on the messages it has
  -- already sent, and every one it sends next, is a different bug and this
  -- one still has to fix it (20260827160000:352-357).
  if new.name is distinct from old.name then
    update public.profiles set display_name = new.name
     where user_id = new.owner_user_id and new.owner_user_id is not null;
  end if;

  if v_new_name is distinct from v_old_name
     or new.city_id is distinct from old.city_id
     -- haversine_km, the same great-circle helper the pin geofence uses
     -- (20260816210000:65). Null-safe by construction: lat and lng are both
     -- NOT NULL on this table, so the comparison cannot go NULL and quietly
     -- answer false.
     or public.haversine_km(old.lat, old.lng, new.lat, new.lng) > 0.075 then
    new.verified_at := null;
    if old.state = 'listed' then
      new.state := 'unconfirmed';
      new.listed_at := null;
    end if;
  end if;
  return new;
end
$$;
