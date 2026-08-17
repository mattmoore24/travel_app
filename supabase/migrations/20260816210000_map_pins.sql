-- Phase 3: the map. Intent pins (venue-level, future-dated, hard-expiring),
-- geofenced launch cities, the k-anonymous heatmap, seeded pins, and the
-- pin -> profile -> message request path.
--
-- Hard rules enforced here at the DB layer:
--   * Rule 2 — pins are venue-level FUTURE INTENT: no live location exists
--     anywhere in this schema, and pin coordinates are validated against the
--     launch city's geofence, not any user position.
--   * Rule 3 — pins expire at <= 72h: CHECK constraint on the row, RLS that
--     hides expired pins from EVERYONE (owner included), and a hard-delete
--     sweep. Pins are immutable (no UPDATE grant), so the CHECK can't be
--     outlived by edits.
--   * Rule 6 — heat cells below the per-city k-threshold are never served;
--     the only heat read path is a function that aggregates with
--     HAVING >= k and returns no user identifiers at all.

-- Launch cities ----------------------------------------------------------------
-- Geofence/feature-flag table (brief §2.6: launch dense, not wide).

create table public.launch_cities (
  city_id int primary key references public.cities (id),
  active boolean not null default true,
  radius_km numeric not null default 40 check (radius_km between 1 and 150),
  heat_k int not null default 3 check (heat_k >= 3),
  created_at timestamptz not null default now()
);

-- Candidate hubs from the brief; founder toggles `active` per GTM plan.
insert into public.launch_cities (city_id)
select id from public.cities
where (name, country_code) in
  (('Lisbon', 'PT'), ('Mexico City', 'MX'), ('Bangkok', 'TH'), ('Denpasar', 'ID'));

revoke all on public.launch_cities from anon, authenticated;
grant select on public.launch_cities to authenticated;

-- Pins ---------------------------------------------------------------------------

create type public.pin_category as enum
  ('bar', 'restaurant', 'club', 'museum', 'monument', 'beach', 'hike', 'other');

create table public.pins (
  id uuid primary key default gen_random_uuid(),
  -- null user_id = admin-seeded curated pin (hostel events, walking tours).
  user_id uuid references public.users (id) on delete cascade,
  city_id int not null references public.launch_cities (city_id),
  venue_name text not null check (char_length(venue_name) between 1 and 80),
  category public.pin_category not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  intent_date date not null,
  seeded boolean not null default false,
  seed_note text check (seed_note is null or char_length(seed_note) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at <= created_at + interval '72 hours'), -- HARD RULE 3
  check (seeded = (user_id is null)),
  check (seed_note is null or seeded)
);

create index pins_city_expiry_idx on public.pins (city_id, expires_at);
create index pins_user_idx on public.pins (user_id) where user_id is not null;

-- Great-circle distance (km); avoids a PostGIS dependency for a radius check.
create function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

create function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city record;
begin
  select lc.active, lc.radius_km, c.lat, c.lng
    into v_city
  from public.launch_cities lc
  join public.cities c on c.id = lc.city_id
  where lc.city_id = new.city_id;

  if not v_city.active then
    raise exception 'this city is not open yet' using errcode = 'check_violation';
  end if;
  if public.haversine_km(new.lat, new.lng, v_city.lat, v_city.lng) > v_city.radius_km then
    raise exception 'pin location is outside the city area' using errcode = 'check_violation';
  end if;
  if new.expires_at <= now() then
    raise exception 'pin would already be expired' using errcode = 'check_violation';
  end if;
  -- +2 absorbs client-local vs UTC date drift in both directions.
  if new.intent_date < current_date - 1
     or new.intent_date > (new.expires_at at time zone 'UTC')::date + 2 then
    raise exception 'intent date must fall within the pin''s lifetime'
      using errcode = 'check_violation';
  end if;
  if not new.seeded then
    perform pg_advisory_xact_lock(hashtext('pin_limit:' || new.user_id::text));
    if (select count(*) from public.pins
        where user_id = new.user_id and expires_at > now()) >= 10 then
      raise exception 'active pin limit reached (10)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger pins_validate
  before insert on public.pins
  for each row execute function public.validate_pin();

alter table public.pins enable row level security;

-- Expired pins are unreadable by EVERYONE — the owner included (rule 3).
create policy pins_select_own
  on public.pins for select to authenticated
  using (user_id = auth.uid() and expires_at > now());

create policy pins_select_visible
  on public.pins for select to authenticated
  using (
    expires_at > now()
    and exists (
      select 1 from public.launch_cities lc
      where lc.city_id = pins.city_id and lc.active
    )
    and (
      seeded
      or (
        user_id <> auth.uid()
        and public.is_discoverable_owner(user_id)
        and not public.is_blocked_pair(user_id)
      )
    )
  );

create policy pins_insert_own
  on public.pins for insert to authenticated
  with check (user_id = auth.uid() and seeded = false);

create policy pins_delete_own
  on public.pins for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.pins from anon;
