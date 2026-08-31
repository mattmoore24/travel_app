-- Every table in public has row-level security, and the readable ones still read
--
-- Supabase's linter emailed the founder on 2026-08-26 about five tables in
-- `public` with RLS disabled. It was right that they were undefended and
-- wrong that they were exposed - the grants had been narrowed by hand on
-- every one. This suite makes both halves permanent: nothing new ships
-- without RLS, and the two tables that are MEANT to be read still are.
--
-- The second half matters more than it looks. RLS with no policy does not
-- raise, it returns zero rows, so forgetting a policy on public reference
-- data looks like an empty city search rather than an error, and would sail
-- past a suite that only checked the flag.
begin;
select plan(14);

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.member() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000c1',
                      'role', 'authenticated')::text, true);
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
  ('00000000-0000-0000-0000-0000000000c1', 'cass@example.com');


-- 1. The standing guard ------------------------------------------------------
--
-- Named rather than counted: a count tells you the number is wrong, a name
-- tells you which table somebody added.

select is_empty(
  $$ select c.relname::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
     order by 1 $$,
  'every table in public has row-level security enabled');

-- The five the linter found, asserted one at a time so a regression says
-- which one came back.
select ok(
  (select relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t),
  format('%s has RLS', t))
from unnest(array['app_config', 'cities', 'launch_cities',
                  'moderation_blocklist', 'worker_invoke_log']) as t;


-- 2. The readable two still read ---------------------------------------------
--
-- This is the half that breaks silently. Both are read by SECURITY INVOKER
-- paths - search_cities as anon on the signed-out city search, get_matches
-- joining cities for the card, and the client reading launch_cities straight
-- for the map's city rail.

select pg_temp.admin();
insert into public.launch_cities (city_id, active, timezone)
select id, true, 'Europe/Lisbon' from public.cities where name = 'Lisbon' and country_code = 'PT'
on conflict (city_id) do update set active = true;

select pg_temp.guest();
select isnt_empty(
  $$ select id from public.cities limit 1 $$,
  'a signed-out visitor still reads the city list');
select isnt_empty(
  $$ select public.search_cities('Lisb') $$,
  'and city search, which reads cities as the caller, still returns rows');
select isnt_empty(
  $$ select city_id from public.launch_cities where active $$,
  'and the launch cities behind the map rail');

select pg_temp.member();
select isnt_empty(
  $$ select id from public.cities limit 1 $$,
  'and so does a signed-in traveler');


-- 3. The three nobody may touch ----------------------------------------------
--
-- Belt and braces: the grants already deny these, and now the policy does
-- too. Reading returns no rows rather than raising, because the grant check
-- is what raises and these assert the RLS half.

select pg_temp.admin();
insert into public.app_config (key, value) values ('rls_probe', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

select pg_temp.guest();
select throws_ok(
  $$ select count(*) from public.app_config $$,
  '42501', null,
  'app_config is refused outright, grant first and policy behind it');
select throws_ok(
  $$ select count(*) from public.moderation_blocklist $$,
  '42501', null,
  'so is the screening blocklist, which is the one a reader could exploit');
select throws_ok(
  $$ select count(*) from public.worker_invoke_log $$,
  '42501', null,
  'and the worker log');


-- 4. Read-only means read-only ------------------------------------------------
--
-- The reference tables got a SELECT policy and nothing else, so even the
-- roles that can read them cannot change them.

select pg_temp.member();
select throws_ok(
  $$ delete from public.cities where id = (select id from public.cities limit 1) $$,
  '42501', null,
  'and nobody deletes a city, which is the thing the email actually warned about');

select * from finish();
rollback;
