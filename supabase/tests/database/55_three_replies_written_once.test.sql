-- An owner's three saved replies are private notes, and only theirs.
--
-- Written as attacks, because the whole feature is a promise about who can
-- read a table. A saved reply is never delivered to anybody: the owner taps
-- it into their own composer and sends it as an ordinary message. So the
-- traveler on the other side of that conversation must never be able to read
-- the script they are being answered from, and neither must the bar across
-- the street.
--
-- The rest is the shape: three slots numbered 0 to 2, one row per slot, and a
-- body that is actually a body.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a55', 'ana-55@example.com'),
  ('00000000-0000-0000-0000-000000000b55', 'azul-55@example.com'),
  ('00000000-0000-0000-0000-000000000c55', 'verde-55@example.com');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  reset role;
end
$$;

-- Fixture FUNCTIONS, not temp tables: `set local role authenticated` has no
-- privileges on anything in pg_temp, and every assertion below runs after
-- that switch (traps, pgTAP).
create function pg_temp.azul() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Azul 55' $$;
create function pg_temp.verde() returns uuid language sql as
  $$ select id from public.businesses where name = 'Bar Verde 55' $$;

-- What is really in the table, whoever is logged in. An attack that is
-- refused by RLS is a statement that changes nothing rather than one that
-- raises, so proving it failed means reading the row from outside the policy.
create function pg_temp.saved(slot int) returns text language sql
security definer set search_path = public as
  $$ select body from public.business_saved_replies
     where business_id = pg_temp.azul() and position = slot $$;
create function pg_temp.saved_count() returns int language sql
security definer set search_path = public as
  $$ select count(*)::int from public.business_saved_replies
     where business_id = pg_temp.azul() $$;

update public.profiles set
  display_name = 'Ana', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-000000000a55';

select pg_temp.login('00000000-0000-0000-0000-000000000b55');
select public.register_business('Casa Azul 55', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);
select pg_temp.login('00000000-0000-0000-0000-000000000c55');
select public.register_business('Bar Verde 55', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7120, -9.1420);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
  where name in ('Casa Azul 55', 'Bar Verde 55');

-- WHAT THE OWNER CAN DO -----------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-000000000b55');

select lives_ok(
  $$ insert into public.business_saved_replies (business_id, position, body) values
       (pg_temp.azul(), 0, 'Beds tonight, yes. Come by after six.'),
       (pg_temp.azul(), 1, 'Kitchen closes at eleven.'),
       (pg_temp.azul(), 2, 'We are full tonight, sorry.') $$,
  'an owner writes their three replies'
);
select is(
  (select count(*)::int from public.business_saved_replies where business_id = pg_temp.azul()),
  3,
  'and reads all three back'
);

select lives_ok(
  $$ update public.business_saved_replies set body = 'Kitchen closes at midnight.'
     where business_id = pg_temp.azul() and position = 1 $$,
  'and can rewrite one'
);
select is(pg_temp.saved(1), 'Kitchen closes at midnight.', 'and the rewrite lands');

-- THE SHAPE -----------------------------------------------------------------

select throws_ok(
  $$ insert into public.business_saved_replies (business_id, position, body)
     values (pg_temp.azul(), 3, 'A fourth one.') $$,
  '23514',
  null,
  'there is no fourth slot'
);
select throws_ok(
  $$ insert into public.business_saved_replies (business_id, position, body)
     values (pg_temp.azul(), 1, 'Another line for slot one.') $$,
  '23505',
  null,
  'and one slot holds one reply'
);
select throws_ok(
  $$ update public.business_saved_replies set body = ''
     where business_id = pg_temp.azul() and position = 0 $$,
  '23514',
  null,
  'an empty reply is not a reply'
);
select throws_ok(
  $$ update public.business_saved_replies set body = repeat('x', 501)
     where business_id = pg_temp.azul() and position = 0 $$,
  '23514',
  null,
  'and neither is five hundred and one characters'
);

-- THE BAR ACROSS THE STREET -------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-000000000c55');

select is(
  (select count(*)::int from public.business_saved_replies where business_id = pg_temp.azul()),
  0,
  'another business sees none of them'
);
-- RLS answers a write it refuses by matching no rows, so the proof is that
-- the row is unchanged rather than that the statement raised.
select lives_ok(
  $$ update public.business_saved_replies set body = 'Ask next door instead.'
     where business_id = pg_temp.azul() $$,
  'their update runs'
);
select is(pg_temp.saved(1), 'Kitchen closes at midnight.', 'and changes nothing');
select lives_ok(
  $$ delete from public.business_saved_replies where business_id = pg_temp.azul() $$,
  'their delete runs'
);
select is(pg_temp.saved_count(), 3, 'and deletes nothing');
select throws_ok(
  $$ insert into public.business_saved_replies (business_id, position, body)
     values (pg_temp.azul(), 0, 'Put words in their mouth.') $$,
  '42501',
  null,
  'and they cannot write a reply into somebody else''s business'
);

-- THE TRAVELER BEING ANSWERED -----------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-000000000a55');
select is(
  (public.message_business(pg_temp.azul(), 'Any beds left on the 4th?')) ->> 'blocked',
  'false',
  'a traveler is in a conversation with the business'
);
select is(
  (select count(*)::int from public.business_saved_replies where business_id = pg_temp.azul()),
  0,
  'and still cannot read the replies they are being answered from'
);

-- NOBODY AT ALL -------------------------------------------------------------

select pg_temp.guest();
select throws_ok(
  $$ select count(*) from public.business_saved_replies $$,
  '42501',
  null,
  'anon has no grant on the table at all'
);

-- AND THE OWNER CAN TAKE ONE BACK DOWN --------------------------------------

select pg_temp.login('00000000-0000-0000-0000-000000000b55');
select lives_ok(
  $$ delete from public.business_saved_replies
     where business_id = pg_temp.azul() and position = 2 $$,
  'an owner can take one down'
);
select is(pg_temp.saved_count(), 2, 'and the other two stay');

select * from finish();
rollback;
