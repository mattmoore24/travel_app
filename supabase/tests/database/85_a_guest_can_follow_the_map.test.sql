-- A GUEST CAN FOLLOW THE MAP.
--
-- The map follows the pan by asking city_for_spot where its centre is, and
-- a guest pans the same map. This file proves the grant and the two answers
-- that make following work: a spot inside the browsed city answers with
-- that city, and a spot in another city answers with the other one.
begin;
select plan(4);

select ok(
  has_function_privilege(
    'anon', 'public.city_for_spot(double precision, double precision, int)', 'execute'),
  'anon may execute city_for_spot'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.city_for_spot(double precision, double precision, int)', 'execute'),
  'authenticated still may'
);

create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

set local role anon;

-- A spot in Lisbon, with Lisbon as the hint: Lisbon.
select is(
  (public.city_for_spot(38.7071, -9.1458, (select pg_temp.lisbon()))) ->> 'name',
  'Lisbon',
  'a guest asking about a Lisbon spot is answered Lisbon'
);

-- Porto, ~270 km away, with Lisbon still the hint: the hint is dropped past
-- 20 km and the answer is the city the map is actually over.
select is(
  (public.city_for_spot(41.1496, -8.6109, (select pg_temp.lisbon()))) ->> 'name',
  'Porto',
  'a guest who panned to Porto is answered Porto, hint or no hint'
);

select * from finish();
rollback;
