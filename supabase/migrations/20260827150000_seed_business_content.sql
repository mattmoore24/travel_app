-- Something to look at on day one
-- ===========================================================================
--
-- The four seeded venues become the first places travelers can see, and after
-- the rename they are already `listed`, so they are already on the map. But a
-- marker that opens onto an empty sheet reads as a bug rather than as a place
-- nobody has filled in yet, and the first thing anybody does with this feature
-- is tap one.
--
-- So: hours, one link and one standing post each. No photos, because those
-- live in storage and a migration cannot put them there; the sheet handles a
-- missing cover already.
--
-- Callable by hand after a deploy, like seed_launch_businesses() and for the
-- same reason: running seeds inline once put a second Lisbon room into the
-- test database and broke a guest-visibility assertion. Idempotent, so running
-- it twice is a no-op rather than a duplicate.
--
-- LAUNCH_RUNBOOK step 5 purges demo content before real users arrive. This is
-- content on OUR OWN four venues rather than fake businesses, so there is
-- nothing to purge: the hours are plausible, the post says what it is, and a
-- real owner claiming one of these later overwrites all of it.

create function public.seed_launch_business_content()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select b.id, b.name, b.category
    from public.businesses b
    where b.owner_user_id is null and b.active
  loop
    -- Hours. Every day, and late, because these are hostels: the point of the
    -- rows is to prove the "Open · till" line works, including past midnight.
    if not exists (select 1 from public.business_hours where business_id = v_row.id) then
      insert into public.business_hours (business_id, weekday, opens, closes)
      select v_row.id, d, time '08:00', time '01:00'
      from generate_series(0, 6) as d;
      v_count := v_count + 1;
    end if;

    if not exists (select 1 from public.business_links where business_id = v_row.id) then
      insert into public.business_links (business_id, kind, label, value, position)
      values (v_row.id, 'website', 'Website', 'https://example.com', 0);
    end if;

    -- No end date, which is the founder's rule working: a standing notice
    -- stays up until somebody takes it down.
    if not exists (select 1 from public.business_posts where business_id = v_row.id) then
      insert into public.business_posts (business_id, title, body)
      values (
        v_row.id,
        'Come and say hello',
        'The chat here is open to anyone passing through. Swap plans with whoever is around.'
      );
    end if;
  end loop;

  return v_count;
end
$$;

revoke all on function public.seed_launch_business_content() from public, anon, authenticated;

comment on function public.seed_launch_business_content() is
  'Fills the unclaimed launch venues with hours, a link and a standing post so '
  'the first marker anybody taps opens onto something. Idempotent. Run by '
  'hand after a deploy, like seed_launch_businesses().';
