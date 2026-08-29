-- A business account is served no travelers, and it runs the room it owns.
--
-- Founder, testing as a business: "under no circumstances should a business
-- account ever have the option to join a chat of any other business or other
-- pin of any kind. The map page as a business isn't used for that purpose."
--
-- 20260829190000 closed every WRITE a business could reach: join a room, join
-- a plan, post one, start a group, set an audience. It left the READS open.
-- `city_pins` is the whole traveler feed for a city — user_id, display name,
-- age, verified badge, photo path, venue, note and the date they mean to go —
-- and it answered a business account exactly as it answers a traveler. So the
-- one thing the founder says the business map is not for was one RPC call
-- away, with the anon key that ships in the bundle. `traveler_trips` was the
-- same read one person at a time: hand it a uuid, get their city and their
-- dates.
--
-- The client half of this is shipping in parallel (a business is pointed at
-- `public_city_pins`, which carries no people at all). That is UX. This file
-- is the rule.
--
-- No OUT column changes anywhere below, so `create or replace` is legal and
-- every grant survives — see the traps skill for the version of this file
-- that would have failed halfway through a deploy. The one new function is
-- granted explicitly.
--
-- Each refusal is an empty answer rather than an exception. A business that
-- somehow reaches one of these reads has not done anything wrong, and
-- `saveFailureMessage` prints a Postgres message to a person verbatim.

-- ---------------------------------------------------------------------------
-- 1. The one question about a business account anybody may ask
-- ---------------------------------------------------------------------------
--
-- `is_business_account(uuid)` cannot be used here. 20260827160000 revoked it
-- from `authenticated` on purpose: it takes a user id, so any uuid lifted off
-- a profile page could be posted to it, and the answer is the thing the
-- column grant hiding `businesses.owner_user_id` exists to withhold.
--
-- `city_pins` is SECURITY INVOKER — deliberately, because it leans on the
-- `profiles` and `pins` policies for everything else it filters — so its body
-- runs with the caller's privileges and cannot call a function the caller may
-- not execute. This one takes no argument. There is nothing to walk: it
-- answers about the caller and nobody else.

create function public.viewer_is_business()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses where owner_user_id = auth.uid()
  )
$$;

revoke execute on function public.viewer_is_business() from public, anon;
grant execute on function public.viewer_is_business() to authenticated;

comment on function public.viewer_is_business() is
  'True when the CALLER runs a business. The argument-free half of '
  'is_business_account, safe to grant because it answers about auth.uid() '
  'and cannot be handed somebody else''s id.';

-- ---------------------------------------------------------------------------
-- 2. The city feed
-- ---------------------------------------------------------------------------
--
-- Restated verbatim from 20260829120000 with one line added to the WHERE.
-- The predicate sits beside `discovery_pair_ok` because it is the same kind
-- of fact: who this feed is for.

create or replace function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  note text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
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
    p.note,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    p.seed_note,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.created_at
$$;

comment on function public.city_pins(int) is
  'Every open plan in a city, with the face behind each one. Empty for a '
  'business account: the business map shows businesses, and this is the '
  'traveler feed the founder said it is not for.';

-- ---------------------------------------------------------------------------
-- 3. One traveler's dates
-- ---------------------------------------------------------------------------
--
-- The same read, one person at a time, and the one that survives a closed
-- feed: a business that already holds a uuid — from a chat, from a rating,
-- from a room it runs — could ask where that person is going and when.
--
-- Restated verbatim from 20260821090000 with the one predicate added. The
-- date arithmetic and the day of slack are untouched.

