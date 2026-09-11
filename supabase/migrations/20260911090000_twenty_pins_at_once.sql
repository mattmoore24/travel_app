-- Twenty pins at once.
--
-- Founder, 2026-09-11, asked whether the ten-live-pins cap should stay now
-- that a pin can be up for a year rather than three days: "raise it to 20
-- (that should be plenty)."
--
-- WHAT THIS CHANGES. One number in validate_pin: the count of a traveler's
-- pins still on the map (expires_at > now()) that refuses the next post
-- goes from ten to twenty, and the refusal names the new number so the
-- app's copy can match it. The function is restated in full because that
-- is the only way to change a line of a trigger body; every other line is
-- 20260910120000's, unchanged. Same signature, so the trigger binding and
-- the ACL carry over; nothing is dropped.
--
-- WHAT THIS DOES NOT CHANGE. The daily posting cap (thirty in 24 hours,
-- 20260831140000) and the per-user advisory lock that makes the count
-- race-proof are as they were. Curated seed pins were never counted and
-- still are not. Featured-city and liquidity counts keep counting every
-- plan on the map, on the same founder's word.

begin;

create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hint record;
  v_zone text;
  v_city_today date;
  v_plan_end timestamptz;
begin
  -- WHICH CITY. Unchanged. The client sends the city it was browsing, which
  -- is right whenever the spot is in that city's orbit (20 km: Nice to
  -- Monaco, Manhattan to Brooklyn) and wrong the moment somebody pans a
  -- continent. Then the spot decides for itself, and only when the spot is
  -- nowhere near any seeded city does the browsed city stand. Never a
  -- refusal: a pin is a plan, and a plan in the middle of nowhere is still a
  -- plan.
  select c.id, c.lat, c.lng into v_hint
  from public.cities c
  where c.id = new.city_id;
  if v_hint.id is null
     or public.haversine_km(new.lat, new.lng, v_hint.lat, v_hint.lng) > 20 then
    new.city_id := coalesce(public.nearest_city(new.lat, new.lng), new.city_id);
  end if;

  -- EVERY CLOCK IN THIS FUNCTION IS THE CITY'S. A pin is a plan somewhere,
  -- and "today" means today where the plan is, not where the phone is.
  v_zone := public.city_clock_zone(new.city_id);
  v_city_today := (now() at time zone v_zone)::date;

  -- WHEN THE PLAN IS OVER.
  if new.intent_time is not null and new.intent_time_end is not null then
    v_plan_end := (new.intent_date + new.intent_time_end) at time zone v_zone;
    -- "10 PM to 2 AM" ends tomorrow. An end at or before the start is the
    -- only way to say so with two times, so it is read that way.
    if new.intent_time_end <= new.intent_time then
      v_plan_end := v_plan_end + interval '1 day';
    end if;
  else
    -- No end named: a start with no finish, or no hour at all, or TBD. The
    -- plan is then the DAY, and a day is over when it is over where the plan
    -- is.
    v_plan_end := ((new.intent_date + 1)::timestamp) at time zone v_zone;
  end if;
  new.plan_ends_at := v_plan_end;

  -- THE DAY, in three cases.
  if new.take_down_on is null and new.expires_at is not null then
    -- LEGACY. An old bundle, or seed_launch_pins' literal
    -- `now() + interval '48 hours'` (20260831150000:110), still says when
    -- rather than which day. Read the day out of it rather than refusing,
    -- so the deploy gap between the migration and the over-the-air update
    -- costs nobody a pin.
    new.take_down_on := ((new.expires_at at time zone v_zone) - interval '1 microsecond')::date;
  elsif new.take_down_on is null then
    -- THE DEFAULT: the day of the plan itself.
    new.take_down_on := greatest(new.intent_date, v_city_today);
  end if;
  -- A floor at today, ASSIGNED rather than raised: a client whose arithmetic
  -- disagrees with the city's clock by an hour should post a pin that
  -- behaves, not see a refusal it cannot act on.
  --
  -- There is deliberately NO floor at intent_date. The founder overruled it
  -- on 2026-09-10: a pin that comes down before its own plan is somebody
  -- planning ahead who does not want to be written to for a month, and it is
  -- an ordinary choice, not an error.
  new.take_down_on := greatest(new.take_down_on, v_city_today);

  -- THE CEILING, after the branch so the legacy path is covered too. 366 in
  -- the trigger against the 365 the form offers: a client that offers
  -- exactly a year must never be refused by a daylight-saving shift or a
  -- clock a few hours apart.
  if new.take_down_on > v_city_today + 366 then
    raise exception 'a pin can stay up for a year at most'
      using errcode = 'check_violation', hint = 'pin_ceiling';
  end if;

  -- THE DERIVATION. This is the line that takes the instant away from the
  -- client: midnight at the END of the chosen day, in the city's zone.
  new.expires_at := ((new.take_down_on + 1)::timestamp) at time zone v_zone;

  -- Unreachable now that the day is floored at the city's today, and kept
  -- anyway: it costs nothing and it is the assertion the derivation above
  -- has to keep being true.
  if new.expires_at <= now() then
    raise exception 'pin would already be expired' using errcode = 'check_violation';
  end if;

  -- A DAY THAT HAS GONE, and a typo guard. The old upper bound was derived
  -- from expires_at; with no ceiling to derive from it is absolute and
  -- generous. The -1 absorbs client-local versus UTC date drift in both
  -- directions; 400 days is the trips rule's shape, a guard against a
  -- mistyped year rather than a limit on planning.
  if new.intent_date < current_date - 1 then
    raise exception 'that day has already gone'
      using errcode = 'check_violation', hint = 'intent_date_past';
  end if;
  if new.intent_date > current_date + 400 then
    raise exception 'that day is too far ahead'
      using errcode = 'check_violation', hint = 'intent_date_far';
  end if;

  -- THE TWO REFUSALS THAT ARE GONE. 20260904120000:232-250 refused a plan
  -- whose hour or whose end fell after the pin disappeared. Under the
  -- founder's overrule that is a legal pin, so both are deleted rather than
  -- inverted into a floor.

  -- A pin may only name a business NEAR it. Unchanged.
  if new.business_id is not null
     and not exists (
       select 1 from public.businesses b
       where b.id = new.business_id
         and public.haversine_km(new.lat, new.lng, b.lat, b.lng) <= 30
     ) then
    raise exception 'that business is not in this city' using errcode = 'check_violation';
  end if;
  -- THE LINK, MADE HERE RATHER THAN BY THE CLIENT. Unchanged: exact name,
  -- sixty metres.
  if new.business_id is null then
    select b.id into new.business_id
    from public.businesses b
    where b.active
      and b.state = 'listed'
      and lower(btrim(b.name)) = lower(btrim(new.venue_name))
      and public.haversine_km(new.lat, new.lng, b.lat, b.lng) <= 0.06
    order by public.haversine_km(new.lat, new.lng, b.lat, b.lng)
    limit 1;
  end if;
  -- TWENTY LIVE PINS, raised from ten on 2026-09-11. It still counts what
  -- is ON THE MAP (expires_at > now()) rather than what is planned: a pin a
  -- person is holding for a year is a pin other people are looking at.
  if not new.seeded then
    perform pg_advisory_xact_lock(hashtext('pin_limit:' || new.user_id::text));
    if (select count(*) from public.pins
        where user_id = new.user_id and expires_at > now()) >= 20 then
      raise exception 'active pin limit reached (20)'
        using errcode = 'check_violation', hint = 'pin_cap';
    end if;
  end if;
  return new;
end
$$;


notify pgrst, 'reload schema';

commit;
