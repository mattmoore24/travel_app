-- Adding people without a link, and talking to people you already know
-- =============================================================================
--
-- Two gaps the founder named, which turn out to be the same gap:
--
--   * The only way to put somebody in a group was to send them a link. Out of
--     the app, into iMessage or WhatsApp, which means you need their phone
--     number — for a person you met in a hostel two hours ago.
--   * The only way to message somebody was to say hi and wait to be accepted,
--     even when the two of you had been talking in the same group all day.
--
-- Both are the same missing idea: people you already know. This file writes
-- that idea down once — you know somebody if you share an active direct chat
-- or an active traveler group with them — and hangs three doors off it:
-- search them, add them to a group, message them.
--
-- THE TWO RULES THIS FILE IS CAREFUL WITH
--
-- §7 rule 4, social handles are never visible before an accept. A direct chat
-- with two participant rows is what unlocks handles today, and this file
-- creates direct chats with no accept anywhere. So the gate moves rather than
-- widening: a chat opened this way is stamped `opened_from_room`, and for
-- those the handles stay locked until BOTH people have actually said
-- something. That is a stronger test than the one it joins, not a weaker one
-- — accepting a request is a single tap by one person, and this needs a real
-- exchange — and every chat that exists today is untouched by it.
--
-- §7 rule 5, every first message passes moderation. The first message here is
-- screened synchronously by screen_first_message and, if it fails, no chat is
-- created and nothing is delivered. That is exactly what message_business
-- does, and for the same reason: a conversation that opens without an accept
-- has to be screened at the door instead.
--
-- WHAT IS DELIBERATELY NOT INCLUDED
--
-- Venue rooms. A traveler group is a group somebody made and let you into; a
-- venue's room is open to anybody signed in, so "we are in the same room"
-- there means only "we both tapped the same bar". Free direct messages out of
-- one would be a stranger-messaging channel with the say-hi gate removed, so
-- every predicate below joins `groups` and not just `room_members`.
--
-- Guests. An anonymous account can talk in a group it was let into and that
-- is the whole of it — it cannot be found by search, cannot be added to a
-- second group, and cannot open or receive a one-to-one chat. It has no
-- profile to look up, the janitor deletes it when its last membership goes,
-- and the existing rule (message_requests_no_guests) already says an
-- unaccountable identity does not get put in front of somebody one-to-one.

-- ---------------------------------------------------------------------------
-- 1. Where a chat came from
-- ---------------------------------------------------------------------------

alter table public.chats
  add column opened_from_room boolean not null default false;

comment on column public.chats.opened_from_room is
  'True for a one-to-one chat opened because both people were already in the '
  'same group, with no message request and no accept. Read by '
  'handles_unlocked_for: §7 rule 4 keeps social handles hidden until an '
  'accept, and there was not one, so these unlock on a real exchange instead.';

-- ---------------------------------------------------------------------------
-- 2. The handle gate, which now has two ways to open
-- ---------------------------------------------------------------------------
--
-- has_accepted_chat itself is left exactly as it is, on purpose. Six callers
-- use it to ask "do these two already have a conversation" — send_message_
-- request's already-connected branch, the spotlight's suppression — and the
-- answer to that question is yes the moment the chat exists. Only the handle
-- policy needs the stricter test, so only the handle policy gets it.

create function public.handles_unlocked_for(owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants po
      on po.chat_id = c.id and po.user_id = owner_id
    join public.chat_participants pv
      on pv.chat_id = c.id and pv.user_id = auth.uid()
    where c.status = 'active'
      and c.kind = 'direct'
      and owner_id <> auth.uid()
      and (
        not c.opened_from_room
        or (
          exists (select 1 from public.messages m
                   where m.chat_id = c.id and m.sender_id = owner_id)
          and exists (select 1 from public.messages m
                       where m.chat_id = c.id and m.sender_id = auth.uid())
        )
      )
  )
$$;

revoke execute on function public.handles_unlocked_for(uuid) from public, anon;
grant execute on function public.handles_unlocked_for(uuid) to authenticated;

drop policy social_handles_select_gated on public.social_handles;

create policy social_handles_select_gated
  on public.social_handles for select to authenticated
  using (
    user_id = auth.uid()
    or public.handles_unlocked_for(user_id)
  );

-- ---------------------------------------------------------------------------
-- 3. People you already know
-- ---------------------------------------------------------------------------

create function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members mine
    join public.groups g on g.chat_id = mine.chat_id
    join public.chats c on c.id = g.chat_id and c.status = 'active'
    join public.room_members them
      on them.chat_id = mine.chat_id and them.user_id = p_user_id
    where mine.user_id = auth.uid()
      and mine.expires_at > now()
      and them.expires_at > now()
      and p_user_id is distinct from auth.uid()
  )
$$;

-- Caller-scoped, like every other relationship predicate in this schema: it
-- binds auth.uid() inside rather than taking a viewer, so no client can use
-- it to walk the who-knows-whom graph.
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.shares_group_with(uuid) to authenticated;

