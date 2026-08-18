-- Cold-start content for the launch cities.
--
-- An empty app tests nothing: with no pins the map is a "be the first pin"
-- screen, and with no establishments the Chat tab's rooms section is blank —
-- so a tester would never see the establishment-room feature at all.
--
-- Pins are a callable function rather than a one-shot insert because seeded
-- pins expire in 48h by design (hard rule 3 caps at 72h). Re-run
-- `select public.seed_launch_pins();` every couple of days during launch.
-- Establishments are permanent, so they are seeded inline and idempotently.

create or replace function public.seed_launch_pins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
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
  );

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.seed_launch_pins() from public, anon, authenticated;

-- One real hostel room per launch city, each with its chat. Guests can read
-- these signed-out (public_preview), which is what makes the Chat tab show
-- something to a visitor who has never made an account.
--
-- Callable rather than inline for the same reason as the pins: seed content is
-- not schema. Running it as part of the migration put a second Lisbon room into
-- the test database and broke a guest-visibility assertion, which is exactly
-- the coupling to avoid.
create or replace function public.seed_launch_establishments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_chat uuid;
  v_count integer := 0;
begin
  for r in
    select * from (values
      ('Lisbon',      'PT', 'Home Lisbon Hostel', 38.7108,  -9.1400),
      ('Mexico City', 'MX', 'Casa Pepe',          19.4340,  -99.1330),
      ('Bangkok',     'TH', 'Once Again Hostel',  13.7540, 100.5010),
      ('Denpasar',    'ID', 'Puri Garden Ubud',   -8.5060, 115.2620)
    ) as e(city_name, country, name, lat, lng)
  loop
    if exists (
      select 1 from public.establishments x
      join public.cities c on c.id = x.city_id
      where x.name = r.name and c.name = r.city_name and c.country_code = r.country
    ) then
      continue;
    end if;

    insert into public.chats (kind) values ('room') returning id into v_chat;

    insert into public.establishments (city_id, name, kind, lat, lng, chat_id, public_preview)
    select c.id, r.name, 'hostel', r.lat, r.lng, v_chat, true
    from public.cities c
    join public.launch_cities lc on lc.city_id = c.id and lc.active
    where c.name = r.city_name and c.country_code = r.country;

    -- Inactive or unknown city: the establishment insert did nothing, so drop
    -- the orphan chat rather than leaving it dangling.
    if exists (select 1 from public.establishments where chat_id = v_chat) then
      v_count := v_count + 1;
    else
      delete from public.chats where id = v_chat;
    end if;
  end loop;

  return v_count;
end
$$;

revoke all on function public.seed_launch_establishments() from public, anon, authenticated;
