-- Curated pins that stay current, and two grants the repo never stated.
--
-- 1. The daily refresh put a plan on the map and then let it rot.
--
-- seed_launch_pins() skips any venue that still has a LIVE seeded pin. Pins
-- live 48h and the schedule runs daily, so on day two every venue is skipped
-- and yesterday's `intent_date` survives. The map keeps its pins, but the
-- Today and Tomorrow chips - the brief's own hook, "what travelers are doing
-- in this city tonight" - match `intent_date` exactly and find nothing. A
-- curated plan therefore spends its second day labelled with a weekday that
-- has already gone by.
--
-- The guard now also requires the date to be right, and stale seeded pins are
-- swept first so the refresh cannot leave two of the same venue behind. Same
-- signature and same return, so `create or replace` is safe here (AGENTS.md's
-- drop-first rule is about changing OUT columns).

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
    ('Lisbon', 'PT', 'LX Factory night market', 'other', 38.7025, -9.1782, 0,
     'Open-air market under the bridge — travelers meet at the main gate, 7pm.'),
    ('Lisbon', 'PT', 'Time Out Market', 'restaurant', 38.7067, -9.1459, 0,
     'Easiest food hall to find people — grab a seat at the long tables.'),
    ('Lisbon', 'PT', 'Miradouro de Santa Catarina', 'monument', 38.7089, -9.1487, 1,
     'Classic sunset spot — bring a drink, everyone talks to everyone.'),
    ('Lisbon', 'PT', 'Pensão Amor', 'bar', 38.7071, -9.1458, 1, null),
    ('Lisbon', 'PT', 'Carcavelos beach morning', 'beach', 38.6785, -9.3363, 2,
     'Train from Cais do Sodré — surfers and swimmers both welcome.'),
    ('Mexico City', 'MX', 'Mercado Roma', 'restaurant', 19.4166, -99.1667, 0,
     'Food hall in Roma Norte — upstairs terrace is the social bit.'),
    ('Mexico City', 'MX', 'Bosque de Chapultepec walk', 'hike', 19.4204, -99.1912, 1,
     'Sunday stroll to the castle viewpoint — meet at the Niños Héroes gate.'),
    ('Mexico City', 'MX', 'Museo Frida Kahlo', 'museum', 19.3550, -99.1626, 1,
     'Book tickets ahead — coffee in Coyoacán square after.'),
    ('Mexico City', 'MX', 'Lucha libre at Arena México', 'other', 19.4249, -99.1444, 2,
     'Tuesday/Friday fights — cheap tickets, unbeatable atmosphere.'),
    ('Mexico City', 'MX', 'Pulquería Los Insurgentes', 'bar', 19.4114, -99.1626, 2, null),
    ('Bangkok', 'TH', 'Chatuchak weekend market', 'other', 13.7999, 100.5502, 0,
     'Meet at the clock tower — section 26 for vintage, then coconut ice cream.'),
    ('Bangkok', 'TH', 'Wat Arun at sunset', 'monument', 13.7437, 100.4889, 1,
     'Cross by ferry from Tha Tien — golden hour on the river side.'),
    ('Bangkok', 'TH', 'Yaowarat street-food walk', 'restaurant', 13.7398, 100.5091, 1,
     'Chinatown after dark — come hungry, leave in a food coma.'),
    ('Bangkok', 'TH', 'Lumpini Park morning run', 'hike', 13.7314, 100.5414, 2,
     '7am loop before the heat — watch for the monitor lizards.'),
    ('Bangkok', 'TH', 'Khao San Road', 'bar', 13.7590, 100.4977, 2, null),
    ('Denpasar', 'ID', 'Canggu sunset at Batu Bolong', 'beach', -8.6478, 115.1385, 0,
     'Boards for rent, beers after — the classic Bali evening.'),
    ('Denpasar', 'ID', 'Sanur sunrise ride', 'beach', -8.6931, 115.2620, 1,
     'Flat cycle path along the water — sunrise is 6:15, worth it.'),
    ('Denpasar', 'ID', 'Ubud Monkey Forest + rice terraces', 'hike', -8.5194, 115.2606, 1,
     'Share a driver from town — Campuhan ridge walk after.'),
    ('Denpasar', 'ID', 'Uluwatu Temple kecak dance', 'monument', -8.8291, 115.0849, 2,
     'Clifftop fire dance at sunset — hold onto your sunglasses (monkeys).'),
    ('Denpasar', 'ID', 'La Brisa beach club', 'club', -8.6600, 115.1300, 2, null)
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

-- 2. Grants the repo depends on but never states -----------------------------
--
-- city_pins was dropped and recreated in 20260819235000 and only ever revoked
-- afterwards; `grep -rn "grant execute on function public.city_pins"` finds
-- nothing. It works today because Supabase's stock default privileges grant
-- execute on new functions to authenticated - which is precisely the
-- re-state-your-grants trap AGENTS.md warns about, and precisely the failure
-- that would make a signed-in map render empty with nothing said. Stated
-- explicitly now so it does not depend on a default nobody in this repo wrote.

grant execute on function public.city_pins(int) to authenticated;
grant execute on function public.public_city_pins(int) to anon, authenticated;
