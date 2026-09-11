-- A guest can follow the map.
--
-- Founder, 2026-09-11: "I should also just be able to pan around on the map
-- and find any city without directly searching it, similar to how you can
-- on Zillow." The map follows the pan by asking city_for_spot which city
-- the settled centre is in, the same resolver a business listing is filed
-- by. It was granted to authenticated alone, because until today only a
-- signed-in owner ever asked it. A guest browses the same map and pans it
-- the same way.
--
-- WHAT THIS CHANGES. anon may execute city_for_spot. It is SECURITY DEFINER
-- over public.cities, which anon can already read in full (featured cities,
-- the city search), and it answers with one city's row: nothing a guest
-- could not already fetch, arranged by distance. nearest_city and
-- resolve_business_city stay authenticated-only; the definer calls them.

begin;

grant execute on function public.city_for_spot(double precision, double precision, int)
  to anon;

comment on function public.city_for_spot(double precision, double precision, int) is
  'Which city a spot is in, with a hint that holds within 20 km: the resolver '
  'a business listing is filed by, and since 2026-09-11 the one the map asks '
  'when it follows a pan. Executable by anon and authenticated: it reads only '
  'public.cities, which both can already read.';

notify pgrst, 'reload schema';

commit;
