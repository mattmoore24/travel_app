-- "Chat is active until", and a group that never closes.
--
-- The founder asked for three things: a no-end-date option, a rename from
-- "People can stay until" to "Chat is active until", and copy clarifying that
-- the chat is active THROUGH that date and closes the following day.
--
-- The third one was not true, in three separate ways, and shipping the
-- sentence alone would have been a lie:
--   1. max_stay_until was a CAP on how far ahead each joiner could set their
--      own departure date, not the chat's lifetime.
--   2. Every membership got a further 7 days of grace on top of that date.
--   3. Nothing anywhere ever closed a group chat. chats.status has always had
--      'closed' and can_send_in_chat has always required 'active', but no code
--      path set it.
-- So the date now means what the label says, and this migration is what makes
-- it mean that.
--
-- FOUNDER'S TWO CALLS, both asked and both answered before this was written:
--   * A NEW group starts on "No end date". Under the old meaning a 30-day
--     default was harmless; under the new one it would have silently ended
--     every conversation nobody thought to configure.
--   * EXISTING groups keep their dates, and any already in the past is pushed
--     forward, so nothing goes dark the moment this deploys.

-- ---------------------------------------------------------------------------
-- 1. The column learns to be empty
-- ---------------------------------------------------------------------------

alter table public.groups alter column max_stay_until drop not null;

-- The 400-day ceiling moves OUT of the table and INTO the two RPCs.
--
-- Not tidying: `check (max_stay_until <= (created_at + interval '400 days'))`
-- is anchored to CREATED_AT, so on a group made 400 days ago there is no
-- future date its admin can legally set — every attempt raises 23514. Today
-- that is survivable because the column only capped joiners. The moment the
-- date decides whether the chat is open, an old group whose date has passed
-- becomes unrecoverable: closed, with the one control that would reopen it
-- refusing every value. A ceiling belongs where a sentence can live.
alter table public.groups drop constraint groups_max_stay_sane;

comment on column public.groups.max_stay_until is
  'The last day this chat is active. It closes at group_closes_at(), the day '
  'after. NULL means no end date: the chat never closes. Also still the cap on '
  'how far ahead a joiner may set their own departure date.';

-- The founder's call: keep every stated date, move only the ones already in
-- the past, so no live conversation goes dark on deploy day. Deliberately not
-- a blanket NULL — that would throw away every cap an admin actually set.
update public.groups
   set max_stay_until = current_date + 30
 where max_stay_until < current_date;

-- ---------------------------------------------------------------------------
-- 2. When a chat closes
-- ---------------------------------------------------------------------------

/**
 * The instant a group's chat stops accepting messages.
 *
 * Noon UTC on the day AFTER max_stay_until, and the noon is the whole point.
 * "Active through the 10th" has to still be true at 23:59 on the 10th
 * wherever you are, and the last place on earth to finish its 10th is UTC-12,
 * at 11:59 UTC on the 11th. Closing at 12:00 UTC on the 11th is therefore the
 * earliest instant that is never early for anybody. It is late by up to a day
 * for the far east of the map, which is the right direction to be wrong in: a
 * chat that lingers is a smaller harm than one that cuts somebody off mid-
 * sentence on a day the app told them was still theirs.
 *
 * NULL max_stay_until means 'infinity' — no end date, never closes.
 *
 * IMMUTABLE, which `at time zone 'UTC'` with a literal zone genuinely is, so
 * it can be called from a policy predicate without costing a re-plan.
 */
create or replace function public.group_closes_at(p_max_stay_until date)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_max_stay_until is null then 'infinity'::timestamptz
    else ((p_max_stay_until + 1)::timestamp + interval '12 hours') at time zone 'UTC'
  end
$$;

-- Every caller is SECURITY DEFINER, so no client ever needs this. It takes a
-- literal and returns arithmetic — there is nothing to leak — but a function
-- nobody has to call is a function nobody can call.
revoke execute on function public.group_closes_at(date) from public, anon, authenticated;

/**
 * Is this chat past its closing time?
 *
 * A group's chat only. Everything else in the app — a direct chat, a place's
 * room — has no `groups` row and is never closed by a date, so this answers
 * false for them and can_send_in_chat below stays exactly as strict as it was.
 */
