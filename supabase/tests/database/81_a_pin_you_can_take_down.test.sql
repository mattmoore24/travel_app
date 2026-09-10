-- YOU CAN TAKE DOWN YOUR OWN PIN.
--
-- Broken from 2026-08-31 to 2026-09-08, in production, on a button a person
-- presses. Nothing caught it because nothing in 80 pgTAP files or five Maestro
-- tours ever deleted a pin as its owner - the suite created pins, expired them
-- through the cron path (which runs as postgres and always worked), and never
-- pressed take-down.
--
-- The trigger 20260831180000 added was SECURITY INVOKER and ran
-- `update public.groups`, while `authenticated` has only ever held select on
-- that table. So the DELETE raised 42501 and the pin stayed. It fired even for
-- users with no group at all: Postgres checks the UPDATE privilege when it
-- plans the statement, not after it matches rows.
--
-- This file is the missing counterpart. THE ROW COUNT IS THE POINT - the first
-- probe I wrote for this bug reported "DELETE SUCCEEDED" against a row that RLS
-- had filtered out, so it deleted nothing, raised nothing, and proved nothing.
-- A delete that matches no rows fires no row trigger and passes every
-- assertion you would think to write.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'pinner@example.com');

update public.profiles set
  display_name = 'Pinner', age = 30, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000f1';

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

-- The rule this file exists for, asserted before anything else: the caller must
-- NOT need UPDATE on groups to delete their own pin.
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'UPDATE'),
  'authenticated still has no UPDATE on public.groups'
);
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'groups_remember_the_plan_ended'),
  true,
  'so the stamp trigger runs as definer, or a take-down cannot work'
);

insert into public.trips (user_id, city_id, start_date, end_date)
values ('00000000-0000-0000-0000-0000000000f1',
        (select city_id from public.launch_cities limit 1),
        current_date, current_date + 5);

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

insert into public.pins (user_id, city_id, venue_name, category, lat, lng, intent_date)
select '00000000-0000-0000-0000-0000000000f1', c.id, 'A bar with a door',
       'bar', c.lat + 0.001, c.lng + 0.001, current_date
from public.cities c
join public.launch_cities lc on lc.city_id = c.id
limit 1;

select is(
  (select count(*)::int from public.pins
   where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'the pin is up'
);

-- THE ASSERTION. lives_ok alone would pass on a delete that matched nothing,
-- which is exactly how this bug hid, so the row count is checked too.
select lives_ok(
  $$ delete from public.pins where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  'the owner can take their own pin down'
);
select is(
  (select count(*)::int from public.pins
   where user_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'and it is actually gone, not merely un-erroring'
);

-- The trigger still does its job: a group whose plan has left gets stamped.
select pg_temp.admin();
select ok(
  (select prosrc like '%plan_ended_at = now()%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'groups_remember_the_plan_ended'),
  'and it still stamps plan_ended_at rather than having been gutted'
);

rollback;