create or replace function public.traveler_trips(p_user_id uuid)
returns table (
  trip_id uuid,
  city_id int,
  city_name text,
  city_country text,
  start_date date,
  end_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, c.id, c.name, c.country_name, t.start_date, t.end_date
  from public.trips t
  join public.cities c on c.id = t.city_id
  where t.user_id = p_user_id
    and t.status = 'active'
    and t.end_date >= current_date - 1
    and auth.uid() is not null
    and not public.viewer_is_business()
    and (
      p_user_id = auth.uid()
      or (public.is_discoverable_owner(p_user_id) and not public.is_blocked_pair(p_user_id))
    )
  order by t.start_date
$$;

-- ---------------------------------------------------------------------------
-- 4. Who is already going
-- ---------------------------------------------------------------------------
--
-- 20260829140000 closed this to guests for exactly this reason: a roster of
-- names and photo paths for every open plan in a city, readable from outside
-- without joining anything. A business account was the other caller holding
-- `authenticated` that has no business reading it. Same shape, same line.
--
-- Restated verbatim from 20260829140000.

create or replace function public.pin_crew(p_pin_id uuid)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rm.user_id,
    pr.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = rm.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    rm.role = 'admin',
    rm.joined_at
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.room_members rm on rm.chat_id = g.chat_id and rm.expires_at > now()
  left join public.profiles pr on pr.user_id = rm.user_id
  where p.id = p_pin_id
    and p.expires_at > now()
    and not public.is_guest_account()
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
    and not public.is_blocked_pair(rm.user_id)
  order by (rm.role = 'admin') desc, rm.joined_at
  limit 20
$$;

comment on function public.pin_crew(uuid) is
  'Who is already going, for the faces on an open plan. Empty for a guest '
  'and empty for a business: neither of them can join one, and a roster you '
  'cannot join is somebody else''s list of names.';

-- ---------------------------------------------------------------------------
-- 5. The featured traveler
-- ---------------------------------------------------------------------------
--
-- A whole profile card — name, age, bio, languages, face — keyed only by a
-- city id. A business has no Travelers tab to render it on, so nothing in the
-- business app asks; this is so that the answer is nothing if anything does.
--
-- Restated verbatim from 20260823030000. It keeps its `anon` grant: a
-- signed-out visitor IS who this card is for, and the guard reads the caller,
-- not the role.

create or replace function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    c.name,
    t.start_date,
    t.end_date,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = t.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
  from public.trips t
  join public.profiles p on p.user_id = t.user_id
  join public.cities c on c.id = t.city_id
  join public.users u on u.id = t.user_id
  where t.city_id = p_city_id
    and t.status = 'active'
    and u.status = 'active'
    and p.onboarding_completed_at is not null
    and t.end_date >= current_date - 1
    and t.start_date <= current_date + 14
    and not public.viewer_is_business()
    and exists (
      select 1 from public.profile_photos pp
      where pp.user_id = t.user_id
        and pp.moderation_status = 'approved'
        and pp.position = 0
    )
    and public.discovery_pair_ok(auth.uid(), t.user_id)
  order by
    (select count(*) from public.message_requests r
      where r.recipient_id = t.user_id
        and r.created_at > now() - interval '30 days') desc,
    p.verified desc,
    t.created_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 6. A business never writes first
-- ---------------------------------------------------------------------------
--
-- §7 rule 8, and the one door left in it. `send_message_request` and
-- `message_business` both refuse a business sender. `open_direct_chat` guards
-- the SUBJECT — you cannot open one with a business — and never asked who was
-- calling. It closed by accident: the caller must share a group with the
-- person, and a business is in no groups, so it fell out at
-- "You two are not in a group together yet." Which is true of every traveler
-- alive and reads like a thing that might one day be false.
--
-- Restated verbatim from 20260829130000 with the guard beside the guest one.

create or replace function public.open_direct_chat(p_user_id uuid, p_first_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_verdict jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_guest_account(v_user) then
    raise exception 'make an account to message someone one to one'
      using errcode = 'check_violation';
  end if;
  perform public.assert_not_business('message a traveler first');
  if p_user_id is not distinct from v_user then
    raise exception 'that is you' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_first_message, ''))) = 0 then
    raise exception 'write something first' using errcode = 'check_violation';
  end if;

  if public.is_blocked_pair(p_user_id)
     or public.is_business_account(p_user_id)
     or public.is_guest_account(p_user_id) then
    raise exception 'that traveler is unavailable' using errcode = '42501';
  end if;

  -- An existing one-to-one chat is its own permission: you two are already
  -- talking. Otherwise the door is a shared group and nothing else.
  select c.id into v_chat
    from public.chats c
    join public.chat_participants a on a.chat_id = c.id and a.user_id = v_user
    join public.chat_participants b on b.chat_id = c.id and b.user_id = p_user_id
   where c.status = 'active' and c.kind = 'direct'
   limit 1;

  if v_chat is null and not public.shares_group_with(p_user_id) then
    raise exception 'You two are not in a group together yet.' using errcode = '42501';
  end if;

  -- §7 rule 5. There is no accept step here to hold a bad first message
  -- behind, so it is screened at the door and a blocked one creates nothing
  -- at all — the same shape message_business uses.
  v_verdict := public.screen_first_message(p_first_message);
  if (v_verdict ->> 'action') = 'block' then
    return jsonb_build_object('blocked', true);
  end if;

  if v_chat is null then
    insert into public.chats (kind, opened_from_room) values ('direct', true)
    returning id into v_chat;
    insert into public.chat_participants (chat_id, user_id)
    values (v_chat, v_user), (v_chat, p_user_id);
  end if;

  insert into public.messages (chat_id, sender_id, body, moderation_status)
  values (v_chat, v_user, btrim(p_first_message), 'approved');

  return jsonb_build_object('chat_id', v_chat, 'blocked', false);
