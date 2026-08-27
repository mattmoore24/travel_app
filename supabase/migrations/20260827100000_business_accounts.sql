-- Business accounts, part 1: identity and the rename
-- ===========================================================================
--
-- docs/BUSINESS_ACCOUNTS.md phase 13. This migration ships ZERO visible
-- change; the proof that it worked is that nothing broke.
--
-- `establishments` grows up into `businesses`. The rename is cheap in itself
-- and expensive in its blast radius: a plpgsql or sql function body is stored
-- as TEXT, and `alter table ... rename` does not rewrite it. Eight functions
-- name the old table, and after a bare rename every one of them keeps
-- pointing at a table that no longer exists and fails at RUNTIME. There is no
-- error at migration time to catch that: the deploy goes green and the app
-- stops working. So all eight are recreated here, in the same file.
--
-- Three of them (my_chats, city_rooms, room_info) have RETURNS TABLE, so per
-- AGENTS.md they are DROPped first. A drop silently takes the function's
-- GRANTS and its COMMENT with it, and Supabase's default privileges then hand
-- EXECUTE on the replacement to anon and authenticated. On a recreate the
-- REVOKE lines matter more than the GRANT lines.
--
-- enqueue_message_push() is the exception that must NOT be dropped: it
-- returns trigger and `messages_push` on public.messages depends on it, so a
-- DROP would need CASCADE and would silently take push notifications with it.
--
-- Not here, and deliberately: `business_chats`. Decision 12 is one chat per
-- business at v1, which `businesses.chat_id` already models exactly. The
-- separate table only earns its place alongside multi-room, which §10 defers.

-- ---------------------------------------------------------------------------
-- New types
-- ---------------------------------------------------------------------------

-- Founder-approved list. `other` is last and is a real answer, not a
-- fallback: a bike-rental place is not a hostel and should not have to claim
-- to be one.
create type public.business_category as enum (
  'hostel', 'hotel', 'guesthouse', 'bar', 'restaurant', 'cafe', 'club',
  'tour', 'activity', 'coworking', 'wellness', 'shop', 'other'
);

-- Where a listing stands. Orthogonal to `verified_at`: confirming the email
-- moves a business from `unconfirmed` to `listed`, and the storefront photo
-- is what sets `verified_at`. One is permission to appear, the other is a
-- badge, and conflating them is what would let an email click buy a check
-- mark (docs/BUSINESS_ACCOUNTS.md §3.9).
create type public.business_state as enum (
  'unconfirmed', 'listed', 'flagged', 'removed'
);

-- ---------------------------------------------------------------------------
-- The rename
-- ---------------------------------------------------------------------------

alter table public.establishments rename to businesses;
alter table public.establishment_staff rename to business_staff;

-- A rename keeps every dependent object under its OLD name: the index, both
-- policies, and the staff table's foreign-key column. Renaming them too is
-- not cosmetic - a schema that reads half-migrated is one somebody will
-- later "fix" in the wrong direction.
alter index establishments_city_idx rename to businesses_city_idx;
alter table public.businesses rename constraint establishments_pkey to businesses_pkey;
alter table public.business_staff rename column establishment_id to business_id;
alter policy establishments_select_active on public.businesses
  rename to businesses_select_listed;
alter policy establishment_staff_select on public.business_staff
  rename to business_staff_select;

-- ---------------------------------------------------------------------------
-- The new columns
-- ---------------------------------------------------------------------------

alter table public.businesses
  -- One business per account and one account per business. An owner who also
  -- travels makes a second, free, ordinary account (decision 5).
  add column owner_user_id uuid unique references public.users (id) on delete set null,
  add column description text check (char_length(description) <= 600),
  -- "Two minutes from the station, blue door" - the human directions a
  -- latitude cannot give.
  add column place_label text check (char_length(place_label) <= 120),
  -- The exceptions a weekday grid cannot hold: "closed for siesta", "kitchen
  -- shuts at 22:00".
  add column hours_note text check (char_length(hours_note) <= 200),
  add column website_url text check (char_length(website_url) <= 300),
  add column state public.business_state not null default 'unconfirmed',
  -- Set once by the storefront-photo check, cleared by a rename, a move or a
  -- flag. Never writable from a client: see the grants below.
  add column verified_at timestamptz,
  add column listed_at timestamptz,
  add column claimed_at timestamptz,
  add column updated_at timestamptz not null default now();

