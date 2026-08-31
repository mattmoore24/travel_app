-- The database ships user-facing copy: the curated pin notes are the app's
-- voice on day one, before any real traveler has posted anything. The design
-- brief bans em dashes in anything the app shows, so the live seeder must
-- write none. chr(8212) is U+2014, spelled out so this file itself carries no
-- em dash inside a literal.
begin;
select plan(5);

-- Wipe and reseed from the live function (service path; suite runs as owner).
delete from public.pins where seeded;
select ok(
  public.seed_launch_pins() > 0,
  'the seeder puts curated pins on the map'
);
select is(
  (select count(*)::int from public.pins where seeded),
  27,
  'all twenty-seven curated pins land across the nine districts'
);
select is(
  (select count(*)::int from public.pins where seeded and seed_note is not null),
  23,
  'twenty-three of them carry a note'
);
select is(
  (select count(*)::int from public.pins
   where seeded and seed_note like '%' || chr(8212) || '%'),
  0,
  'no curated pin note contains an em dash'
);

-- The list is clustered by district on purpose (three pins per nightlife
-- district inside one 0.005-degree cell). Curated pins do not count toward
-- the heat k-threshold (D7), so this asserts the SEED DATA directly — the
-- regression that would otherwise let a later edit silently un-cluster it.
select is(
  (select count(distinct city_id)::int from (
     select city_id
     from public.pins
     where seeded
     group by city_id, floor(lat / 0.005), floor(lng / 0.005)
     having count(*) >= 3
   ) clustered),
  (select count(*)::int from public.launch_cities where active),
  'every active launch city keeps at least one district-clustered cell of curated pins'
);

select * from finish();
rollback;
