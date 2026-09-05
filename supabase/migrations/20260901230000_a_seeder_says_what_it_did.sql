-- The launch-venue seeders tell the truth, and stay off everybody else's rows.
--
-- Written after `select seed_launch_business_content();` returned 0 against
-- production and nobody could tell what that meant. Three defects, found by
-- reading the two functions against what the app actually requires.
--
-- 1. THE COUNTER COUNTED THE WRONG THING. v_count moved only inside the HOURS
--    branch; the links and posts branches inserted without touching it. So 0
--    meant "no venue was missing hours" and never "nothing was inserted" - the
--    run that returned 0 may well have inserted every missing link and post.
--    A diagnostic that cannot distinguish "already done" from "did nothing" is
--    not a diagnostic. It now counts VENUES TOUCHED, and raises a notice when
--    the loop matches nothing at all, which is the other reading of 0.
--
-- 2. THE POSTS GUARD DID NOT MATCH THE APP. The guard asked whether ANY post
--    row existed; city_businesses.has_live_post requires an UNARCHIVED one
--    (20260827110000_business_content.sql:468-471). archive_expired_posts runs
--    hourly at minute 7 and archives a post whose ends_at has passed, or whose
--    happens_at is more than twelve hours old. So a venue whose standing post
--    had been archived was skipped by the seeder for ever while the app went on
--    showing nothing on - and re-running the seeder could never fix it. The
--    guard now asks the same question the RPC asks. Safe by construction: the
--    loop only ever touches rows with no owner, so there is no owner whose
--    deliberate take-down this could override.
--
-- 3. THE LOOP WAS NOT SCOPED TO THE LAUNCH VENUES, and this is the one that
--    could damage real data. It walked EVERY unclaimed active business.
--    businesses.owner_user_id is `on delete set null`, so any real listing
--    whose owner's auth row goes away becomes unclaimed - and the next seeder
--    run would give that real business a fake 'https://example.com' website and
--    a post reading "Come and say hello" that its owner never wrote. The loop
--    is now driven by the same four-tuple list seed_launch_businesses() uses.
--
-- Both functions keep their signatures, so create-or-replace is correct. The
-- revokes are restated because that is the rule in this repo whether or not
-- replace preserves them.

create or replace function public.seed_launch_business_content()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
  v_seen int := 0;
  v_touched boolean;
begin
  for v_row in
    -- The four launch venues and nobody else. Matched on name, city AND
    -- country: two cities can share a name, and the country half was dropped
    -- from the sibling seeder's guard once already.
    select b.id, b.name
    from public.businesses b
    join public.cities ct on ct.id = b.city_id
    join (values
      ('Lisbon', 'PT', 'Home Lisbon Hostel'),
      ('Mexico City', 'MX', 'Casa Pepe'),
      ('Bangkok', 'TH', 'Once Again Hostel'),
      ('Denpasar', 'ID', 'Puri Garden Ubud')
    ) as launch(city_name, country_code, venue)
      on launch.venue = b.name
     and launch.city_name = ct.name
     and launch.country_code = ct.country_code
    where b.owner_user_id is null and b.active
  loop
    v_seen := v_seen + 1;
    v_touched := false;

    -- Hours. Every day, and late, because these are hostels: the point of the
    -- rows is to prove the "Open · till" line works, including past midnight.
    if not exists (select 1 from public.business_hours where business_id = v_row.id) then
      insert into public.business_hours (business_id, weekday, opens, closes)
      select v_row.id, d, time '08:00', time '01:00'
      from generate_series(0, 6) as d;
      v_touched := true;
    end if;

    if not exists (select 1 from public.business_links where business_id = v_row.id) then
      insert into public.business_links (business_id, kind, label, value, position)
      values (v_row.id, 'website', 'Website', 'https://example.com', 0);
      v_touched := true;
    end if;

    -- No end date, which is the founder's rule working: a standing notice
    -- stays up until somebody takes it down. `archived_at is null` is the
    -- whole of defect 2 above: an archived post is not a live one, and the
    -- app's has_live_post asks exactly this.
    if not exists (
      select 1 from public.business_posts
       where business_id = v_row.id and archived_at is null
    ) then
      insert into public.business_posts (business_id, title, body)
      values (
        v_row.id,
        'Come and say hello',
        'The chat here is open to anyone passing through. Swap plans with whoever is around.'
      );
      v_touched := true;
    end if;

    if v_touched then
      v_count := v_count + 1;
    end if;
  end loop;

  -- The other reading of 0, said out loud rather than left to be guessed at.
  if v_seen = 0 then
    raise notice 'seed_launch_business_content: no unclaimed active launch venue found. Run seed_launch_businesses() first, or check businesses.active.';
  else
    raise notice 'seed_launch_business_content: % launch venue(s) seen, % needed content.', v_seen, v_count;
  end if;

  return v_count;