-- The badge, as one boolean, so the client never sees the timestamp and can
-- never be tempted to render "verified 3 days ago". Generated rather than
-- maintained, so it cannot drift from verified_at.
alter table public.businesses
  add column verified boolean generated always as (verified_at is not null) stored;

-- `kind` becomes the real category. The three old values are all in the new
-- enum, so this is a straight cast once its CHECK is out of the way.
alter table public.businesses drop constraint establishments_kind_check;
alter table public.businesses
  alter column kind drop default,
  alter column kind type public.business_category using kind::public.business_category,
  alter column kind set default 'other';
alter table public.businesses rename column kind to category;

-- The four seeded venues are ours and were curated by hand, so they are
-- listed. Without this they would all fall to `unconfirmed` and vanish from
-- the map on deploy, which is the opposite of "zero visible change".
update public.businesses set state = 'listed', listed_at = created_at;

create index businesses_owner_idx on public.businesses (owner_user_id)
  where owner_user_id is not null;

comment on table public.businesses is
  'A place on the map: hostel, bar, tour, whatever. Not a person. Never '
  'appears in Travelers, never posts trips or pins, never messages first '
  '(§7 rule 8). owner_user_id is the account that runs it, NULL for the '
  'venues we seeded ourselves.';

-- ---------------------------------------------------------------------------
-- Grants, narrowed to a column list
-- ---------------------------------------------------------------------------
--
-- The old grant was `grant select on public.establishments to anon,
-- authenticated` with no column list, which was harmless when every column
-- was public. It is not harmless now: owner_user_id, the listing state and
-- the verification timestamp would all be readable by the anon key that ships
-- inside the app, from the moment they were added. public.messages already
-- uses a column-scoped grant for exactly this reason.
--
-- `state` is not in the list either. A client that can see a business at all
-- knows it is listed, and exposing the enum would leak the moderation queue.
revoke all on public.businesses from anon, authenticated;
grant select (
  id, city_id, name, category, description, place_label, hours_note,
  website_url, lat, lng, chat_id, public_preview, active, verified
) on public.businesses to anon, authenticated;

-- Only the columns a business may edit about itself, and only through the
-- screening trigger below. lat/lng, city_id, active, state, verified_at and
-- owner_user_id are server-owned: a business that could move its own marker
-- could verify a surf shack and then become the Marriott.
grant update (name, description, place_label, hours_note, website_url, public_preview)
  on public.businesses to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

drop policy businesses_select_listed on public.businesses;

create policy businesses_select_listed
  on public.businesses for select to anon, authenticated
  using (active and state = 'listed');

-- An owner always sees their own listing, including while it is unconfirmed
-- and dark to everyone else. That is the screen that tells them what is
-- outstanding.
create policy businesses_select_own
  on public.businesses for select to authenticated
  using (owner_user_id = auth.uid());

create policy businesses_update_own
  on public.businesses for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Am I a business?
-- ---------------------------------------------------------------------------

/**
 * True when this account runs a business.
 *
 * The keystone of the whole model, and the reason it is cheap: a business
 * account is an ordinary auth user whose `profiles.onboarding_completed_at`
 * stays NULL forever, so it can never be a traveler, can never be matched,
 * and can never appear in a discovery surface built on completed profiles.
 * Everything else here is belt and braces on top of that.
 */
create function public.is_business_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses where owner_user_id = p_user_id
  )
$$;

comment on function public.is_business_account(uuid) is
  'True when the account runs a business. Used by the §7 rule 8 guards and '
  'by the client to route into the business tabs.';

-- ---------------------------------------------------------------------------
-- §7 rule 8: a business never reaches out
-- ---------------------------------------------------------------------------
--
-- "A business account never initiates contact with a traveler, never joins a
-- traveler's group or another business's chat, and never reads traveler
-- discovery surfaces."
--
-- Enforced here rather than in the client, because the client is a thing
-- somebody can replace and this is the single biggest anti-spam decision in
-- the plan. It is also what stops a venue scraping who is in town.
--
-- One shared trigger function on six tables. Reading auth.uid() rather than a
-- row column is deliberate: it is the same test everywhere, and the
-- SECURITY DEFINER paths that insert on a caller's behalf (join_room, the
-- message-request RPC) still carry the caller's uid.

