-- A business goes where its door is (20260905130000).
--
-- Founder: "businesses shouldn't be limited on where they can put their pin
-- ... full flexibility and scalability than forcing business users to pick
-- from preset cities set by me". So the launch-city fence on the business
-- path is gone, and the server files a listing under the city its marker is
-- in: the client's hint stands within 20 km, else nearest_city, else the
-- nearest city on earth by plain distance. Never a refusal on geography.
--
-- Written as attacks: a forged hint, a hint from the wrong city, a marker in
-- the middle of the ocean, a nudge that must not cost a badge, a move that
-- must, a guest at the preview door, and rule 8 asked again with no hint to
-- hide behind. The last block is the label-or-circle predicate the three
-- city feeds share, proven from both sides.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ana@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'midtown@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'monaco@example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'croisette@example.com'),
  ('00000000-0000-0000-0000-0000000000b4', 'atlantic@example.com'),
  ('00000000-0000-0000-0000-0000000000b5', 'forged@example.com'),
  ('00000000-0000-0000-0000-0000000000b6', 'cascais@example.com');

-- One finished traveler, for the rule 8 attack at the end. Everybody else
-- stays an unfinished profile, which is what a business account is.
update public.profiles set
  display_name = 'Ana', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000a1';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- pg_temp FUNCTIONS, not a fixture table (the traps skill: an authenticated
-- role has no privileges on pg_temp tables). Looked up by name and country,
-- never by a hardcoded GeoNames id.
create function pg_temp.city(p_name text, p_country text) returns int language sql as
  $$ select id from public.cities where name = p_name and country_code = p_country
     order by population desc limit 1 $$;
create function pg_temp.lisbon() returns int language sql as $$ select pg_temp.city('Lisbon', 'PT') $$;
create function pg_temp.porto() returns int language sql as $$ select pg_temp.city('Porto', 'PT') $$;
create function pg_temp.cascais() returns int language sql as $$ select pg_temp.city('Cascais', 'PT') $$;
create function pg_temp.nyc() returns int language sql as $$ select pg_temp.city('New York City', 'US') $$;
create function pg_temp.hoboken() returns int language sql as $$ select pg_temp.city('Hoboken', 'US') $$;
create function pg_temp.nice() returns int language sql as $$ select pg_temp.city('Nice', 'FR') $$;
create function pg_temp.cannes() returns int language sql as $$ select pg_temp.city('Cannes', 'FR') $$;

-- =============================================================================
-- NO HINT AT ALL
-- =============================================================================

-- The new client sends p_city_id null on registration: the marker is the
-- only thing it knows. Midtown is 3 km from Hoboken's centre and 5 km from
-- New York's; nearest_city's weighting answers New York, as it does for a pin.
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.register_business('Midtown Bar', 'bar', null, 40.754, -73.984) $$,
  'a business with no city hint at all is saved'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Midtown Bar'),
  pg_temp.nyc(),
  'and filed under New York City, not Hoboken, with no hint to lean on'
);

-- =============================================================================
-- A HINT INSIDE ITS ORBIT STANDS; PAST IT THE MARKER DECIDES
-- =============================================================================

-- Monaco is 13 km from Nice's centre: the same orbit.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  format($$ select public.register_business('Monaco Bar', 'bar', %s, 43.7384, 7.4246) $$,
         pg_temp.nice()),
  'a hint 13 km away is accepted'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Monaco Bar'),
  pg_temp.nice(),
  'and stands, as it does for a pin: 13 km is the same orbit'
);

-- The Croisette is 26 km from Nice's centre: past the orbit.
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select lives_ok(
  format($$ select public.register_business('Croisette Cafe', 'cafe', %s, 43.5528, 7.0174) $$,
         pg_temp.nice()),
  'a Nice hint on the Croisette is accepted'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Croisette Cafe'),
  pg_temp.cannes(),
  'past 20 km the marker decides: Cannes'
);

-- =============================================================================
-- NOWHERE NEAR ANYWHERE
-- =============================================================================

-- A pin in the middle of the Atlantic keeps the city the traveler was
-- browsing. A business has no browsed city, and businesses.city_id is NOT
-- NULL, so the third tier answers the nearest city on earth by plain
-- distance rather than refusing. Asserted by recomputing it, not by naming
-- a city: if the seed moves, both sides move together.
select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select lives_ok(
  $$ select public.register_business('Mid Atlantic', 'hostel', null, 30, -40) $$,
  'a marker with no city within 55 km is still saved'
);
select pg_temp.admin();
select isnt(
  (select city_id from public.businesses where name = 'Mid Atlantic'),
  null,
  'and filed under the nearest city there is'
);
select is(
  (select city_id from public.businesses where name = 'Mid Atlantic'),
  (select c.id from public.cities c
    order by public.haversine_km(30, -40, c.lat, c.lng), c.population desc, c.id
    limit 1),
  'which is the nearest by plain distance'
);

-- =============================================================================
-- A FORGED HINT
-- =============================================================================

-- A client can send any integer. One that is no cities row finds nothing in
-- the first tier and falls through, so the marker decides as if no hint had
-- been sent.
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select lives_ok(
  $$ select public.register_business('Forged Bar', 'bar', -1, 38.7108, -9.1400) $$,
  'a forged hint that is no city does not break registration'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Forged Bar'),
  pg_temp.lisbon(),
  'and is ignored: the marker decides'
);

-- =============================================================================
-- THE BADGE SURVIVES A NUDGE, AND NOT A MOVE
-- =============================================================================

