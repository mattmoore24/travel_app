-- Groups people make themselves.
--
-- Establishment rooms already gave this schema everything a group chat needs
-- — membership with a stay window, an expiry sweep, pin/mute/archive,
-- reactions, photo moderation, realtime — so a traveler group is the same
-- `chats.kind = 'room'` with a different owner. What is new here is who runs
-- it, who may speak in it, and how somebody gets in.
--
-- Three rules the client cannot talk its way past, all enforced below:
--
--   1. Only the admin changes the group, removes people, or hands out the
--      right to speak.
--   2. When speaking is restricted, a plain member's INSERT into messages is
--      refused by policy, not hidden by a disabled button.
--   3. A joiner picks their own stay-until date, and it cannot exceed the
--      maximum the admin set. Membership expires on its own afterwards, the
--      same sweep that already runs for hostel rooms.

-- Invite tokens are random bytes, which is pgcrypto's job.
create extension if not exists pgcrypto with schema extensions;

create type public.group_speaking as enum ('everyone', 'granted');

create table public.groups (
  chat_id uuid primary key references public.chats (id) on delete cascade,
  -- `set null` rather than cascade: an account deletion must not silently
  -- take a whole group's conversation with it.
  created_by uuid references public.users (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  -- Same private bucket the profile photos use; null is a perfectly good
  -- group photo, so this is never required.
  photo_path text,
  speaking public.group_speaking not null default 'everyone',
  -- The furthest out a joiner may set their own stay-until date.
  max_stay_until date not null,
  created_at timestamptz not null default now(),
  constraint groups_max_stay_sane check (max_stay_until <= (created_at + interval '400 days')::date)
);

create index groups_created_by_idx on public.groups (created_by);

alter table public.groups enable row level security;
revoke all on public.groups from anon;
revoke insert, update, delete, truncate, references, trigger on public.groups from authenticated;
grant select on public.groups to authenticated;

-- Readable by its members (and by anyone holding a live invite, through the
-- definer function further down, which is the only path that does not
-- require membership).
create policy groups_select_member
  on public.groups for select to authenticated
  using (public.is_room_member(chat_id) or public.is_room_moderator(chat_id));

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- room_members is shared with establishment rooms, where the role is carried
-- by establishment_staff instead. 'member' is right for both.
alter table public.room_members
  add column if not exists role text not null default 'member'
    check (role in ('member', 'speaker', 'admin'));

comment on column public.room_members.role is
  'Groups only. admin runs the group; speaker may talk when speaking is '
  'restricted; member is everyone else. Establishment rooms carry their '
  'moderators in establishment_staff and leave this at member.';

-- A group's admin is a moderator, with everything that already implies:
-- removing members, clearing messages, reading the room.
create or replace function public.is_room_moderator(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.establishments e
    join public.establishment_staff s on s.establishment_id = e.id
    where e.chat_id = p_chat_id and s.user_id = auth.uid()
  )
  -- Deliberately NOT filtered on expires_at: an admin whose own stay window
  -- lapsed would otherwise leave the group with nobody able to run it.
  or exists (
    select 1 from public.room_members rm
    where rm.chat_id = p_chat_id and rm.user_id = auth.uid() and rm.role = 'admin'
  )
$$;

/** True unless this is a restricted group and the caller is a plain member. */
create function public.may_speak_in_room(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.groups g
    join public.room_members rm on rm.chat_id = g.chat_id and rm.user_id = auth.uid()
    where g.chat_id = p_chat_id
      and g.speaking = 'granted'
      and rm.role = 'member'
  )
$$;

revoke execute on function public.may_speak_in_room(uuid) from public, anon;

-- Sending now respects the group's speaking setting. Everything else about
-- this function is unchanged.
create or replace function public.can_send_in_chat(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.users u on u.id = auth.uid()
    where c.id = p_chat_id
      and c.status = 'active'
      and u.status in ('active', 'shadowbanned')
      and (
        exists (select 1 from public.chat_participants cp
                where cp.chat_id = c.id and cp.user_id = auth.uid())
        or (public.is_room_member(c.id) and public.may_speak_in_room(c.id))
        or public.is_room_moderator(c.id)
      )
  )
$$;

-- An admin who has stopped being a member should still be a member for the
-- sweep's purposes. Simplest correct rule: the sweep never removes an admin.
create or replace function public.expire_room_members()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.room_members where expires_at <= now() and role <> 'admin';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- Making one
-- ---------------------------------------------------------------------------

create function public.create_group(
  p_name text,
  p_max_stay_until date,
  p_speaking public.group_speaking default 'everyone',
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_recent int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  if p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;

  -- Anyone can make a group; nobody can make forty. Serialised per person so
  -- two taps cannot both see a stale count.
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_user::text));
  select count(*) into v_recent
    from public.groups
   where created_by = v_user and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'You have started a few groups today already.'
      using errcode = 'check_violation';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;
  insert into public.groups (chat_id, created_by, name, photo_path, speaking, max_stay_until)
  values (v_chat, v_user, btrim(p_name), p_photo_path, p_speaking, p_max_stay_until);

  -- The creator runs it, and their own membership runs to the group's own
  -- horizon rather than a week from now.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (
    v_chat,
    v_user,
    p_max_stay_until,
    (p_max_stay_until + 7)::timestamptz,
    'admin'
  );

  return v_chat;
