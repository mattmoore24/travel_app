-- Pinned messages in rooms and groups
-- ===========================================================================
--
-- A hostel room is a river: the address of tonight's dinner scrolls out of
-- reach in twenty minutes, and the person who posted it answers it four more
-- times. A pin is the one message that stays at the top until it stops being
-- true.
--
-- Three constraints, all deliberate:
--
--   * at most three per room, because a pinned list is a second thread and
--     nobody reads two;
--   * every pin expires, because the failure mode of pinned content is a
--     stale one nobody remembers to take down — and this app's whole
--     vocabulary is already "plans that burn out";
--   * only a room's moderators may pin, which for an establishment means its
--     staff and for a traveler group means its admin.

create table public.pinned_messages (
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index pinned_messages_chat_idx on public.pinned_messages (chat_id, expires_at);

alter table public.pinned_messages enable row level security;
revoke all on public.pinned_messages from anon;
revoke truncate, references, trigger on public.pinned_messages from authenticated;

-- Readable by exactly the people who can read the room. Writes go through
-- the RPCs below, which is where the cap and the moderator check live.
create policy pinned_messages_select_room
  on public.pinned_messages for select to authenticated
  using (public.is_room_member(chat_id) or public.is_room_moderator(chat_id));

/** The longest a pin may outlive the moment that made it worth pinning. */
create function public.max_pin_hours()
returns int
language sql
immutable
as $$ select 72 $$;

create function public.pin_message(p_message_id uuid, p_hours int default 24)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat uuid;
  v_live int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select chat_id into v_chat from public.messages
  where id = p_message_id and removed_at is null and unsent_at is null;
  if v_chat is null then
    raise exception 'message not found';
  end if;
  if not public.is_room_moderator(v_chat) then
    raise exception 'only a host can pin';
  end if;

  -- Counted over LIVE pins only, so yesterday's expired one does not hold a
  -- slot hostage.
  select count(*)::int into v_live
  from public.pinned_messages
  where chat_id = v_chat and expires_at > now() and message_id <> p_message_id;
  if v_live >= 3 then
    raise exception 'three pins is the limit';
  end if;

  insert into public.pinned_messages (chat_id, message_id, pinned_by, expires_at)
  values (
    v_chat,
    p_message_id,
    auth.uid(),
    now() + make_interval(hours => least(greatest(p_hours, 1), public.max_pin_hours()))
  )
  on conflict (chat_id, message_id) do update
    set expires_at = excluded.expires_at, pinned_by = excluded.pinned_by;
end;
$$;

revoke execute on function public.pin_message(uuid, int) from public, anon;
grant execute on function public.pin_message(uuid, int) to authenticated;

create function public.unpin_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat uuid;
begin
  select chat_id into v_chat from public.pinned_messages where message_id = p_message_id;
  if v_chat is null then
    return;
  end if;
  if not public.is_room_moderator(v_chat) then
    raise exception 'only a host can unpin';
  end if;
  delete from public.pinned_messages where message_id = p_message_id;
end;
$$;

revoke execute on function public.unpin_message(uuid) from public, anon;
grant execute on function public.unpin_message(uuid) to authenticated;

/** What is pinned in this room right now, newest first. */
create function public.room_pins(p_chat_id uuid)
returns table (
  message_id uuid,
  body text,
  image_path text,
  sender_id uuid,
  display_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.body,
    m.image_path,
    m.sender_id,
    p.display_name,
    pm.expires_at
  from public.pinned_messages pm
  join public.messages m on m.id = pm.message_id
  left join public.profiles p on p.user_id = m.sender_id
  where pm.chat_id = p_chat_id
    and pm.expires_at > now()
    -- A pin never outlives its message: unsending or removing one takes the
    -- pin with it, rather than leaving a headline over nothing.
    and m.removed_at is null
    and m.unsent_at is null
    and (public.is_room_member(p_chat_id) or public.is_room_moderator(p_chat_id))
  order by pm.created_at desc
$$;

revoke execute on function public.room_pins(uuid) from public, anon;
grant execute on function public.room_pins(uuid) to authenticated;

create or replace function public.expire_pinned_messages()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with gone as (
    delete from public.pinned_messages where expires_at <= now() returning 1
  )
  select count(*)::int from gone
$$;

revoke execute on function public.expire_pinned_messages() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-pinned-messages', '20 * * * *',
                          'select public.expire_pinned_messages()');
  end if;
end
$$;