end
$$;

revoke all on function public.seed_launch_business_content() from public, anon, authenticated;

comment on function public.seed_launch_business_content() is
  'Fills the four launch venues with hours, a link and a standing post so the '
  'first marker anybody taps opens onto something. Idempotent, and its return '
  'counts VENUES it had to touch, not rows. Scoped to the launch venues by '
  'name+city+country: it must never write content onto a real listing whose '
  'owner account was deleted.';


-- ---------------------------------------------------------------------------
-- And the venue seeder's own guard, which lost half its test.
--
-- Its predecessor matched a venue on name + city + COUNTRY
-- (20260818010000_seed_launch_content.sql:109-115); the current definition
-- dropped the country (20260827100000_business_accounts.sql:846-850), so it
-- matches on name and city name alone. City names are not unique across
-- countries, and the INSERT below it still joins on the country - so a venue
-- could be skipped as "already there" because of a same-named city elsewhere
-- while its real row was never created. Restoring the predicate is the whole
-- change; everything else is the definition as it stands.
-- ---------------------------------------------------------------------------

create or replace function public.seed_launch_businesses()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_chat uuid;
  v_count int := 0;
begin
  for v_row in
    select * from (values
      ('Lisbon', 'PT', 'Home Lisbon Hostel', 38.7108, -9.1400),
      ('Mexico City', 'MX', 'Casa Pepe', 19.4340, -99.1330),
      ('Bangkok', 'TH', 'Once Again Hostel', 13.7540, 100.5010),
      ('Denpasar', 'ID', 'Puri Garden Ubud', -8.5060, 115.2620)
    ) as t(city_name, country_code, venue, lat, lng)
  loop
    if exists (
      select 1 from public.businesses b
      join public.cities ct on ct.id = b.city_id
      where b.name = v_row.venue
        and ct.name = v_row.city_name
        and ct.country_code = v_row.country_code
    ) then
      continue;
    end if;

    insert into public.chats (kind) values ('room') returning id into v_chat;

    insert into public.businesses
      (city_id, name, category, lat, lng, chat_id, public_preview, state, listed_at)
    select
      ct.id, v_row.venue, 'hostel', v_row.lat, v_row.lng, v_chat, true, 'listed', now()
    from public.cities ct
    join public.launch_cities lc on lc.city_id = ct.id and lc.active
    where ct.name = v_row.city_name and ct.country_code = v_row.country_code;

    if found then
      v_count := v_count + 1;
    else
      -- The city is not an ACTIVE launch city, so the chat has nothing to
      -- belong to. Said out loud: a switched-off city otherwise produces a
      -- silent 0 that reads exactly like "all four already exist".
      delete from public.chats where id = v_chat;
      raise notice 'seed_launch_businesses: no ACTIVE launch city for % in %, %', v_row.venue, v_row.city_name, v_row.country_code;
    end if;
  end loop;

  return v_count;
end
$$;

revoke all on function public.seed_launch_businesses() from public, anon, authenticated;
