-- Every city knows its clock.
--
-- The only IANA zone in the schema was launch_cities.timezone, added on
-- 2026-08-31 for the four cities the founder had opened, because "18:00 the
-- night before" and "an hour after the pin disappears" are questions about a
-- city's own wall clock and round(lng / 15) puts Bangkok an hour out. The
-- founder has since decided that a traveler can put a trip or a pin in ANY
-- city (docs/PROGRESS.md, 2026-09-04), so every city needs the same answer.
--
-- The column lands here; the data lands in the generated migration right
-- after this one (scripts/generate-cities-seed.mjs, geo-tz against each
-- city's coordinate); the CHECK that every value is a zone Postgres knows
-- lands in 20260904120000, after the rows do, so a bad row fails loudly at
-- deploy rather than silently at 18:00.

alter table public.cities
  add column if not exists timezone text;

comment on column public.cities.timezone is
  'IANA zone for the city''s own wall clock, looked up from its coordinate at '
  'seed time. Read through public.city_clock_zone(), which lets a launch '
  'city''s hand-set zone override it. Null only for a row seeded before this '
  'column existed and never refreshed; the reader falls back to UTC.';
