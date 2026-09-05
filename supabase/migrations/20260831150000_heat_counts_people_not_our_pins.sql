-- The heatmap is the brief's stated differentiator, and it was absent by
-- arithmetic: a cell needs heat_k (3) distinct posters inside one
-- 0.005-degree square, and the twenty curated seeds were scattered one
-- landmark per neighbourhood, so no launch city could ever glow from them.
--
-- Two changes, from founder decision D7 (docs/UX_PLAN.md):
--
-- 1. Curated pins NO LONGER COUNT toward the k-threshold. A heat cell says
--    "people are planning here", and three admin rows say nothing of the
--    kind: rule 6's value is that the layer is never a lie. The count
--    becomes `count(distinct p.user_id) filter (where p.user_id is not
--    null)` in both heat functions - seeded rows are exactly the ones with
--    a null user_id. The OUT columns are unchanged, so create-or-replace is
--    legal (AGENTS.md's drop-first rule is about OUT columns); the grants
--    are restated anyway, mirroring 20260823010000.
--
-- 2. The seed list is re-written by DISTRICT rather than by landmark: three
--    pins inside one cell per nightlife district (Bairro Alto and Cais do
--    Sodre; Khao San, Thonglor and Chinatown; Roma Norte and Condesa;
--    Canggu and Seminyak). With D7 decided this buys nothing for the heat
--    layer - the honest empty state carries day one - but it is more honest
--    CONTENT: these are the areas travelers actually cluster in, one plan
--    per district per day of the three-day window.
--
-- supabase/seed/launch_pins.sql carries the identical list; keep the two in
-- lockstep. The guarded DO block at the end swaps the live curated set over
-- immediately in production (pg_cron present); the local test cluster stays
-- unseeded at migration time, exactly like 20260823010000.

create or replace function public.seed_launch_pins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Yesterday's plan is not a plan. Only ever touches seeded rows.
  delete from public.pins
  where seeded and intent_date < current_date;

  with seed(city_name, country, venue, cat, lat, lng, day_offset, note) as (
    values
    -- Lisbon: Bairro Alto (one 0.005-degree cell)
    ('Lisbon', 'PT', 'Park rooftop bar', 'bar', 38.7112, -9.1442, 0,
     'Rooftop over the rooftops. Go before sunset or queue after it.'),
    ('Lisbon', 'PT', 'A Tasca do Chico', 'other', 38.7107, -9.1447, 1,
     'Fado squeezed into one tiny room. Get there early, order a ginjinha.'),
    ('Lisbon', 'PT', 'Bairro Alto bar streets', 'bar', 38.7118, -9.1441, 2,
     'Everyone drinks in the street here. Start anywhere, the alleys do the rest.'),
    -- Lisbon: Cais do Sodre (one cell)
    ('Lisbon', 'PT', 'Time Out Market', 'restaurant', 38.7067, -9.1459, 0,
     'Easiest food hall to find people. Grab a seat at the long tables.'),
    ('Lisbon', 'PT', 'Pensão Amor', 'bar', 38.7071, -9.1458, 1, null),
    ('Lisbon', 'PT', 'Musicbox Lisboa', 'club', 38.7069, -9.1454, 2,
     'Under the arches on Pink Street. Doors open late, leave later.'),
    -- Mexico City: Roma Norte (one cell)
    ('Mexico City', 'MX', 'Mercado Roma', 'restaurant', 19.4166, -99.1667, 0,
     'Food hall in Roma Norte. The upstairs terrace is the social bit.'),
    ('Mexico City', 'MX', 'Roma Norte terrace bars', 'bar', 19.4172, -99.1663, 1,
     'Terraces on every corner. Start on Álvaro Obregón and drift.'),
    ('Mexico City', 'MX', 'Roma Norte mezcal night', 'bar', 19.4181, -99.1671, 2, null),
    -- Mexico City: Condesa (one cell)
    ('Mexico City', 'MX', 'Parque México picnic', 'other', 19.4113, -99.1707, 0,
     'Shady lawns and dog watching. Bring snacks, make friends.'),
    ('Mexico City', 'MX', 'Condesa cantina crawl', 'bar', 19.4118, -99.1738, 1,
     'Old-school cantinas and cheap tables. Botanas come with every round.'),
    ('Mexico City', 'MX', 'Condesa taco stands', 'restaurant', 19.4122, -99.1724, 2,
     'Al pastor at midnight. Follow the longest queue.'),
    -- Bangkok: Khao San (one cell)
    ('Bangkok', 'TH', 'Khao San Road', 'bar', 13.7590, 100.4977, 0,
     'The classic. Buckets, street pad thai and half the hostel crowd.'),
    ('Bangkok', 'TH', 'Brick Bar', 'club', 13.7589, 100.4986, 1,
     'Live ska under Buddy Lodge. Sweaty, loud and completely worth it.'),
    ('Bangkok', 'TH', 'Rambuttri Alley', 'restaurant', 13.7599, 100.4972, 2,
     'Khao San without the chaos. Street woks and cold drinks under the trees.'),
    -- Bangkok: Thonglor (one cell)
    ('Bangkok', 'TH', 'Thonglor rooftop bars', 'bar', 13.7322, 100.5814, 0,
     'Sukhumvit 55 does rooftops best. Smart casual gets you everywhere.'),
    ('Bangkok', 'TH', 'Thonglor night market', 'restaurant', 13.7330, 100.5822, 1,
     'Food stalls after dark. Come hungry.'),
    ('Bangkok', 'TH', 'Thonglor cocktail rooms', 'bar', 13.7315, 100.5836, 2, null),
    -- Bangkok: Chinatown (one cell)
    ('Bangkok', 'TH', 'Yaowarat street-food walk', 'restaurant', 13.7398, 100.5091, 0,
     'Chinatown after dark. Come hungry, leave in a food coma.'),
    ('Bangkok', 'TH', 'Yaowarat rooftop views', 'bar', 13.7389, 100.5079, 1,
     'Neon from above. Go up just before the lights come on.'),
    ('Bangkok', 'TH', 'Chinatown late-night bars', 'bar', 13.7392, 100.5087, 2,
     'Hidden doors off the main drag. Half the fun is finding them.'),
    -- Denpasar: Canggu (one cell)
    ('Denpasar', 'ID', 'Canggu sunset at Batu Bolong', 'beach', -8.6478, 115.1385, 0,
     'Boards for rent, beers after. The classic Bali evening.'),
    ('Denpasar', 'ID', 'Old Man''s beach bar', 'bar', -8.6486, 115.1368, 1,
     'Barefoot on the sand. Live music most nights.'),
    ('Denpasar', 'ID', 'Batu Bolong night market', 'restaurant', -8.6469, 115.1379, 2,
     'Cheap satay and smoothie bowls. Everything closes by ten.'),
    -- Denpasar: Seminyak (one cell)
    ('Denpasar', 'ID', 'Seminyak beach sunset', 'beach', -8.6924, 115.1585, 0,
     'Bean bags on the sand, cold Bintang, big sky.'),
    ('Denpasar', 'ID', 'Seminyak beach clubs', 'club', -8.6918, 115.1572, 1,
     'Day beds by day, dance floors by night. Book ahead on weekends.'),
    ('Denpasar', 'ID', 'Seminyak rooftop bars', 'bar', -8.6928, 115.1588, 2, null)
  )
  insert into public.pins
    (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at,
     seeded, seed_note)
  select
    null, lc.city_id, s.venue, s.cat::public.pin_category, s.lat, s.lng,
    current_date + s.day_offset, now() + interval '48 hours', true, s.note
  from seed s
  join public.cities c on c.name = s.city_name and c.country_code = s.country
  join public.launch_cities lc on lc.city_id = c.id and lc.active
  where not exists (
    select 1 from public.pins p
    where p.seeded and p.city_id = lc.city_id and p.venue_name = s.venue
      and p.expires_at > now()
      -- The date is part of what makes a live pin the RIGHT pin.
      and p.intent_date = current_date + s.day_offset
  );

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.seed_launch_pins() from public, anon, authenticated;

-- Rule 6, sharpened: k counts PEOPLE. A seeded pin has no user_id, so under
-- the old coalesce(user_id, id) three curated rows in one cell cleared the
-- threshold while representing zero distinct travelers. OUT columns are
-- unchanged; only the count expression moves.

create or replace function public.heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
as $$
declare
  v_k int;
begin
  select heat_k into v_k
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return; -- unknown or inactive city: no heat
  end if;

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    (count(distinct p.user_id) filter (where p.user_id is not null))::int
  from public.pins p -- caller's RLS applies here
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;

revoke execute on function public.heat_cells(int, date) from public, anon;
grant execute on function public.heat_cells(int, date) to authenticated;

-- Mirrored into the guest door, or a guest and a member would see different
-- glows on the same city.
create or replace function public.public_heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_k int;
begin
  select heat_k into v_k
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return;
  end if;

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    (count(distinct p.user_id) filter (where p.user_id is not null))::int
  from public.pins p
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
    -- A definer runs no policies, so the visibility rules the authenticated
    -- function gets from RLS have to be restated here by hand.
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  group by 1, 2
  having count(distinct p.user_id) filter (where p.user_id is not null) >= v_k;
end
$$;

grant execute on function public.public_heat_cells(int, date) to anon, authenticated;

-- Swap the live curated set over now rather than at the next daily run.
-- Guarded on pg_cron exactly like 20260823010000: it marks a real
-- deployment, and the local test cluster must stay unseeded mid-suite.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    delete from public.pins where seeded;
    perform public.seed_launch_pins();
  end if;
end
$$;
