-- Phase 2: trips, city+date overlap matching, blocks, and Hinge-style message
-- requests with the moderation chokepoint (hard rule 5) and sender-blind
-- response states (brief §4 RLS invariant 4).
--
-- Design rules carried over from Phase 1:
--   * SECURITY DEFINER helpers/RPCs are caller-scoped — auth.uid() bound
--     internally, never a viewer/sender parameter (PostgREST exposes every
--     executable public function as RPC).
--   * Function EXECUTE revokes always include PUBLIC.
--   * State transitions with invariants (send/respond) happen in RPCs, not
--     direct table writes.

-- Cities reference data ---------------------------------------------------------
-- Seeded from GeoNames (CC BY 4.0) in the companion seed migration; read-only.

create table public.cities (
  id int primary key, -- GeoNames id
  name text not null,
  country_code text not null,
  country_name text not null,
  lat double precision not null,
  lng double precision not null,
  population int not null default 0
);

create index cities_name_prefix_idx on public.cities (lower(name) text_pattern_ops);
create index cities_population_idx on public.cities (population desc);

revoke all on public.cities from anon, authenticated;
grant select on public.cities to authenticated;

create function public.search_cities(p_query text)
returns setof public.cities
language sql
stable
as $$
  select *
  from public.cities
  where lower(name) like lower(trim(p_query)) || '%'
    and length(trim(p_query)) >= 2
  order by population desc
  limit 8
$$;

revoke execute on function public.search_cities(text) from public, anon;

-- Blocks (created now so matching and requests respect them from day one;
-- the block/unblock UI ships with the rest of the safety tooling in Phase 4).

create table public.blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create policy blocks_select_own
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

create policy blocks_insert_own
  on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid());

create policy blocks_delete_own
  on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());

revoke all on public.blocks from anon;
revoke update, truncate, references, trigger on public.blocks from authenticated;

-- True when a block exists between the caller and p_other in either
-- direction. Caller-scoped; the caller can never probe third-party pairs.
create function public.is_blocked_pair(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = auth.uid())
  )
$$;

-- Discoverable = active account AND finished onboarding.
create function public.is_discoverable_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.profiles p on p.user_id = u.id
    where u.id = p_user_id
      and u.status = 'active'
      and p.onboarding_completed_at is not null
  )
$$;

revoke execute on function public.is_blocked_pair(uuid),
  public.is_discoverable_owner(uuid) from public, anon;

-- Trips -------------------------------------------------------------------------

create type public.trip_status as enum ('active', 'cancelled');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  city_id int not null references public.cities (id),
  start_date date not null,
  end_date date not null,
  status public.trip_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 365)
);

create index trips_city_dates_idx
  on public.trips (city_id, start_date, end_date)
  where status = 'active';
create index trips_user_idx on public.trips (user_id);

-- Date sanity on insert and on date edits only — a trip aging into the past
-- must not break unrelated updates (e.g. cancelling it).
create function public.validate_trip_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.start_date = old.start_date
     and new.end_date = old.end_date then
    return new;
  end if;
  if new.end_date < current_date then
    raise exception 'trip is entirely in the past' using errcode = 'check_violation';
  end if;
  if new.start_date > current_date + 730 then
    raise exception 'trip starts too far in the future' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger trips_validate_dates
  before insert or update on public.trips
  for each row execute function public.validate_trip_dates();

-- Anti-scrape cap: overlap-gated visibility is only meaningful if one account
-- can't hold trips in every city at once.
create function public.enforce_trip_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.trips
      where user_id = new.user_id and status = 'active'
        and end_date >= current_date) >= 5 then
    raise exception 'active trip limit reached (5)' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger trips_limit
  before insert on public.trips
  for each row execute function public.enforce_trip_limit();

create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- Does the CALLER have an active trip overlapping this city/date window?
create function public.overlaps_own_trip(p_city_id int, p_start date, p_end date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips
    where user_id = auth.uid()
      and status = 'active'
      and city_id = p_city_id
      and start_date <= p_end
      and p_start <= end_date
  )
$$;

revoke execute on function public.overlaps_own_trip(int, date, date) from public, anon;

alter table public.trips enable row level security;

create policy trips_select_own
  on public.trips for select to authenticated
  using (user_id = auth.uid());

-- The core privacy rule for trips: other users' travel plans are only
-- readable through a genuine city+date overlap with one of YOUR active trips.
create policy trips_select_overlap
  on public.trips for select to authenticated
  using (
    user_id <> auth.uid()
    and status = 'active'
    and public.is_discoverable_owner(user_id)
    and not public.is_blocked_pair(user_id)
    and public.overlaps_own_trip(city_id, start_date, end_date)
  );