create function public.knows_traveler(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_accepted_chat(p_user_id) or public.shares_group_with(p_user_id)
$$;

revoke execute on function public.knows_traveler(uuid) from public, anon;
grant execute on function public.knows_traveler(uuid) to authenticated;

-- The search itself. Empty query returns the whole list, which is the point:
-- most people have met a handful of travelers, and making them type before
-- anything appears would hide the feature from the people it is for.
create function public.people_you_know(p_query text default null)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  verified boolean,
  chatted boolean,
  in_a_group boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with known as (
    select them.user_id as uid, false as via_group
      from public.chat_participants mine
      join public.chats c
        on c.id = mine.chat_id and c.status = 'active' and c.kind = 'direct'
      join public.chat_participants them
        on them.chat_id = c.id and them.user_id <> mine.user_id
     where mine.user_id = auth.uid()
    union all
    select them.user_id, true
      from public.room_members mine
      join public.groups g on g.chat_id = mine.chat_id
      join public.chats c on c.id = g.chat_id and c.status = 'active'
      join public.room_members them
        on them.chat_id = mine.chat_id and them.user_id <> mine.user_id
     where mine.user_id = auth.uid()
       and mine.expires_at > now()
       and them.expires_at > now()
  )
  select
    k.uid,
    pr.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = k.uid and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    pr.verified,
    bool_or(not k.via_group),
    bool_or(k.via_group)
  from known k
  join public.profiles pr on pr.user_id = k.uid
  join public.users u on u.id = k.uid and u.status in ('active', 'shadowbanned')
  where not public.is_blocked_pair(k.uid)
    and not public.is_business_account(k.uid)
    and not public.is_guest_account(k.uid)
    and (
      p_query is null
      or btrim(p_query) = ''
      or pr.display_name ilike '%' || btrim(p_query) || '%'
    )
  group by k.uid, pr.display_name, pr.verified
  order by pr.display_name
  limit 40
$$;

revoke execute on function public.people_you_know(text) from public, anon;
grant execute on function public.people_you_know(text) to authenticated;

comment on function public.people_you_know(text) is
  'Travelers the caller already shares an active direct chat or an active '
  'traveler group with. The address book the app never had, so that adding '
  'somebody to a group does not require their phone number.';

-- ---------------------------------------------------------------------------
-- 4. Adding one of them to a group
-- ---------------------------------------------------------------------------
--
-- Any member may add, not only an admin. That is the founder's call and it
-- matches how the invite link already behaves — a link is copyable by anybody
-- in the group, so "only admins can bring people" was never true, it was just
-- slower. What an admin still has that a member does not is removal.

create function public.add_to_group(p_chat_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_max date;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_guest_account(v_user) then
    raise exception 'make an account to add people to a group'
      using errcode = 'check_violation';
  end if;
  if p_user_id is not distinct from v_user then
    raise exception 'You are already in this group.' using errcode = 'check_violation';
  end if;

  select g.max_stay_until into v_max
    from public.groups g
    join public.chats c on c.id = g.chat_id and c.status = 'active'
   where g.chat_id = p_chat_id;
  if not found then
    raise exception 'That group is not open.' using errcode = '42501';
  end if;
  if public.group_chat_closed(p_chat_id) then
    raise exception 'This chat has ended.' using errcode = '42501';
  end if;

  if not (public.is_room_member(p_chat_id) or public.is_room_moderator(p_chat_id)) then
    raise exception 'That group is not open.' using errcode = '42501';
  end if;

  -- You may only bring somebody you actually know. Without this, a member
  -- could add any uuid they could get hold of, which is a way of putting a
  -- stranger in front of you that skips the say-hi gate entirely.
  if not public.knows_traveler(p_user_id) then
    raise exception 'You can only add people you have chatted with.'
      using errcode = '42501';
  end if;
  if public.is_blocked_pair(p_user_id)
     or public.is_business_account(p_user_id)
     or public.is_guest_account(p_user_id) then
    raise exception 'You can only add people you have chatted with.'
      using errcode = '42501';
  end if;

  if (
    select coalesce(max(created_at) filter (where action = 'removed_by_moderator'),
                    '-infinity'::timestamptz)
         > coalesce(max(created_at) filter (where action = 'readmitted_by_moderator'),
                    '-infinity'::timestamptz)
      from public.moderation_events
     where subject_user_id = p_user_id
       and entity_type = 'room_member'
       and entity_id = p_chat_id
  ) then
    raise exception 'An admin removed them from this group.' using errcode = '42501';
  end if;

  -- Same horizon the group gives anybody who joins by link: a week of grace
  -- past its last day, or no end at all when it has none.
  v_expires := case
    when v_max is null then 'infinity'::timestamptz
    else (v_max + 7)::timestamptz
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (p_chat_id, p_user_id, v_max, v_expires)
  on conflict (chat_id, user_id) do update
    set expires_at = greatest(room_members.expires_at, excluded.expires_at),
        archived_at = null;

  return jsonb_build_object('chat_id', p_chat_id, 'user_id', p_user_id);
end
$$;

revoke execute on function public.add_to_group(uuid, uuid) from public, anon;
grant execute on function public.add_to_group(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Messaging one of them, with no hello to wait on
-- ---------------------------------------------------------------------------

create function public.open_direct_chat(p_user_id uuid, p_first_message text)
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

revoke execute on function public.open_direct_chat(uuid, text) from public, anon;
grant execute on function public.open_direct_chat(uuid, text) to authenticated;

comment on function public.open_direct_chat(uuid, text) is
  'Start a one-to-one chat with somebody you are already in a group with, '
  'with no request and no accept. Social handles stay locked until you have '
  'both spoken (see handles_unlocked_for) — §7 rule 4 — and the first message '
  'is screened before anything is created — §7 rule 5.';