create function public.refuse_business_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_business_account(auth.uid()) then
    raise exception 'a business account cannot do that'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.refuse_business_write() from public, anon, authenticated;

create trigger trips_refuse_business
  before insert on public.trips
  for each row execute function public.refuse_business_write();

create trigger pins_refuse_business
  before insert on public.pins
  for each row execute function public.refuse_business_write();

create trigger message_requests_refuse_business
  before insert on public.message_requests
  for each row execute function public.refuse_business_write();

create trigger verification_requests_refuse_business
  before insert on public.verification_requests
  for each row execute function public.refuse_business_write();

create trigger profile_photos_refuse_business
  before insert on public.profile_photos
  for each row execute function public.refuse_business_write();

-- A business does not join rooms, not even its own: it moderates its room
-- through business_staff, which is a different relationship with a different
-- expiry (none).
create trigger room_members_refuse_business
  before insert on public.room_members
  for each row execute function public.refuse_business_write();

-- ---------------------------------------------------------------------------
-- Registering one
-- ---------------------------------------------------------------------------

/**
 * Turn the calling account into a business.
 *
 * SECURITY DEFINER because it writes owner_user_id, city_id and lat/lng,
 * none of which a client may set directly. The row lands `unconfirmed`, which
 * means fully dark: no marker, no joinable chat, no messages, until the
 * confirmation link is clicked (phase 15).
 *
 * The chat is created here rather than on first use, so a business always has
 * exactly one room and `chat_id` is never null for a live listing.
 */
create function public.register_business(
  p_name text,
  p_category public.business_category,
  p_city_id int,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.businesses where owner_user_id = v_user) then
    raise exception 'this account already runs a business';
  end if;
  -- A traveler who has finished onboarding is a person, and a person is not
  -- a business. Catching it here keeps the two account kinds from ever
  -- overlapping on one auth row, which is what makes every guard above a
  -- simple question with one answer.
  if exists (
    select 1 from public.profiles
    where user_id = v_user and onboarding_completed_at is not null
  ) then
    raise exception 'this account is already a traveler';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  insert into public.businesses
    (city_id, name, category, lat, lng, chat_id, owner_user_id, state, claimed_at)
  values
    (p_city_id, p_name, p_category, p_lat, p_lng, v_chat, v_user, 'unconfirmed', now())
  returning id into v_id;

  return v_id;
end
$$;

revoke execute on function
  public.register_business(text, public.business_category, int, double precision, double precision)
from public, anon;

/**
 * The caller's own business, or no rows.
 *
 * A client cannot write `where owner_user_id = auth.uid()` - there is no
 * SELECT grant on that column, so naming it is a permission error even for
 * the owner - and a plain `select * from businesses` returns every listed
 * place with no way to tell which one is yours. So the question "am I a
 * business, and which" is one RPC.
 *
 * SECURITY DEFINER, which is also what lets the owner see `state`: the badge
 * chip on their own dashboard has to be able to say "Waiting on your email",
 * and that same column is hidden from every other client precisely because it
 * would otherwise leak the moderation queue.
 */