create or replace function public.group_chat_closed(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    where g.chat_id = p_chat_id
      and now() >= public.group_closes_at(g.max_stay_until)
  )
$$;

revoke execute on function public.group_chat_closed(uuid) from public, anon;
grant execute on function public.group_chat_closed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The close is enforced where sending is decided
-- ---------------------------------------------------------------------------
--
-- Body-only change on the same signature, so the grants from
-- 20260816220000_chat_realtime.sql survive untouched. This is the single most
-- load-bearing function in the app — every message insert passes through it —
-- so the added clause is the last one and it is scoped to groups.

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
      -- A group past its closing day. Reading stays open to everybody who
      -- could read it before; only writing stops.
      and not public.group_chat_closed(c.id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. A closed group keeps its members, and its place in the list
-- ---------------------------------------------------------------------------
--
-- The screen says "You can still read everything here". These two make that
-- true for longer than a week.
--
-- Without the first, a member's seat lapses 7 days after their own departure
-- date, my_chats stops returning the group (its CTE needs a room_members row),
-- and the invite link that would have brought them back now refuses a closed
-- chat. The conversation would be gone, permanently, from the app that had
-- just promised it was still readable.

create or replace function public.expire_room_members()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.room_members rm
   where rm.expires_at <= now()
     and rm.role <> 'admin'
     -- A closed group is a finished conversation people keep. Sweeping its
     -- readers would delete it out from under them.
     and not public.group_chat_closed(rm.chat_id);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- And without this, a closed group is archived 14 days after its last message
-- and can never come back: unarchive_on_message is a trigger on INSERT, and
-- inserting is the one thing a closed chat refuses. It would read exactly like
-- the app having deleted the group.
create or replace function public.archive_idle_chats()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.chat_prefs (chat_id, user_id, archived_at)
  select c.id, m.user_id, now()
  from public.chats c
  join lateral (
    select cp.user_id from public.chat_participants cp where cp.chat_id = c.id
    union
    select rm.user_id from public.room_members rm where rm.chat_id = c.id
  ) m on true
  where coalesce(
          (select max(msg.created_at) from public.messages msg where msg.chat_id = c.id),
          c.created_at
        ) < now() - interval '14 days'
    -- A chat that was ended on purpose is not an idle one, and nothing could
    -- ever un-archive it.
    and not public.group_chat_closed(c.id)
  on conflict (chat_id, user_id) do update
    set archived_at = coalesce(public.chat_prefs.archived_at, now());
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Making a group, with or without an end date
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
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
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  -- NULL is a real answer now: no end date.
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  -- The ceiling that used to be a table constraint, said in words.
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
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
  --
  -- `'infinity'` when there is no end date. room_members.expires_at is NOT
  -- NULL, and `null::date + 7` is NULL, so without this branch every
  -- no-end-date group failed at birth with a 23502 that rolled the whole
  -- creation back — the chats row, the groups row, all of it.
  v_expires := case
    when p_max_stay_until is null then 'infinity'::timestamptz
    else (p_max_stay_until + 7)::timestamptz
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, p_max_stay_until, v_expires, 'admin');

  return v_chat;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Changing one, including turning the end date off
-- ---------------------------------------------------------------------------
--
-- DROP first, and this one is not optional. Adding a defaulted parameter to a
-- Postgres function creates a second OVERLOAD rather than replacing the
-- original, and a six-argument call then matches both and fails with
-- "function is not unique". PostgREST calls by named argument, which does not
-- save you. So: drop the old signature, create the new one, restate its grant.

drop function if exists public.update_group(uuid, text, public.group_speaking, date, text, boolean);

