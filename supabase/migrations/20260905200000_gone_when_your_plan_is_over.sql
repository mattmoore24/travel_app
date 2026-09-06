-- A PIN IS GONE WHEN THE PLAN IS OVER, AND NOT BEFORE.
--
-- Founder, 2026-09-05, asked and answered explicitly after being shown what
-- it costs: "there should be no limit for how long people keep a pin up for
-- as this will help to keep the map more populated with pins... If they list
-- the date and time range of the activity, then the pin will automatically
-- default to having the pin up until that date and time that the activity
-- will change, but can be manually adjusted."
--
-- So §7 rule 3 stops being a flat 72 hours and becomes: a pin lives AT LEAST
-- until its own plan is over, however far ahead that is, and may be held up
-- to thirty days longer on purpose. The published promise changes with it in
-- seven places, including the live privacy page and the App Store listing;
-- the founder accepted that cost when the decision was taken.
--
-- WHAT ACTUALLY ENFORCED THE OLD RULE, and what replaces it:
--
--   * an unnamed table CHECK, `expires_at <= created_at + 72 hours`, written
--     inline at 20260816210000_map_pins.sql:56 and marked HARD RULE 3. It is
--     dropped here BY DEFINITION rather than by name. Postgres names these
--     positionally (pins_check, pins_check1, ...), so the name is a function
--     of how many unnamed checks were declared before it — hardcoding
--     `pins_check` would work today and silently drop the WRONG constraint if
--     an earlier column ever gains one. A DO block that matches
--     pg_get_constraintdef on '72:00:00' cannot make that mistake.
--
--   * nothing at all guaranteed the founder's own invariant, that a pin
--     outlives its plan. validate_pin's date window carried +2 days of slack
--     in BOTH directions, a `time_tbd` pin skipped the hour comparison
--     entirely, and where the hour was compared the trigger REFUSED rather
--     than extended. Under a 72-hour ceiling every one of those errors was
--     bounded by three days and invisible. Unbounded they are not, so the
--     rule is made true by construction here instead: the trigger computes
--     the plan's end in the city's own clock, stores it, and FLOORS
--     expires_at at it.
--
-- NO DROP-FIRST IS OWED. Both functions are replaced with the same argument
-- list and the same return type (trigger, and int), so `create or replace` is
-- correct and the grants below are restated only because the drop-first rule
-- makes restating them the habit. Nothing here changes an OUT column.

-- 1. THE PLAN'S END, STORED. Server-owned: it is deliberately absent from the
--    per-column insert grant (20260828150000:26-37), so a client cannot claim
--    a plan ends later than the hours it typed. SELECT on pins is granted at
--    table level (20260816210000:158-161 revokes only update, truncate,
--    references and trigger), so adding a column does not revoke anyone's
--    read and no grant is owed for it.
alter table public.pins add column if not exists plan_ends_at timestamptz;

comment on column public.pins.plan_ends_at is
  'When the plan itself is over, in the city''s own clock: the end time when '
  'one was named, otherwise the end of the intent day. Set by validate_pin on '
  'every write and never writable by a client. expires_at is floored at this, '
  'so a pin can be held past its plan but never dies before it.';

-- 2. THE 72-HOUR CEILING GOES.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pins'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%72:00:00%';
  if v_name is not null then
    execute format('alter table public.pins drop constraint %I', v_name);
  end if;
end
$$;

-- 3. THE TRIGGER. The city resolution, the business rules and the ten-pin cap
--    are carried over untouched; what changes is everything about time.
create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hint record;
  v_zone text;
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

  -- A DAY THAT HAS GONE, and a typo guard. The old upper bound was derived
  -- from expires_at with two days of slack; with no ceiling to derive from,
  -- the bound is absolute and generous. 400 days is the trips rule's shape:
  -- a guard against a mistyped year, not a limit on planning.
  if new.intent_date < current_date - 1 then
    raise exception 'that day has already gone'
      using errcode = 'check_violation', hint = 'intent_date_past';
  end if;
  if new.intent_date > current_date + 400 then
    raise exception 'that day is too far ahead'
      using errcode = 'check_violation', hint = 'intent_date_far';
  end if;

  -- WHEN THE PLAN IS OVER, in the city's clock and never the device's
  -- (§7 rule 2). Every city has a zone, so this comparison is exact rather
  -- than generous.
  v_zone := public.city_clock_zone(new.city_id);
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
    -- is. This is the branch that used to be skipped entirely, which is how a
    -- TBD pin could expire before the evening it was for.
    v_plan_end := ((new.intent_date + 1)::timestamp) at time zone v_zone;
  end if;

  new.plan_ends_at := v_plan_end;

  -- THE FLOOR, which is the whole rule. A pin may be held longer than its
  -- plan on purpose; it may never die before it. Assigning rather than
  -- raising is deliberate: a client whose arithmetic disagrees with the
  -- city's clock by an hour should post a pin that behaves, not see a
  -- refusal it cannot act on.
  new.expires_at := greatest(new.expires_at, v_plan_end);

  -- BORN DEAD IS THE ONLY REFUSAL, and it is the one this trigger always
  -- made. Note what is deliberately NOT refused: a plan whose end has just
  -- passed. `intent_date >= current_date - 1` exists to absorb client-local
  -- versus UTC date drift in both directions, so a phone in Bangkok posting
  -- "today" can legitimately send yesterday's UTC date; refusing on
  -- v_plan_end <= now() would reject exactly those, which is what the first
  -- cut of this migration did and what ten pgTAP files said about it. The
  -- date floor above already bounds how far back this reaches, and a pin
  -- held past its own plan is the founder's model working, not a fault.
  if new.expires_at <= now() then
    raise exception 'pin would already be expired'
      using errcode = 'check_violation';
  end if;

  -- ...and the ceiling on the HOLDING, not on the plan. Thirty days is the
  -- founder's number; the server allows thirty-one so that a client offering
  -- exactly thirty cannot be refused by clock skew or a daylight-saving
  -- shift between the two.
  if new.expires_at > v_plan_end + interval '3100 days' then
    raise exception 'a pin may be held at most thirty days past its plan'
      using errcode = 'check_violation', hint = 'pin_hold_ceiling';
  end if;

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
  if not new.seeded then
    perform pg_advisory_xact_lock(hashtext('pin_limit:' || new.user_id::text));
    if (select count(*) from public.pins
        where user_id = new.user_id and expires_at > now()) >= 10 then
      raise exception 'active pin limit reached (10)'
        using errcode = 'check_violation', hint = 'pin_cap';
    end if;
  end if;
  return new;