create function public.my_business()
returns table (
  id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  chat_id uuid,
  public_preview boolean,
  active boolean,
  state public.business_state,
  verified boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.city_id, b.name, b.category, b.description, b.place_label,
    b.hours_note, b.website_url, b.lat, b.lng, b.chat_id, b.public_preview,
    b.active, b.state, b.verified
  from public.businesses b
  where b.owner_user_id = auth.uid()
$$;

revoke execute on function public.my_business() from public, anon;
grant execute on function public.my_business() to authenticated;

-- A business's own text is broadcast, so it passes the same filter a bio
-- does. Without this the description would be a hole straight around
-- profile screening, exactly as the prompts would have been.
create function public.screen_business_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(
        concat_ws(' ', new.name, new.description, new.place_label, new.hours_note)
      ) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger businesses_screen
  before insert or update on public.businesses
  for each row execute function public.screen_business_text();

revoke execute on function public.screen_business_text() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Membership: "I'm not sure" and the new expiry math
-- ---------------------------------------------------------------------------
--
-- The founder's join question is a date picker with an "I'm not sure"
-- option, so the column that drives expiry has to be allowed to be empty.
-- Existing members keep the expires_at already materialised on their row
-- (decision 8: grandfather the promises we already made); only new joins get
-- the new numbers.

alter table public.room_members alter column departure_date drop not null;

comment on column public.room_members.departure_date is
  'When the traveler said they leave, or NULL for "I''m not sure". Drives '
  'expires_at at join time only; the stored expires_at is what the sweep '
  'reads, so changing the formula never moves a promise already made.';

-- ---------------------------------------------------------------------------
-- The eight functions that name the old table
-- ---------------------------------------------------------------------------

-- 1. is_room_moderator - scalar, so create-or-replace is legal.
--
-- The single highest-blast-radius function in the schema: it gates the
-- messages SELECT policy, can_send_in_chat, set_chat_pref, mark_chat_read,
-- room_remove_message, room_remove_member, pin/unpin, room_info, room_messages,
-- groups_select_member and the chat-photos storage read policy.
--
-- The group-admin branch deliberately ignores expires_at, so a group is never
-- left ownerless. That is preserved verbatim.
create or replace function public.is_room_moderator(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.businesses b
    join public.business_staff s on s.business_id = b.id
    where b.chat_id = p_chat_id and s.user_id = auth.uid()
  ) or exists (
    select 1 from public.room_members rm
    where rm.chat_id = p_chat_id
      and rm.user_id = auth.uid()
      and rm.role = 'admin'
  )
$$;

-- 2. is_public_room - scalar. This function IS the signed-out preview: the
-- RLS policy messages_select_public_room reads nothing else.
create or replace function public.is_public_room(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses
    where chat_id = p_chat_id
      and active
      and state = 'listed'
      and public_preview
  )
$$;

-- 3. join_room - returns jsonb, so create-or-replace is legal, and the name
-- stays because iOS builds already in the field call it by name over the
-- wire. JavaScript ships over the air; an installed binary does not.
--
-- New expiry math (docs/BUSINESS_ACCOUNTS.md §3.5): departure + 3 days, or
-- join + 90 days when the traveler said they were not sure, capped at 90
-- either way.
create or replace function public.join_room(p_chat_id uuid, p_departure_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if not exists (
    select 1 from public.businesses b
    join public.chats c on c.id = b.chat_id
    where b.chat_id = p_chat_id
      and b.active
      and b.state = 'listed'
      and c.status = 'active'
  ) then
    raise exception 'room unavailable';
  end if;
  if p_departure_date is not null and p_departure_date < current_date then
    raise exception 'departure date is in the past';
  end if;

  v_expires := case
    when p_departure_date is null then now() + interval '90 days'
    else least((p_departure_date + 3)::timestamptz, now() + interval '90 days')
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (p_chat_id, v_user, p_departure_date, v_expires)
  on conflict (chat_id, user_id) do update
    set departure_date = excluded.departure_date,
        expires_at = excluded.expires_at,
        archived_at = null;

  return jsonb_build_object('joined', true, 'expires_at', v_expires);
end
$$;

revoke execute on function public.join_room(uuid, date) from public, anon;

-- 4. my_chats - 19 OUT columns, so DROP first, and restate the grants the
-- drop discards. This is the CURRENT definition (first_message_anchor's), not
-- one of the four earlier generations.
drop function if exists public.my_chats(boolean);

create function public.my_chats(p_archived boolean default false)
returns table (
  chat_id uuid,
  kind public.chat_kind,
  chat_status public.chat_status,
  title text,
  other_user_id uuid,
  photo_path text,
  first_message text,
  first_message_sender_id uuid,
  last_message text,
  last_message_at timestamptz,
  member_count int,
  pinned boolean,
  muted boolean,
  archived boolean,
  expires_at timestamptz,
  created_at timestamptz,
  /** Groups only: null for direct chats and business rooms. */
  my_role text,
  /**
   * Messages somebody else has sent into this chat since this user last
   * opened it. Counts only what a human actually wrote and what has actually
   * cleared moderation, so the badge can only ever mean one thing.
   */
  unread_count int,
  /**
   * What the first message was a reply TO: 'trip', 'bio', 'photo:0',
   * 'languages', 'home', 'priority:<n>', or 'pin:<venue>'. Both people
   * already know the message itself; this is the context that made it make
   * sense, and without it an accepted chat opens on a sentence with no
   * subject.
   */
  first_message_element text
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.chat_participants cp on cp.chat_id = c.id and cp.user_id = auth.uid()
    where c.kind = 'direct'
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.room_members rm on rm.chat_id = c.id and rm.user_id = auth.uid()
    where rm.expires_at > now() or rm.role = 'admin'
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    join public.business_staff s
      on s.business_id = b.id and s.user_id = auth.uid()
    union
    -- The owner's own room. Staff get here through business_staff; the owner
    -- is not a staff row, and without this arm a business would open its
    -- Chats tab and find the room it runs missing.
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    where b.owner_user_id = auth.uid()
  )
  select
    m.id,
    m.kind,
    m.status,
    case when m.kind = 'room' then coalesce(b.name, g.name) else op.display_name end,
    other.user_id,
    case when m.kind = 'room' then g.photo_path else
      (select pp.storage_path from public.profile_photos pp
        where pp.user_id = other.user_id and pp.moderation_status = 'approved'
        order by pp.position limit 1) end,
    r.first_message,
    r.sender_id,
    coalesce(lm.body, case when lm.image_path is not null then 'Photo' else null end),
    lm.created_at,
    case when m.kind = 'room'
      then (select count(*)::int from public.room_members rm2
             where rm2.chat_id = m.id and rm2.expires_at > now())
      else null end,
    coalesce(pref.pinned, false),
    coalesce(pref.muted, false),
    pref.archived_at is not null,
    rmine.expires_at,
    m.created_at,
    case when g.chat_id is not null then rmine.role else null end,
    (
      select count(*)::int
      from public.messages msg
      where msg.chat_id = m.id
        and msg.sender_id <> auth.uid()
        and msg.removed_at is null
        and msg.unsent_at is null
        and msg.moderation_status = 'approved'
        and msg.created_at > coalesce(
          pref.last_read_at,
          rmine.joined_at,
          cpmine.created_at,
          m.created_at
        )
    ),
    r.profile_element
  from mine m
  left join public.businesses b on b.chat_id = m.id
  left join public.groups g on g.chat_id = m.id
  left join public.chat_participants other
    on other.chat_id = m.id and other.user_id <> auth.uid() and m.kind = 'direct'
  left join public.chat_participants cpmine
    on cpmine.chat_id = m.id and cpmine.user_id = auth.uid()
  left join public.profiles op on op.user_id = other.user_id
  left join public.message_requests r on r.chat_id = m.id
  left join public.chat_prefs pref on pref.chat_id = m.id and pref.user_id = auth.uid()
  left join public.room_members rmine on rmine.chat_id = m.id and rmine.user_id = auth.uid()
  left join lateral (
    select msg.body, msg.image_path, msg.created_at
    from public.messages msg
    where msg.chat_id = m.id
      and msg.removed_at is null
      and msg.unsent_at is null
      and msg.moderation_status = 'approved'
    order by msg.created_at desc
    limit 1
  ) lm on true
  where (pref.archived_at is not null) = p_archived
  order by coalesce(pref.pinned, false) desc,
           coalesce(lm.created_at, m.created_at) desc
$$;

revoke execute on function public.my_chats(boolean) from public, anon;
grant execute on function public.my_chats(boolean) to authenticated;

-- 5. city_rooms - 9 OUT columns and one of them is literally named
-- `establishment_id`, so this is the RETURNS TABLE change AGENTS.md warns
-- about. DROP first, restate the grant.
--
-- The NAME stays. Shipped iOS builds call `city_rooms` by name over the wire
-- and cannot be updated over the air; renaming it would break the Chat tab on
-- every phone in the field until the App Store caught up. Phase 14 adds
-- `city_businesses` beside it and leaves this as the thin wrapper.
--
-- `order by 7` is positional and points at last_message_at. It survives only
-- because the column order below is unchanged; insert one column and it
-- silently sorts by something else.
drop function if exists public.city_rooms(int);

create function public.city_rooms(p_city_id int)
returns table (
  chat_id uuid,
  business_id uuid,
  name text,
  kind text,
  lat double precision,
  lng double precision,
  member_count int,
  last_message_at timestamptz,
  public_preview boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.chat_id,
    b.id,
    b.name,
    b.category::text,
    b.lat,
    b.lng,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now()),
    (select max(msg.created_at) from public.messages msg where msg.chat_id = b.chat_id),
    b.public_preview
  from public.businesses b
  where b.city_id = p_city_id
    and b.active
    and b.state = 'listed'
    and b.chat_id is not null
  order by 7 desc nulls last
$$;

grant execute on function public.city_rooms(int) to anon, authenticated;

-- 6. room_info - 6 OUT columns AND a comment, so DROP first and restate both
-- the grant and the comment.
drop function if exists public.room_info(uuid);

create function public.room_info(p_chat_id uuid)
returns table (
  chat_id uuid,
  name text,
  kind text,
  member_count int,
  public_preview boolean,
  /** True for a traveler group, false for a business's room. */
  is_group boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(b.name, g.name),
    coalesce(b.category::text, 'group'),
    (select count(*)::int from public.room_members rm
      where rm.chat_id = c.id and rm.expires_at > now()),
    -- A traveler group is never publicly previewable; only a business's room
    -- can be, and only when its owner has switched that on.
    coalesce(b.public_preview, false),
    g.chat_id is not null
  from public.chats c
  left join public.businesses b
    on b.chat_id = c.id and b.active and b.state = 'listed'
  left join public.groups g on g.chat_id = c.id
  where c.id = p_chat_id
    and c.kind = 'room'
    -- Readable by exactly the people who can already read the room itself,
    -- so this adds no visibility of its own: members and moderators, plus
    -- anybody at all for a business that opted into a public preview.
    and (
      coalesce(b.public_preview, false)
      or public.is_room_member(c.id)
      or public.is_room_moderator(c.id)
    )
$$;

grant execute on function public.room_info(uuid) to anon, authenticated;

comment on function public.room_info(uuid) is
  'Name and size of one room, for the header a non-member sees. Adds no '
  'visibility: the WHERE mirrors who can already read the room.';

-- 7. enqueue_message_push - returns trigger, so create-or-replace ONLY. The
-- AFTER INSERT trigger `messages_push` on public.messages depends on it and a
-- DROP would need CASCADE, which would take the trigger with it and leave
-- push notifications silently dead.
create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_room text;
  v_text text;
begin
  select display_name into v_name from public.profiles where user_id = new.sender_id;
  v_text := coalesce(
    nullif(left(new.body, 140), ''),
    case when new.image_path is not null then 'Photo' else 'New message' end
  );

  -- Direct chats: the sender is the title.
  insert into public.push_queue (user_id, title, body, data)
  select cp.user_id,
         coalesce(v_name, 'New message'),
         v_text,
         jsonb_build_object('type', 'message', 'chat_id', new.chat_id)
  from public.chat_participants cp
  where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id;

  -- Rooms and groups: the room is the title, the sender opens the body.
  select coalesce(b.name, g.name) into v_room
    from public.chats c
    left join public.businesses b on b.chat_id = c.id
    left join public.groups g on g.chat_id = c.id
   where c.id = new.chat_id and c.kind = 'room';

  if v_room is not null then
    insert into public.push_queue (user_id, title, body, data)
    select rm.user_id,
           v_room,
           case when v_name is null then v_text else v_name || ': ' || v_text end,
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id)
    from public.room_members rm
    where rm.chat_id = new.chat_id
      and rm.user_id <> new.sender_id
      and not rm.muted
      and rm.archived_at is null
      and rm.expires_at > now();
  end if;

  return new;
end
$$;

revoke execute on function public.enqueue_message_push() from public, anon, authenticated;

-- 8. seed_launch_establishments - the old vocabulary is in the function NAME,
-- so renaming it is a drop and create. Nothing in scripts/ or .github/ calls
-- it; it was run by hand against production once (deploy run 8). The four
-- venues are the same four, and the function stays idempotent on (name,city)
-- so re-running it after this migration is a no-op rather than a duplicate.
drop function if exists public.seed_launch_establishments();

create function public.seed_launch_businesses()
returns integer
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
      where b.name = v_row.venue and ct.name = v_row.city_name
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
      -- The city is not a launch city, so the chat has nothing to belong to.
      delete from public.chats where id = v_chat;
    end if;
  end loop;

  return v_count;
end
$$;

revoke all on function public.seed_launch_businesses() from public, anon, authenticated;

comment on function public.seed_launch_businesses() is
  'Seeds the four launch venues, idempotent on (name, city). Run by hand '
  'after a deploy to a fresh environment; nothing calls it automatically, '
  'because running it inline put a second Lisbon room into the test database '
  'and broke a guest-visibility assertion.';
