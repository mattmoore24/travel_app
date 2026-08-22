-- The map has been empty since 2026-08-20, and nothing was broken.
--
-- seed_launch_pins() (20260818010000) puts twenty curated pins across the four
-- launch cities, and its own header says: "Re-run `select
-- public.seed_launch_pins();` every couple of days during launch." Nobody did.
-- Seeded pins expire in 48h by design (rule 3 caps every pin at 72h), so two
-- days after that migration deployed the map went back to "be the first to
-- drop a pin" and stayed there. The founder reported it as "I'm not seeing any
-- pins or travelers on the map".
--
-- A comment asking a human to remember something every 48 hours is not a
-- mechanism. This schedules it, next to the four workers that already run this
-- way, and runs it once now so the map is populated the moment this deploys.

-- 1. Refresh the curated pins daily ------------------------------------------
-- Daily against a 48h expiry, so a single missed run still leaves a day of
-- slack before the map empties. The function is idempotent: it skips any venue
-- that still has a live seeded pin, so a run costs nothing when nothing died.

-- The immediate call lives inside the guard too, and that is deliberate. This
-- migration runs against the throwaway cluster in scripts/db-test.sh as well
-- as against Supabase, and twenty curated Lisbon pins appearing mid-suite
-- breaks every later assertion that counts pins (proven: it took out four
-- assertions in 06 and the whole of 10 on the first run). pg_cron is the same
-- condition the four existing workers use to mean "this is a real deployment",
-- and if it were ever absent in production the schedule would not exist either,
-- so nothing is lost by tying both to it.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 04:10 UTC: after expire-pins has swept, before Asia wakes up.
    perform cron.schedule(
      'seed-launch-pins',
      '10 4 * * *',
      'select public.seed_launch_pins()'
    );
    -- Populate now, not at 04:10 tomorrow.
    perform public.seed_launch_pins();
  end if;
end
$$;

-- 2. Heat that can actually appear -------------------------------------------
-- The k-threshold was applied per (cell, category), so a corner needed three
-- different people planning the same KIND of thing within the same 550m square
-- before it glowed. Across four launch cities and twenty curated pins that has
-- never once happened, which is why no screenshot in any run has ever shown
-- heat.
--
-- Grouping by cell alone is both the fix and the safer version: a bucket that
-- passes k with three people spread across bar, food and museum is a LARGER
-- and more anonymous bucket than one that needs three bar-goers, and the row
-- now carries one fewer attribute about them. Rule 6 asks that a cell never
-- resolve to a person; widening the bucket moves further from that, not closer.
--
-- The client already sums the categories together (features/pins/heat.ts) and
-- never used the category for anything, so nothing on the drawing side changes.
--
-- AGENTS.md: dropping an OUT column needs `drop function` first, and the grants
-- have to be restated afterwards.

drop function if exists public.heat_cells(int, date);

create function public.heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
as $$
declare
  v_k int;
begin
  select heat_k into v_k
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return; -- unknown or inactive city: no heat
  end if;

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    count(distinct coalesce(p.user_id::text, p.id::text))::int
  from public.pins p -- caller's RLS applies here
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
  group by 1, 2
  having count(distinct coalesce(p.user_id::text, p.id::text)) >= v_k;
end
$$;

revoke execute on function public.heat_cells(int, date) from public, anon;
grant execute on function public.heat_cells(int, date) to authenticated;

drop function if exists public.public_heat_cells(int, date);

create function public.public_heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  pin_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_k int;
begin
  select heat_k into v_k
  from public.launch_cities
  where city_id = p_city_id and active;
  if v_k is null then
    return;
  end if;

  return query
  select
    (floor(p.lat / 0.005) * 0.005 + 0.0025)::double precision,
    (floor(p.lng / 0.005) * 0.005 + 0.0025)::double precision,
    count(distinct coalesce(p.user_id::text, p.id::text))::int
  from public.pins p
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
    -- A definer runs no policies, so the visibility rules the authenticated
    -- function gets from RLS have to be restated here by hand.
    and (p.seeded or public.is_discoverable_owner(p.user_id))
  group by 1, 2
  having count(distinct coalesce(p.user_id::text, p.id::text)) >= v_k;
end
$$;

grant execute on function public.public_heat_cells(int, date) to anon, authenticated;