create policy trips_insert_own
  on public.trips for insert to authenticated
  with check (user_id = auth.uid());

create policy trips_update_own
  on public.trips for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy trips_delete_own
  on public.trips for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.trips from anon;
revoke truncate, references, trigger on public.trips from authenticated;
revoke update on public.trips from authenticated;
grant update (city_id, start_date, end_date, status) on public.trips to authenticated;

-- Match browse: one round-trip joining overlapping trips with their owners'
-- profile + main photo. SECURITY INVOKER — every underlying RLS policy and
-- column grant still applies to the caller.
create function public.get_matches()
returns table (
  trip_id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  gender public.gender,
  city_id int,
  city_name text,
  city_country text,
  overlap_start date,
  overlap_end date,
  photo_path text
)
language sql
stable
as $$
  select
    theirs.id,
    theirs.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    p.gender,
    c.id,
    c.name,
    c.country_name,
    greatest(mine.start_date, theirs.start_date),
    least(mine.end_date, theirs.end_date),
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = theirs.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
  from public.trips mine
  join public.trips theirs
    on theirs.city_id = mine.city_id
   and theirs.user_id <> mine.user_id
   and theirs.start_date <= mine.end_date
   and mine.start_date <= theirs.end_date
  join public.profiles p on p.user_id = theirs.user_id
  join public.cities c on c.id = theirs.city_id
  where mine.user_id = auth.uid()
    and mine.status = 'active'
    and mine.end_date >= current_date
  order by greatest(mine.start_date, theirs.start_date), theirs.created_at
$$;

revoke execute on function public.get_matches() from public, anon;

-- Message requests --------------------------------------------------------------

create type public.request_source as enum ('trip_match', 'pin');
create type public.request_status as enum
  ('pending', 'accepted', 'declined', 'expired', 'blocked_by_moderation');

create table public.message_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,
  source public.request_source not null,
  -- Hinge-style anchor: which part of the profile the message responds to
  -- (e.g. 'bio', 'photo:2', 'language:pt', 'home').
  profile_element text check (profile_element is null or char_length(profile_element) <= 60),
  first_message text not null check (char_length(first_message) between 1 and 500),
  moderation_verdict jsonb,
  status public.request_status not null default 'pending',
  chat_id uuid references public.chats (id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id),
  unique (sender_id, recipient_id) -- one shot per direction, ever (anti-pester)
);

create index message_requests_recipient_idx
  on public.message_requests (recipient_id) where status = 'pending';

alter table public.message_requests enable row level security;

-- Recipients see only what was delivered to them: pending requests (their
-- inbox) and accepted ones. Declined rows disappear, blocked_by_moderation
-- rows NEVER surface (hard rule 5).
create policy message_requests_select_recipient
  on public.message_requests for select to authenticated
  using (recipient_id = auth.uid() and status in ('pending', 'accepted'));

-- Senders have NO direct read: pending vs declined vs expired must be
-- indistinguishable (invariant 4). They read through sent_requests(), which
-- collapses those states. All writes go through the RPCs below.
revoke all on public.message_requests from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.message_requests from authenticated;
revoke select on public.message_requests from authenticated;
grant select (id, sender_id, recipient_id, source, profile_element,
              first_message, status, chat_id, created_at, responded_at)
  on public.message_requests to authenticated; -- moderation_verdict is server-only

-- Moderation pre-filter (the Phase 5 pipeline replaces the engine, not the seam) --

create table public.moderation_blocklist (
  id serial primary key,
  pattern text not null, -- case-insensitive Postgres regex
  category text not null
);

-- Server-only.
revoke all on public.moderation_blocklist from anon, authenticated;

insert into public.moderation_blocklist (pattern, category) values
  ('\ynudes?\y', 'sexual'),
  ('\ydick\s*pics?\y', 'sexual'),
  ('\y(dtf|fwb)\y', 'sexual'),
  ('\yfriends\s+with\s+benefits\y', 'sexual'),
  ('\yone\s*night\s*stand\y', 'sexual'),
  ('\yhook\s*(up|ups)\y', 'flirtation'),
  ('\ysexy\y', 'flirtation'),
  ('\ysext(ing)?\y', 'sexual'),
  ('\ynetflix\s+and\s+chill\y', 'flirtation'),
  ('\ywanna\s+fuck\y', 'sexual'),
  ('\yblow\s*jobs?\y', 'sexual');