-- Listed and verified, in two statements as 50's relist() does: the trigger
-- is BEFORE UPDATE and stamps the anchor (verified_lat/verified_lng) in the
-- statement that grants the badge, so granting it in the same statement as
-- the relisting would have nothing to anchor to.
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now() where name = 'Monaco Bar';
update public.businesses set verified_at = now() where name = 'Monaco Bar';

-- Thirty metres. The stored city is the hint, the marker is still 13 km from
-- Nice, so city_id cannot change; and 30 m is under the 75 m the trigger
-- measures from the anchor. Neither branch of business_rename_resets fires.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  $$ select public.update_business_location(43.7386, 7.4248) $$,
  'a 30 m nudge saves'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Monaco Bar'),
  pg_temp.nice(),
  'and keeps the stored city, so the badge branch on city_id cannot fire for a nudge'
);
select isnt(
  (select verified_at from public.businesses where name = 'Monaco Bar'),
  null,
  'and keeps the badge'
);

-- Forty kilometres, to Cannes. The stored Nice hint is now 26 km away, so
-- the listing is re-filed, and a re-filing is always a move the trigger
-- resets on.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  $$ select public.update_business_location(43.5528, 7.0174) $$,
  'a move to Cannes saves'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Monaco Bar'),
  pg_temp.cannes(),
  'and re-files the listing under Cannes'
);
select is(
  (select verified_at from public.businesses where name = 'Monaco Bar'),
  null,
  'and costs the badge, as any move that far did before'
);

-- =============================================================================
-- A CITY NOBODY LAUNCHED IN
-- =============================================================================

-- Cascais has no launch_cities row and never will. Yesterday this was the
-- refusal 'we have not launched in that city yet'.
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select lives_ok(
  $$ select public.register_business('Cascais Surf', 'bar', null, 38.6979, -9.4215) $$,
  'a Cascais door with no hint is saved'
);
select pg_temp.admin();
select is(
  (select city_id from public.businesses where name = 'Cascais Surf'),
  pg_temp.cascais(),
  'and filed under Cascais'
);

-- =============================================================================
-- THE LABEL OR THE CIRCLE
-- =============================================================================
--
-- Cascais is 25 km from Lisbon's centre, inside map_radius_km(), so its door
-- draws on the Lisbon map the way a Cascais pin does: the circle. Mid
-- Atlantic is well over 50 km from the centre of the city it is filed under,
-- so the circle alone would drop it from every map; the label keeps it on
-- its own city's. city_rooms and city_whats_on share the predicate, so the
-- room list and What's on agree with the markers.

select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
  where name in ('Cascais Surf', 'Mid Atlantic');

select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
insert into public.business_posts (business_id, title)
  values ((select id from public.businesses where name = 'Cascais Surf'), 'Sunset session');

select pg_temp.guest();
select is(
  (select count(*)::int from public.city_businesses(pg_temp.lisbon()) where name = 'Cascais Surf'),
  1,
  'a Cascais business draws on the Lisbon map: the map is a circle, like pins'
);
select is(
  (select count(*)::int from public.city_businesses(pg_temp.porto()) where name = 'Cascais Surf'),
  0,
  'but not on Porto''s'
);
select is(
  (select count(*)::int from public.city_rooms(pg_temp.lisbon()) where name = 'Cascais Surf'),
  1,
  'and its room is in Lisbon''s list'
);
select is(
  (select count(*)::int from public.city_whats_on(pg_temp.lisbon()) where title = 'Sunset session'),
  1,
  'and its post is on Lisbon''s What''s on: the two feeds agree'
);

-- As admin: the subselect reads businesses.city_id by name, and the row's
-- listed state is nobody's to read at the table but the owner's and the
-- service role's.
select pg_temp.admin();
select is(
  (select count(*)::int from public.city_businesses(
     (select city_id from public.businesses where name = 'Mid Atlantic'))
    where name = 'Mid Atlantic'),
  1,
  'and a listing far from its city''s centre is still on that city''s map: the label keeps it'
);

-- =============================================================================
-- THE PREVIEW DOOR
-- =============================================================================

-- "That puts you in Lisbon, Portugal." is served by city_for_spot, which
-- answers only a signed-in caller: a guest has no marker to place and no
-- business to file, and the resolver behind it is not a public geocoder.
select pg_temp.guest();
select throws_ok(
  $$ select public.city_for_spot(38.71, -9.14) $$,
  '42501',
  null,
  'a guest cannot ask which city a spot is in'
);
select throws_ok(
  $$ select public.resolve_business_city(38.71, -9.14) $$,
  '42501',
  null,
  'nor call the resolver'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select public.city_for_spot(41.1496, -8.6109) ->> 'name'),
  'Porto',
  'the client can ask where a marker will be filed'
);
select is(
  (select public.city_for_spot(43.7384, 7.4246, pg_temp.nice()) ->> 'name'),
  'Nice',
  'and the hint rule is the same one the write uses'
);

-- =============================================================================
-- RULE 8, RESTATED WITH NO HINT TO HIDE BEHIND
-- =============================================================================

-- Dropping the fence dropped two refusals. The three about the ACCOUNT are
-- still there, word for word.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.register_business('Ana Bar', 'bar', null, 38.71, -9.14) $$,
  'this account is already a traveler',
  'a finished traveler still cannot become a business, hint or no hint'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$ select public.register_business('Second Bar', 'bar', null, 38.71, -9.14) $$,
  'this account already runs a business',
  'and one account still owns one business'
);

select * from finish();
rollback;