end
$$;

-- ---------------------------------------------------------------------------
-- 7. A room knows which business runs it
-- ---------------------------------------------------------------------------
--
-- `business_for_chat` matched `kind = 'business'`, which is the DM a traveler
-- opens from a listing. A business's PUBLIC room is `kind = 'room'`, and its
-- id is `businesses.chat_id`. So the function answered NULL for every room —
-- including, absurdly, the room the caller runs — and src/app/room/[id].tsx
-- read that null as "this is a traveler group". The owner fell through every
-- branch as an ordinary visitor, and a traveler who joined from the map had
-- no route back to the hours, the address and the rating they joined from.
--
-- Two arms, own-room first, because that is the one that was missing. Scalar
-- return, so create-or-replace is legal and the grant stands.

create or replace function public.business_for_chat(p_chat_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- The public room. `businesses.chat_id` IS the room, so there is nothing
    -- to join through and nothing to disagree with itself.
    (select b.id from public.businesses b where b.chat_id = p_chat_id),
    -- The DM, as before: the business is whoever on the other side runs one.
    (select b.id
       from public.chats c
       join public.chat_participants cp on cp.chat_id = c.id
       join public.businesses b on b.owner_user_id = cp.user_id
      where c.id = p_chat_id and c.kind = 'business'
      limit 1)
  )
$$;

comment on function public.business_for_chat(uuid) is
  'Which business a chat belongs to: its public room, or the one-to-one a '
  'traveler opened with it. NULL for a traveler group, and that null is how '
  'the room screen tells the two apart.';

-- ---------------------------------------------------------------------------
-- 8. The person who runs a room has a role in it
-- ---------------------------------------------------------------------------
--
-- `my_role` was set only where a `groups` row existed, so it was NULL in a
-- business's own room. The owner has no `room_members` row either — the
-- room_members trigger refuses a business one on purpose, and that is the
-- rule that means nobody ever asks a business when it is leaving — so there
-- was nothing else for the screen to read. The result: the one person who
-- runs the chat was handed "Report" where "Remove" belongs, and no pin
-- control at all, while `is_room_moderator` has answered true for them
-- server-side since 20260827160000.
--
-- Answered here so the client reads it rather than deriving it. Note for
-- whoever wires up `business_staff` (nothing writes to it today): a staff
-- member who is also a traveler now sees this room in their chat list with
-- my_role = 'admin', and src/app/add-to-group/[userId].tsx lists exactly
-- `kind = 'room' and my_role != null` as "groups you can add someone to".
-- `add_to_group` refuses a chat with no `groups` row, so that would be a
-- button that fails. Filter it there when staff become real.
--
-- Body-only change: the OUT columns are identical, so create-or-replace is
-- correct and both grants survive.

