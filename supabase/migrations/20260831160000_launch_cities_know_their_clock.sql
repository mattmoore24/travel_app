-- Launch cities know their clock
-- =============================================================================
--
-- No timezone existed anywhere in the schema, and the four launch cities span
-- thirteen hours. Two consumers need it:
--
--   * The map. A defaulted map now resolves its city by, among other things,
--     the launch city whose clock matches the device's
--     (Intl.DateTimeFormat().resolvedOptions().timeZone on the client, and
--     ONLY that: never a location read, so section 7 rule 2 stays intact).
--     And "today" on a city-scoped map is the CITY's today, which needs the
--     city's real zone rather than a longitude approximation.
--
--   * Any scheduled push. "18:00 the night before your trip" scheduled in UTC
--     is 01:00 in Bangkok; the column exists before the first such job does,
--     deliberately.
--
-- A plain column add, no function signatures touched: launch_cities carries
-- TABLE-level SELECT grants for anon and authenticated (20260816210000 and
-- 20260817190000), so `select *` keeps working, and the app's own read path
-- names its columns (src/features/pins/api.ts).

alter table public.launch_cities
  add column timezone text not null default 'UTC';

update public.launch_cities lc
set timezone = tz.zone
from (
  values
    ('Bangkok', 'TH', 'Asia/Bangkok'),
    ('Denpasar', 'ID', 'Asia/Makassar'),
    ('Lisbon', 'PT', 'Europe/Lisbon'),
    ('Mexico City', 'MX', 'America/Mexico_City')
) as tz(city, country, zone)
join public.cities c on c.name = tz.city and c.country_code = tz.country
where lc.city_id = c.id;

-- Every future launch city states its clock on purpose.
alter table public.launch_cities
  alter column timezone drop default;

-- A typo'd IANA name would otherwise surface as an error inside whatever
-- cron job first evaluates `now() at time zone timezone`, where nobody sees
-- it. Validated at write time instead. The probe timestamp is fixed so the
-- function is honestly immutable: a zone name's validity does not depend on
-- when it is asked.
create function public.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
as $$
begin
  perform timezone(tz, timestamptz '2026-01-01 00:00:00+00');
  return true;
exception when others then
  return false;
end
$$;

alter table public.launch_cities
  add constraint launch_cities_timezone_parses
  check (public.is_valid_timezone(timezone));

comment on column public.launch_cities.timezone is
  'IANA zone name for the city''s own clock. The map''s "today", the '
  'timezone step of the defaulted-city resolution, and any scheduled push '
  'all hang off this; is_valid_timezone gates it so a typo raises at write '
  'time and not inside a cron job.';

notify pgrst, 'reload schema';
