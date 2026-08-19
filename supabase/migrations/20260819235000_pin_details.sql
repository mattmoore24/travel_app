-- A pin needs to say what the plan actually is. Until now it carried a venue
-- name and nothing else, so "Rooftop for sunset drinks" had to be the whole
-- message and anyone interested had to guess the rest. Founder review: a pin
-- is a name, a place, and a couple of lines of detail.

alter table public.pins
  add column note text check (note is null or char_length(note) <= 200),
  -- What the map itself calls this spot (reverse-geocoded street or area at
  -- drop time), so the card can say where it is without exposing anybody's
  -- position — this is the PIN's location, entered or confirmed by its
  -- author, never a device reading.
  add column place_label text check (place_label is null or char_length(place_label) <= 120);

-- Same read paths, now carrying the detail. Signed-in view first.
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
  order by p.intent_date, p.created_at
$$;

-- Guests see the plan too; they still see no person behind it.
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
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  order by p.intent_date, p.created_at
$$;

grant execute on function public.public_city_pins(int) to anon, authenticated;
