-- The database ships user-facing copy: the curated pin notes are the app's
-- voice on day one, before any real traveler has posted anything. The design
-- brief bans em dashes in anything the app shows, so the live seeder must
-- write none. chr(8212) is U+2014, spelled out so this file itself carries no
-- em dash inside a literal.
begin;
select plan(4);

-- Wipe and reseed from the live function (service path; suite runs as owner).
delete from public.pins where seeded;
select ok(
  public.seed_launch_pins() > 0,
  'the seeder puts curated pins on the map'
);
select is(
  (select count(*)::int from public.pins where seeded),
  20,
  'all twenty curated pins land across the four launch cities'
);
select is(
  (select count(*)::int from public.pins where seeded and seed_note is not null),
  16,
  'sixteen of them carry a note'
);
select is(
  (select count(*)::int from public.pins
   where seeded and seed_note like '%' || chr(8212) || '%'),
  0,
  'no curated pin note contains an em dash'
);

select * from finish();
rollback;
