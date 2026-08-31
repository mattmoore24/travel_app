-- "I am part way through listing a business" is the account's own fact.
--
-- Written as the attack, because the interesting question is not "does the
-- flag store" but "what can one account learn or do about another's". The
-- flag says somebody is in the middle of putting a bar on the map, and
-- profiles_select_visible lets any authenticated account read a visible
-- traveler's row, so a column grant would have published it to everybody.
-- There is no grant, and neither function takes a user id.
begin;
select plan(10);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'nosy@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'traveler@example.com');

-- A finished traveler, which is the account register_business must keep on
-- refusing however this flag is set.
update public.profiles set
  display_name = 'Bea', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000e3';

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- ---------------------------------------------------------------------------
-- The default, and setting your own
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');

select is(
  public.listing_intent(),
  false,
  'an account that has never started a listing is not carrying the flag'
);

select is(
  public.set_listing_intent(true),
  true,
  'set_listing_intent answers with what it stored, so nothing has to read the column back'
);

select is(
  public.listing_intent(),
  true,
  'and the account is carrying it afterwards'
);

-- ---------------------------------------------------------------------------
-- The attack: reading somebody else's
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');

select throws_ok(
  $$ select wants_business from public.profiles
      where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'a second account cannot select the column off the first one'
);

-- The same refusal on its own row, which is the point: there is no grant at
-- all, so the only way in is the function.
select throws_ok(
  $$ select wants_business from public.profiles where user_id = auth.uid() $$,
  '42501',
  null,
  'and cannot select it off its own row either: the column is server-owned'
);

select is(
  public.listing_intent(),
  false,
  'listing_intent answers for the caller and nobody else'
);

-- ---------------------------------------------------------------------------
-- The attack: setting somebody else's
-- ---------------------------------------------------------------------------

select is(
  public.set_listing_intent(true),
  true,
  'the second account can set its own'
);

select pg_temp.admin();
select is(
  (select wants_business from public.profiles
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  true,
  'and the first account is untouched by it: there is no parameter for whose flag to set'
);

-- ---------------------------------------------------------------------------
-- Clearing it, and the guard the flag must not weaken
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.set_listing_intent(false);
select is(
  public.listing_intent(),
  false,
  'and it comes back down when the listing is done or abandoned'
);

-- A finished traveler carrying the flag is still a traveler. The flag changes
-- which stack the app mounts; it must never change what the server allows.
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select public.set_listing_intent(true);
select throws_ok(
  $$ select public.register_business(
       'Casa Verde', 'cafe'::public.business_category, (select pg_temp.lisbon()),
       38.7108, -9.1400) $$,
  'this account is already a traveler',
  'register_business still refuses an account that has finished traveler onboarding'
);

select * from finish();
rollback;