-- Internal only: called by send_message_request, never by clients.
create function public.screen_first_message(p_text text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in select pattern, category from public.moderation_blocklist loop
    if p_text ~* v_row.pattern then
      return jsonb_build_object(
        'action', 'block', 'category', v_row.category, 'engine', 'prefilter-v1');
    end if;
  end loop;
  return jsonb_build_object('action', 'allow', 'engine', 'prefilter-v1');
end
$$;

revoke execute on function public.screen_first_message(text)
  from public, anon, authenticated;

-- RPCs --------------------------------------------------------------------------

-- Send a first-message request. Validates the relationship is legitimate
-- (overlap, not blocked, recipient discoverable), screens the message BEFORE
-- it can ever reach the recipient, and audit-logs the verdict. Returns
-- delivery feedback for the sender ("blocked" = rewrite and try again).
create function public.send_message_request(
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
  if p_source <> 'trip_match' then
    raise exception 'pin requests arrive with the map in Phase 3';
  end if;
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable';
  end if;
  if not exists (
    select 1
    from public.trips mine
    join public.trips theirs
      on theirs.city_id = mine.city_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
    where mine.user_id = v_sender and mine.status = 'active'
      and theirs.user_id = p_recipient and theirs.status = 'active'
  ) then
    raise exception 'no overlapping trip with recipient';
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

-- Accept or decline an incoming request. Accepting creates the chat + both
-- participant rows (which is exactly what unlocks social handles via the
-- Phase 1 gate). Declining records the decision without ever signaling it to
-- the sender.
create function public.respond_to_message_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.message_requests%rowtype;
  v_chat uuid;
begin
  select * into v_req
  from public.message_requests
  where id = p_request_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if not found then
    raise exception 'request not found';
  end if;

  if p_accept then
    insert into public.chats default values returning id into v_chat;
    insert into public.chat_participants (chat_id, user_id)
    values (v_chat, v_req.sender_id), (v_chat, v_req.recipient_id);
    update public.message_requests
      set status = 'accepted', chat_id = v_chat, responded_at = now()
      where id = p_request_id;
    return jsonb_build_object('accepted', true, 'chat_id', v_chat);
  end if;

  update public.message_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id;
  return jsonb_build_object('accepted', false);
end
$$;

-- Sender's view of their outgoing requests. Collapses pending/declined/
-- expired into 'sent' so a decline is indistinguishable from no response
-- (invariant 4); 'blocked' is the sender's own moderation feedback.
create function public.sent_requests()
returns table (
  id uuid,
  recipient_id uuid,
  source public.request_source,
  profile_element text,
  first_message text,
  state text,
  chat_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    recipient_id,
    source,
    profile_element,
    first_message,
    case status
      when 'accepted' then 'accepted'
      when 'blocked_by_moderation' then 'blocked'
      else 'sent'
    end,
    case when status = 'accepted' then chat_id else null end,
    created_at
  from public.message_requests
  where sender_id = auth.uid()
  order by created_at desc
$$;

-- Inbox: incoming pending requests with the sender's public profile card.
-- SECURITY INVOKER — the recipient-side policy and column grants govern
-- everything this returns.
create function public.incoming_requests()
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  age int,
  verified boolean,
  profile_element text,
  first_message text,
  photo_path text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    r.id,
    r.sender_id,
    p.display_name,
    p.age,
    p.verified,
    r.profile_element,
    r.first_message,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = r.sender_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.created_at
  from public.message_requests r
  join public.profiles p on p.user_id = r.sender_id
  where r.recipient_id = auth.uid() and r.status = 'pending'
  order by r.created_at desc
$$;

-- Chat list for either participant. SECURITY DEFINER (the sender has no
-- direct read on message_requests) but caller-scoped: strictly the caller's
-- own chats.
create function public.my_chats()
returns table (
  chat_id uuid,
  chat_status public.chat_status,
  other_user_id uuid,
  other_display_name text,
  other_photo_path text,
  first_message text,
  first_message_sender_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.status,
    other.user_id,
    op.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = other.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.first_message,
    r.sender_id,
    c.created_at
  from public.chats c
  join public.chat_participants me
    on me.chat_id = c.id and me.user_id = auth.uid()
  join public.chat_participants other
    on other.chat_id = c.id and other.user_id <> auth.uid()
  left join public.profiles op on op.user_id = other.user_id
  left join public.message_requests r on r.chat_id = c.id
  order by c.created_at desc
$$;

revoke execute on function
  public.send_message_request(uuid, public.request_source, text, text),
  public.respond_to_message_request(uuid, boolean),
  public.sent_requests(),
  public.incoming_requests(),
  public.my_chats()
from public, anon;

revoke execute on function public.validate_trip_dates(), public.enforce_trip_limit()
  from public, anon, authenticated;