create function public.update_group(
  p_chat_id uuid,
  p_name text default null,
  p_speaking public.group_speaking default null,
  p_max_stay_until date default null,
  p_photo_path text default null,
  p_clear_photo boolean default false,
  -- Same shape as p_clear_photo one line up, and for the same reason: NULL in
  -- this signature has always meant "leave this alone", so turning a value OFF
  -- needs its own flag. Named to match, so the next reader meets one idea
  -- rather than two.
  p_clear_max_stay boolean default false
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
  -- Both at once is a client bug, not a user choice, and silently letting one
  -- win would hide it.
  if p_clear_max_stay and p_max_stay_until is not null then
    raise exception 'Pick a date or no end date, not both.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
  end if;

  update public.groups
     set name = coalesce(btrim(p_name), name),
         speaking = coalesce(p_speaking, speaking),
         max_stay_until = case
           when p_clear_max_stay then null
           else coalesce(p_max_stay_until, max_stay_until)
         end,
         photo_path = case
           when p_clear_photo then null
           else coalesce(p_photo_path, photo_path)
         end
   where chat_id = p_chat_id;
end
$$;

revoke execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean)
from public, anon;
grant execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Joining: clamp rather than refuse, and say when a chat has ended
-- ---------------------------------------------------------------------------

create or replace function public.join_group_with_invite(p_token text, p_stay_until date)
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
  -- A chat that reached its own last day is a different thing from a link
  -- somebody turned off, and telling a stranger the second when it was the
  -- first is the small lie invite_opens_signed_out.sql exists to prevent.
  if public.group_chat_closed(v_chat) then
    raise exception 'This chat has ended.' using errcode = '42501';
  end if;

  if (
    select coalesce(max(created_at) filter (where action = 'removed_by_moderator'),
                    '-infinity'::timestamptz)
         > coalesce(max(created_at) filter (where action = 'readmitted_by_moderator'),
                    '-infinity'::timestamptz)
      from public.moderation_events
     where subject_user_id = v_user
       and entity_type = 'room_member'
       and entity_id = v_chat
  ) then
    raise exception 'You were removed from this group. Ask an admin to let you back in.'
      using errcode = '42501';
  end if;
  if p_stay_until is not null and p_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;

  -- CLAMP, never refuse. LEAST ignores NULLs, so a no-end-date group would
  -- otherwise have no ceiling at all and a caller could post a date a century
  -- out; and on the last day of a dated group the picker's floor (today) can
  -- legitimately exceed its cap, which used to be a dead end on a screen that
  -- still said the chat was open. 400 days is the same ceiling the admin has.
  v_stay := greatest(
    least(coalesce(p_stay_until, current_date + 400), coalesce(v_max, current_date + 400)),
    current_date
  );
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
-- 8. The invite screen can tell "ended" from "withdrawn"
-- ---------------------------------------------------------------------------
--
-- OUT columns change, so DROP first and restate BOTH grants — the anon one
-- lives in a different migration (20260823050000_invite_opens_signed_out.sql)
-- and is what lets a link open for somebody with no account at all.
--
-- Returning zero rows for a chat that simply reached its last day would render
-- as "this invite may have expired or been turned off", which is the wrong
-- story about a group that ran its course. So the row comes back either way
-- and carries the reason.

drop function if exists public.group_invite_preview(text);

create function public.group_invite_preview(p_token text)
returns table (
  chat_id uuid,
  name text,
  photo_path text,
  member_count int,
  max_stay_until date,
  speaking public.group_speaking,
  already_member boolean,
  closed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.chat_id,
    g.name,
    case when exists (
      select 1 from public.room_members rm3
      where rm3.chat_id = g.chat_id and rm3.user_id = auth.uid()
    ) then g.photo_path end,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = g.chat_id and rm.expires_at > now()),
    g.max_stay_until,
    g.speaking,
    exists (
      select 1 from public.room_members rm2
      where rm2.chat_id = g.chat_id and rm2.user_id = auth.uid() and rm2.expires_at > now()
    ),
    (c.status <> 'active' or now() >= public.group_closes_at(g.max_stay_until))
  from public.group_invites i
  join public.groups g on g.chat_id = i.chat_id
  join public.chats c on c.id = g.chat_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
$$;

revoke execute on function public.group_invite_preview(text) from public;
grant execute on function public.group_invite_preview(text) to anon, authenticated;

comment on function public.group_invite_preview(text) is
  'The invite screen. Returns a row for a chat that has ended as well as one '
  'that is open, with `closed` saying which, so a group that ran its course is '
  'not described to a stranger as a link somebody turned off.';

-- PostgREST answers from a cached schema and reloads on a NOTIFY. Two
-- signatures changed above; without this there is a window in which both the
-- old and the new client get PGRST202 shown to them verbatim.
notify pgrst, 'reload schema';