end
$$;

create function public.update_group(
  p_chat_id uuid,
  p_name text default null,
  p_speaking public.group_speaking default null,
  p_max_stay_until date default null,
  p_photo_path text default null,
  p_clear_photo boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;

  update public.groups
     set name = coalesce(btrim(p_name), name),
         speaking = coalesce(p_speaking, speaking),
         max_stay_until = coalesce(p_max_stay_until, max_stay_until),
         photo_path = case
           when p_clear_photo then null
           else coalesce(p_photo_path, photo_path)
         end
   where chat_id = p_chat_id;
end
$$;

/**
 * Grant or take back the right to speak. 'admin' is deliberately not
 * settable here: handing the group to somebody else is a different decision
 * from letting them talk, and it should not share a control.
 */
create function public.set_group_role(p_chat_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;
  if p_role not in ('member', 'speaker') then
    raise exception 'unknown role %', p_role using errcode = 'check_violation';
  end if;
  update public.room_members
     set role = p_role
   where chat_id = p_chat_id and user_id = p_user_id and role <> 'admin';
end
$$;

/** Who is in a group, for the admin's list. Members see it too: a group
    chat where you cannot see who is in the room is a worse product. */
create function public.group_members(p_chat_id uuid)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  role text,
  departure_date date,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rm.user_id,
    p.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = rm.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    rm.role,
    rm.departure_date,
    rm.joined_at
  from public.room_members rm
  left join public.profiles p on p.user_id = rm.user_id
  where rm.chat_id = p_chat_id
    and (public.is_room_member(p_chat_id) or public.is_room_moderator(p_chat_id))
  order by
    case rm.role when 'admin' then 0 when 'speaker' then 1 else 2 end,
    p.display_name
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

create table public.group_invites (
  token text primary key check (char_length(token) between 16 and 64),
  chat_id uuid not null references public.chats (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index group_invites_chat_idx on public.group_invites (chat_id);

alter table public.group_invites enable row level security;
-- No policies at all, on purpose. A link is a bearer token: anyone who can
-- SELECT this table can enumerate every group's invite. The only ways in are
-- the two definer functions below, which take a token and never hand one out.
revoke all on public.group_invites from anon, authenticated;

/**
 * The current link for a group, minted on demand. One live token per group:
 * sharing again gives the same link, so a person who already has it is not
 * cut off every time the admin opens the share sheet.
 */
create function public.group_invite_token(p_chat_id uuid)
returns text
language plpgsql
security definer
-- extensions too: gen_random_bytes is pgcrypto's, and Supabase installs
-- pgcrypto into the extensions schema rather than public.
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;

  select token into v_token
    from public.group_invites
   where chat_id = p_chat_id and revoked_at is null and expires_at > now()
   order by created_at desc
   limit 1;

  if v_token is null then
    -- url-safe: base64 with the two awkward characters folded away, so the
    -- token survives being pasted into a text message.
    -- 18 bytes is 24 base64 characters and no padding; the three awkward
    -- characters are folded away so the token survives a text message.
    v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', 'abc');
    insert into public.group_invites (token, chat_id, created_by, expires_at)
    values (v_token, p_chat_id, auth.uid(), now() + interval '30 days');
  end if;

  return v_token;
end
$$;

/** Invalidate every outstanding link for a group. */
create function public.revoke_group_invites(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;
  update public.group_invites
     set revoked_at = now()
   where chat_id = p_chat_id and revoked_at is null;
end
$$;

/**
 * What a link shows before you accept it. Readable without membership by
 * design — that is what a link is for — so it returns only what a stranger
 * needs to decide: the name, the photo, how many people, how long they may
 * stay. No member list, no messages.
 */
create function public.group_invite_preview(p_token text)
returns table (
  chat_id uuid,
  name text,
  photo_path text,
  member_count int,
  max_stay_until date,
  speaking public.group_speaking,
  already_member boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.chat_id,
    g.name,
    g.photo_path,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = g.chat_id and rm.expires_at > now()),
    g.max_stay_until,
    g.speaking,
    exists (
      select 1 from public.room_members rm2
      where rm2.chat_id = g.chat_id and rm2.user_id = auth.uid() and rm2.expires_at > now()
    )
  from public.group_invites i
  join public.groups g on g.chat_id = i.chat_id
  join public.chats c on c.id = g.chat_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and c.status = 'active'
$$;

/**
 * Accept a link. The stay-until date is the joiner's own choice, clamped to
 * the admin's maximum here rather than trusted from the client.
 */
create function public.join_group_with_invite(p_token text, p_stay_until date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_max date;
  v_stay date;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  select g.chat_id, g.max_stay_until into v_chat, v_max
    from public.group_invites i
    join public.groups g on g.chat_id = i.chat_id
    join public.chats c on c.id = g.chat_id
   where i.token = p_token
     and i.revoked_at is null
     and i.expires_at > now()
     and c.status = 'active';

  if v_chat is null then
    raise exception 'That invite has expired or been withdrawn.' using errcode = '42501';
  end if;
  if p_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;

  v_stay := least(p_stay_until, v_max);
  -- A week of grace after you leave, the same as a hostel room, so a
  -- conversation does not vanish the morning you fly out.
  v_expires := (v_stay + 7)::timestamptz;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (v_chat, v_user, v_stay, v_expires)
  on conflict (chat_id, user_id) do update
    set departure_date = excluded.departure_date,
        expires_at = excluded.expires_at,
        archived_at = null;

  return jsonb_build_object('chat_id', v_chat, 'stay_until', v_stay, 'expires_at', v_expires);
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function
  public.create_group(text, date, public.group_speaking, text),
  public.update_group(uuid, text, public.group_speaking, date, text, boolean),
  public.set_group_role(uuid, uuid, text),
  public.group_members(uuid),
  public.group_invite_token(uuid),
  public.revoke_group_invites(uuid),
  public.group_invite_preview(text),
  public.join_group_with_invite(text, date)
from public, anon;

grant execute on function
  public.create_group(text, date, public.group_speaking, text),
  public.update_group(uuid, text, public.group_speaking, date, text, boolean),
  public.set_group_role(uuid, uuid, text),
  public.group_members(uuid),
  public.group_invite_token(uuid),
  public.revoke_group_invites(uuid),
  public.group_invite_preview(text),
  public.join_group_with_invite(text, date)
to authenticated;

-- ---------------------------------------------------------------------------
-- my_chats has to know about groups
-- ---------------------------------------------------------------------------
--
-- It named every room from `establishments`, so a traveler group would have
-- shown up in the Chat tab with no name and no photo. Postgres refuses to add
-- an OUT column to an existing RETURNS TABLE signature, so this drops first —
-- and the grants have to be restated afterwards, because the drop takes them.

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
  /** Groups only: null for direct chats and establishment rooms. */
  my_role text
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
    join public.establishments e on e.chat_id = c.id
    join public.establishment_staff s
      on s.establishment_id = e.id and s.user_id = auth.uid()
  )
  select
    m.id,
    m.kind,
    m.status,
    case when m.kind = 'room' then coalesce(e.name, g.name) else op.display_name end,
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
    case when g.chat_id is not null then rmine.role else null end
  from mine m
  left join public.establishments e on e.chat_id = m.id
  left join public.groups g on g.chat_id = m.id
  left join public.chat_participants other
    on other.chat_id = m.id and other.user_id <> auth.uid() and m.kind = 'direct'
  left join public.profiles op on op.user_id = other.user_id
  left join public.message_requests r on r.chat_id = m.id
  left join public.chat_prefs pref on pref.chat_id = m.id and pref.user_id = auth.uid()
  left join public.room_members rmine on rmine.chat_id = m.id and rmine.user_id = auth.uid()
  left join lateral (
    select msg.body, msg.image_path, msg.created_at
    from public.messages msg
    where msg.chat_id = m.id and msg.removed_at is null
    order by msg.created_at desc
    limit 1
  ) lm on true
  where (pref.archived_at is not null) = p_archived
  order by coalesce(pref.pinned, false) desc,
           coalesce(lm.created_at, m.created_at) desc
$$;

revoke execute on function public.my_chats(boolean) from public, anon;
grant execute on function public.my_chats(boolean) to authenticated;

-- A group's photo lives in the same private bucket as chat photos, which
-- already has a signed-URL read path the client uses.
