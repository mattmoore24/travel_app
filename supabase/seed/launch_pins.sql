-- Curated seed pins for launch cities ("be the first pin" cold-start content,
-- brief Phase 6). Run in the Supabase SQL editor. Safe to re-run: only
-- inserts for ACTIVE launch cities and skips venues that still have a live
-- seeded pin. Pins expire in 48h by design (hard rule 3 caps at 72h); the
-- daily seed-launch-pins cron re-runs the function version of this list.
--
-- KEEP IN LOCKSTEP with seed_launch_pins() — the live definition is in
-- 20260831150000_heat_counts_people_not_our_pins.sql. Clustered by DISTRICT,
-- three pins per nightlife district inside one 0.005-degree cell, one per
-- day of the three-day window. Curated pins do NOT count toward the heat
-- k-threshold (founder decision D7), so this is honest content, not heat.
--
-- All coordinates sit inside each city's geofence radius; the validate_pin
-- trigger enforces that, so a typo fails loudly instead of silently.

with seed(city_name, country, venue, cat, lat, lng, day_offset, note) as (
  values
  -- Lisbon: Bairro Alto
  ('Lisbon', 'PT', 'Park rooftop bar', 'bar', 38.7112, -9.1442, 0,
   'Rooftop over the rooftops. Go before sunset or queue after it.'),
  ('Lisbon', 'PT', 'A Tasca do Chico', 'other', 38.7107, -9.1447, 1,
   'Fado squeezed into one tiny room. Get there early, order a ginjinha.'),
  ('Lisbon', 'PT', 'Bairro Alto bar streets', 'bar', 38.7118, -9.1441, 2,
   'Everyone drinks in the street here. Start anywhere, the alleys do the rest.'),
  -- Lisbon: Cais do Sodre
  ('Lisbon', 'PT', 'Time Out Market', 'restaurant', 38.7067, -9.1459, 0,
   'Easiest food hall to find people. Grab a seat at the long tables.'),
  ('Lisbon', 'PT', 'Pensão Amor', 'bar', 38.7071, -9.1458, 1, null),
  ('Lisbon', 'PT', 'Musicbox Lisboa', 'club', 38.7069, -9.1454, 2,
   'Under the arches on Pink Street. Doors open late, leave later.'),
  -- Mexico City: Roma Norte
  ('Mexico City', 'MX', 'Mercado Roma', 'restaurant', 19.4166, -99.1667, 0,
   'Food hall in Roma Norte. The upstairs terrace is the social bit.'),
  ('Mexico City', 'MX', 'Roma Norte terrace bars', 'bar', 19.4172, -99.1663, 1,
   'Terraces on every corner. Start on Álvaro Obregón and drift.'),
  ('Mexico City', 'MX', 'Roma Norte mezcal night', 'bar', 19.4181, -99.1671, 2, null),
  -- Mexico City: Condesa
  ('Mexico City', 'MX', 'Parque México picnic', 'other', 19.4113, -99.1707, 0,
   'Shady lawns and dog watching. Bring snacks, make friends.'),
  ('Mexico City', 'MX', 'Condesa cantina crawl', 'bar', 19.4118, -99.1738, 1,
   'Old-school cantinas and cheap tables. Botanas come with every round.'),
  ('Mexico City', 'MX', 'Condesa taco stands', 'restaurant', 19.4122, -99.1724, 2,
   'Al pastor at midnight. Follow the longest queue.'),
  -- Bangkok: Khao San
  ('Bangkok', 'TH', 'Khao San Road', 'bar', 13.7590, 100.4977, 0,
   'The classic. Buckets, street pad thai and half the hostel crowd.'),
  ('Bangkok', 'TH', 'Brick Bar', 'club', 13.7589, 100.4986, 1,
   'Live ska under Buddy Lodge. Sweaty, loud and completely worth it.'),
  ('Bangkok', 'TH', 'Rambuttri Alley', 'restaurant', 13.7599, 100.4972, 2,
   'Khao San without the chaos. Street woks and cold drinks under the trees.'),
  -- Bangkok: Thonglor
  ('Bangkok', 'TH', 'Thonglor rooftop bars', 'bar', 13.7322, 100.5814, 0,
   'Sukhumvit 55 does rooftops best. Smart casual gets you everywhere.'),
  ('Bangkok', 'TH', 'Thonglor night market', 'restaurant', 13.7330, 100.5822, 1,
   'Food stalls after dark. Come hungry.'),
  ('Bangkok', 'TH', 'Thonglor cocktail rooms', 'bar', 13.7315, 100.5836, 2, null),
  -- Bangkok: Chinatown
  ('Bangkok', 'TH', 'Yaowarat street-food walk', 'restaurant', 13.7398, 100.5091, 0,
   'Chinatown after dark. Come hungry, leave in a food coma.'),
  ('Bangkok', 'TH', 'Yaowarat rooftop views', 'bar', 13.7389, 100.5079, 1,
   'Neon from above. Go up just before the lights come on.'),
  ('Bangkok', 'TH', 'Chinatown late-night bars', 'bar', 13.7392, 100.5087, 2,
   'Hidden doors off the main drag. Half the fun is finding them.'),
  -- Denpasar / Bali: Canggu
  ('Denpasar', 'ID', 'Canggu sunset at Batu Bolong', 'beach', -8.6478, 115.1385, 0,
   'Boards for rent, beers after. The classic Bali evening.'),
  ('Denpasar', 'ID', 'Old Man''s beach bar', 'bar', -8.6486, 115.1368, 1,
   'Barefoot on the sand. Live music most nights.'),
  ('Denpasar', 'ID', 'Batu Bolong night market', 'restaurant', -8.6469, 115.1379, 2,
   'Cheap satay and smoothie bowls. Everything closes by ten.'),
  -- Denpasar / Bali: Seminyak
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
    and p.intent_date = current_date + s.day_offset
);