-- Pins are immutable: rewrite = delete + recreate. No UPDATE keeps the 72h
-- CHECK airtight and the history un-editable.
revoke update, truncate, references, trigger on public.pins from authenticated;

-- Map browse: pins + owner profile card in one round trip. SECURITY INVOKER —
-- the pin policies and profile column grants govern every row returned.
create function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz
)
language sql
stable
as $$
  select
    p.id,
    p.user_id,
    pr.display_name,
    pr.age,
    pr.verified,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = p.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    p.venue_name,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    p.seed_note,
    p.expires_at
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
  order by p.intent_date, p.created_at
$$;

-- The anonymized heatmap (rule 6). SECURITY INVOKER — deliberately and
-- load-bearingly so: the aggregation runs under the CALLER's own pin RLS, so
-- heat can only ever summarize pins the caller could already read
-- individually. That makes cell-count differencing attacks (subtract the
-- pins you can see from a cell's count to localize a hidden or blocking
-- user) impossible BY CONSTRUCTION: the delta is always zero. Blocked pairs,
-- shadowbanned users, and expired pins are excluded from heat exactly
-- because they're excluded from the caller's pin visibility. The k-threshold
-- (distinct pinners per ~550m cell) and the identifier-free output remain as
-- defense in depth. Found by the Phase 3 adversarial review.
create function public.heat_cells(p_city_id int, p_date date default null)
returns table (
  cell_lat double precision,
  cell_lng double precision,
  category public.pin_category,
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
    p.category,
    count(distinct coalesce(p.user_id::text, p.id::text))::int
  from public.pins p -- caller's RLS applies here
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (p_date is null or p.intent_date = p_date)
  group by 1, 2, 3
  having count(distinct coalesce(p.user_id::text, p.id::text)) >= v_k;
end
$$;

revoke execute on function
  public.city_pins(int),
  public.heat_cells(int, date)
from public, anon;

-- Expiry sweep (rule 3's hard-delete promise). RLS already hides expired
-- pins from every client; this removes the rows themselves. Scheduled via
-- pg_cron where available (hosted Supabase); the guard keeps the migration
-- valid on environments without the extension (local test rig, CI).
create function public.expire_pins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.pins where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.expire_pins() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-pins', '*/15 * * * *', 'select public.expire_pins()');
  end if;
end
$$;

revoke execute on function
  public.validate_pin(),
  public.haversine_km(double precision, double precision, double precision, double precision)
from public, anon;
grant execute on function
  public.haversine_km(double precision, double precision, double precision, double precision)
to authenticated;

-- Pin-source message requests -----------------------------------------------------
-- Same chokepoint and invariants as trip_match; a pin request additionally
-- requires the recipient to actually have a live pin.

create or replace function public.send_message_request(
  p_recipient uuid,
  p_source public.request_source,
  p_first_message text,
  p_profile_element text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_verdict jsonb;
  v_status public.request_status;
  v_id uuid;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable';
  end if;
  -- Already connected (e.g. the reverse-direction request was accepted):
  -- there is a chat for that — no second request, no second chat.
  if public.has_accepted_chat(p_recipient) then
    raise exception 'already connected with this traveler';
  end if;

  if p_source = 'trip_match' then
    if not exists (
      select 1
      from public.trips mine
      join public.trips theirs
        on theirs.city_id = mine.city_id
       and theirs.start_date <= mine.end_date
       and mine.start_date <= theirs.end_date
       and theirs.end_date >= current_date
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date
    ) then
      raise exception 'no overlapping trip with recipient';
    end if;
  elsif p_source = 'pin' then
    -- Only pins the sender could actually have seen count: live, and in an
    -- ACTIVE launch city — otherwise this branch becomes an oracle for pin
    -- existence in deactivated cities.
    if not exists (
      select 1
      from public.pins p
      join public.launch_cities lc on lc.city_id = p.city_id and lc.active
      where p.user_id = p_recipient and p.expires_at > now()
    ) then
      raise exception 'recipient has no active pin';
    end if;
  else
    raise exception 'unknown request source';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  v_status := case when v_verdict ->> 'action' = 'block'
                   then 'blocked_by_moderation'::public.request_status
                   else 'pending'::public.request_status end;

  -- A moderation-blocked attempt may be rewritten and retried — replace it.
  -- (The audit trail survives in moderation_events.) Delivered requests stay
  -- one-per-pair forever via the unique constraint.
  delete from public.message_requests
  where sender_id = v_sender and recipient_id = p_recipient
    and status = 'blocked_by_moderation';

  begin
    insert into public.message_requests
      (sender_id, recipient_id, source, profile_element, first_message,
       moderation_verdict, status)
    values
      (v_sender, p_recipient, p_source, p_profile_element, p_first_message,
       v_verdict, v_status)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'request already sent to this traveler';
  end;

  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_sender, 'message_request', v_id,
     case when v_status = 'blocked_by_moderation' then 'blocked' else 'stub_approved' end,
     'prefilter-v1', v_verdict);

  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_status = 'pending',
    'blocked', v_status = 'blocked_by_moderation');
end
$$;
