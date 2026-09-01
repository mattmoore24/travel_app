-- A typo is not a hijack, and a hijack is still a hijack.
--
-- `business_rename_resets` is an anti-impersonation control: it exists to
-- stop somebody verifying a surf shack and then renaming it to the Marriott
-- (20260827120000:477-481). 20260902100000 narrowed it so that fixing an
-- accent or nudging the marker onto the actual door no longer costs the
-- badge, and the only interesting question about a narrowed control is
-- whether the attack still trips it. So this is written as the attack: the
-- three cases that MUST still reset come first in intent, and the two that
-- must not are the ones the narrowing bought.
--
-- Run as the owner of the table rather than through RLS. The trigger is
-- `before update` and `security definer`, so it fires on any update from any
-- role, and what is under test is the trigger's arithmetic, not who may reach
-- it — 22_business_listing.test.sql already owns that half.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'shack@example.com');

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- A real launch city, so the case is the one an owner could actually reach.
create function pg_temp.elsewhere() returns int language sql as
  $$ select id from public.cities
      where name = 'Mexico City' and country_code = 'MX' $$;

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where owner_user_id
       = '00000000-0000-0000-0000-0000000000f1' $$;

-- A listed, verified business, put into the state the badge is worth
-- something in. `register_business` inserts it as 'unconfirmed' with no
-- verified_at; the update below is the shape confirm_business_email and
-- apply_business_verification_verdict leave behind.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000f1',
                    'role', 'authenticated')::text, true);
set local role authenticated;
select public.register_business('Cafe Janis', 'cafe', pg_temp.lisbon(), 38.7108, -9.1400);
reset role;
select set_config('request.jwt.claims', '', true);

update public.businesses set
  state = 'listed', listed_at = now(), verified_at = now()
where id = pg_temp.biz();

-- A snapshot to put the row back between cases, so each one starts from the
-- same listed-and-verified business rather than from whatever the last case
-- left behind.
create function pg_temp.relist() returns void language sql as $$
  update public.businesses set
    name = 'Cafe Janis',
    city_id = (select id from public.cities
                where name = 'Lisbon' and country_code = 'PT'),
    lat = 38.7108, lng = -9.1400,
    state = 'listed', listed_at = now(), verified_at = now()
  where owner_user_id = '00000000-0000-0000-0000-0000000000f1';
$$;

select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'listed',
  'the fixture starts listed'
);
select isnt(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'and verified'
);

-- ---------------------------------------------------------------------------
-- 1. An accent is not a rename
-- ---------------------------------------------------------------------------
--
-- The correction the old trigger punished hardest, and the one an owner is
-- most likely to make: the sign says Café and the listing says Cafe.

update public.businesses set name = 'Café Janis' where id = pg_temp.biz();

select is(
  (select name from public.businesses where id = pg_temp.biz()),
  'Café Janis',
  'the accent is saved'
);
select isnt(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'and it costs nothing: the check survives an accent'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'listed',
  'and the business stays on the map'
);

-- Capitals and stray whitespace are the same class of correction.
select pg_temp.relist();
update public.businesses set name = '  cafe   JANIS ' where id = pg_temp.biz();

select isnt(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'case and collapsed whitespace do not reset the check either'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'listed',
  'nor the listing'
);

-- ---------------------------------------------------------------------------
-- 2. A ten-metre nudge is not a move
-- ---------------------------------------------------------------------------
--
-- Roughly 11 metres north, which is the difference between the middle of the
-- road and the door. 0.0001 degrees of latitude is about 11.1m anywhere.

select pg_temp.relist();
update public.businesses set lat = 38.7109 where id = pg_temp.biz();

select isnt(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'a ten-metre nudge onto the door keeps the check'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'listed',
  'and keeps the business on the map'
);

-- ---------------------------------------------------------------------------
-- 3. THE ATTACK. A surf shack cannot walk to the Marriott
-- ---------------------------------------------------------------------------

select pg_temp.relist();
update public.businesses set name = 'Marriott' where id = pg_temp.biz();

select is(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'a real rename still burns the check'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'unconfirmed',
  'and still takes the business off the map until a new code goes in'
);

-- ---------------------------------------------------------------------------
-- 4. Half a kilometre is a different building
-- ---------------------------------------------------------------------------
--
-- 0.005 degrees of latitude is about 555m, comfortably past the 75m line and
-- comfortably short of leaving Lisbon's radius, so the geofence is not what
-- this is measuring.

select pg_temp.relist();
update public.businesses set lat = 38.7158 where id = pg_temp.biz();

select is(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'a half-kilometre move burns the check'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'unconfirmed',
  'and takes the business off the map'
);

-- ---------------------------------------------------------------------------
-- 5. A city change, unconditionally
-- ---------------------------------------------------------------------------

select pg_temp.relist();
update public.businesses set city_id = pg_temp.elsewhere() where id = pg_temp.biz();

select is(
  (select verified_at from public.businesses where id = pg_temp.biz()),
  null,
  'changing city burns the check even with the marker untouched'
);
select is(
  (select state::text from public.businesses where id = pg_temp.biz()),
  'unconfirmed',
  'and takes the business off the map'
);

select * from finish();
rollback;