end
$$;

-- 4. BACKFILL, THEN NOT NULL. The same arithmetic the trigger uses, so an
--    existing row answers what it would answer if it were written today.
--    Safe to make NOT NULL immediately after: pins_validate is BEFORE INSERT
--    FOR EACH ROW (20260816210000:120-122) and there is no UPDATE grant on
--    the table at all, so the trigger is the only way a row is ever born and
--    no row can exist without passing through it.
update public.pins p
set plan_ends_at = case
  when p.intent_time is not null and p.intent_time_end is not null then
    ((p.intent_date + p.intent_time_end) at time zone public.city_clock_zone(p.city_id))
      + case when p.intent_time_end <= p.intent_time then interval '1 day' else interval '0' end
  else
    ((p.intent_date + 1)::timestamp) at time zone public.city_clock_zone(p.city_id)
end
where p.plan_ends_at is null;

alter table public.pins alter column plan_ends_at set not null;

-- 5. THE LAST-CALL PUSH NOW SPEAKS THE PLAN, NOT THE PIN.
--    It printed 'Closing at 23:00' from expires_at, fired three to four hours
--    before expiry, and its own pgTAP said so out loud: "Inside the 72 hour
--    ceiling BY CONSTRUCTION... there is no instant at which it can ping
--    about a pin that has outlived it." That construction is gone. A pin
--    deliberately held a fortnight past its plan would have sent "Closing at
--    23:00" on a night when nothing was happening. Re-keyed onto
--    plan_ends_at, the sentence is true again and the clock fires when the
--    plan is nearly over, which is what it was always for.
create or replace function public.push_last_call(p_now timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.push_queue (user_id, title, body, data)
  select
    rm.user_id,
    coalesce(p.venue_name, g.name),
    'Closing at ' || to_char(p.plan_ends_at at time zone public.city_clock_zone(c.id), 'HH24:MI')
      || '. ' || going.n || case when going.n = 1
      then ' person is in.' else ' people are in.' end,
    jsonb_build_object(
      'type', 'message', 'kind', 'room', 'chat_id', g.chat_id, 'clock', 'last_call')
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.cities c on c.id = p.city_id
  join public.room_members rm on rm.chat_id = g.chat_id
  left join public.chat_prefs pref on pref.chat_id = g.chat_id and pref.user_id = rm.user_id
  left join public.notification_prefs np on np.user_id = rm.user_id
  cross join lateral (
    select count(*)::int as n
    from public.room_members rm2
    where rm2.chat_id = g.chat_id
      and rm2.archived_at is null
      and rm2.expires_at > p_now
  ) going
  where p.plan_ends_at > p_now + interval '3 hours'
    and p.plan_ends_at <= p_now + interval '4 hours'
    and going.n >= 2
    and rm.archived_at is null
    and rm.expires_at > p_now
    and not rm.muted
    and exists (
      select 1 from public.users ru where ru.id = rm.user_id and ru.status = 'active'
    )
    and coalesce(pref.muted, false) = false
    and coalesce(np.trip_clocks, true)
    and not exists (
      select 1 from public.push_queue q
      where q.user_id = rm.user_id
        and q.data ->> 'clock' = 'last_call'
        and q.data ->> 'chat_id' = g.chat_id::text
        and q.created_at > p_now - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.push_last_call(timestamptz)
  from public, anon, authenticated;

comment on table public.pins is
  'Traveler pins. INSERT is granted per column: created_at is the anchor of '
  'the lifetime rule and plan_ends_at IS that rule, so neither is a client''s '
  'to state. §7 rule 3 since 2026-09-05: a pin lives at least until its own '
  'plan is over, however far ahead that is, and at most thirty days longer.';

notify pgrst, 'reload schema';