create or replace function public.my_chats(p_archived boolean default false)
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
  my_role text,
  unread_count int,
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
    where c.kind in ('direct', 'business')
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.room_members rm on rm.chat_id = c.id and rm.user_id = auth.uid()
    -- A closed group is a finished conversation its members keep. Their own
    -- stay lapsing must not take it off the list: expire_room_members already
    -- refuses to sweep the row, and this is the other half of that promise.
    where rm.expires_at > now() or rm.role = 'admin'
       or public.group_chat_closed(c.id)
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    join public.business_staff s
      on s.business_id = b.id and s.user_id = auth.uid()
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    where b.owner_user_id = auth.uid()
  )
  select
    m.id,
    m.kind,
    m.status,
    case
      when m.kind = 'room' then coalesce(b.name, g.name)
      -- A traveler sees the PLACE; the business sees the person.
      when m.kind = 'business' then coalesce(ob.name, op.display_name)
      else op.display_name
    end,
    other.user_id,
    case
      when m.kind = 'room' then g.photo_path
      when m.kind = 'business' and ob.id is not null then
        (select bp.storage_path from public.business_photos bp
          where bp.business_id = ob.id and bp.moderation_status = 'approved'
          order by bp.position limit 1)
      else
        (select pp.storage_path from public.profile_photos pp
          where pp.user_id = other.user_id and pp.moderation_status = 'approved'
          order by pp.position limit 1)
    end,
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
    case
      -- A business's own room. No groups row, no room_members row, and until
      -- now no role either.
      when b.chat_id is not null then
        case when public.is_room_moderator(m.id) then 'admin' else null end
      when g.chat_id is not null then rmine.role::text
      else null
    end,
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
    on other.chat_id = m.id and other.user_id <> auth.uid()
   and m.kind in ('direct', 'business')
  left join public.chat_participants cpmine
    on cpmine.chat_id = m.id and cpmine.user_id = auth.uid()
  left join public.profiles op on op.user_id = other.user_id
  -- The business on the other end, when the reader is the traveler.
  left join public.businesses ob
    on m.kind = 'business' and ob.owner_user_id = other.user_id
  left join lateral (
    select mr.first_message, mr.sender_id, mr.profile_element
    from public.message_requests mr
    where mr.chat_id = m.id
    order by mr.created_at
    limit 1
  ) r on true
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
    -- Shadowbanning only works if it is invisible to the person being
    -- shadowbanned and total for everybody else. A business reading its
    -- inbox is everybody else.
    and (
      m.kind <> 'business'
      or not public.is_business_account(auth.uid())
      or public.is_visible_owner(other.user_id)
    )
  order by coalesce(pref.pinned, false) desc,
           coalesce(lm.created_at, m.created_at) desc
$$;

-- ---------------------------------------------------------------------------
-- Swept and left alone, so the next reader does not re-check them
-- ---------------------------------------------------------------------------
--
-- `get_matches` and `daily_spotlight` both start from the CALLER's own trips,
-- and the trips table has refused a business row since 20260827100000. They
-- answer a business account with nothing already, and a predicate that can
-- never fire is a comment pretending to be code.
--
-- `people_you_know` walks direct chats and traveler groups; a business is in
-- neither. `group_members` and `room_messages` are gated on membership or
-- moderation, so a business reaches its own room and nothing else, which is
-- correct — the people in the room it runs are its guests.
--
-- `heat_cells` stays open to a business. It carries no identities at all and
-- never draws a cell under the k-threshold (§7 rule 6); "how busy is my
-- street on a Friday" is a fair question for the business whose street it is.

notify pgrst, 'reload schema';
