-- Establishment group chats, message reactions, and photo messages.
--
-- The pitch to a hostel: "every guest gets a room where they can find each
-- other and you can post tonight's event." The constraints that keep it from
-- becoming a dead 4,000-person group:
--
--   * Membership is tied to the stay. You say when you leave; you're removed
--     7 days after that, hard-capped at 30 days from joining. Both enforced by
--     a scheduled sweep, never by the client. (Hostelworld closes rooms 3 days
--     after checkout — if rooms get noisy, 3 is the number to try.)
--   * A staff moderator can remove a message or a member, and pin one message
--     as the room's notice.
--   * Rooms are public-preview by default so signed-out visitors can look
--     before joining. Members are told so before they post, and an
--     establishment can switch it off per room.
--
-- Messages live in the SAME public.messages table as direct chats, so
-- moderation, rate limits, realtime and push all apply unchanged. A chat row
-- now has a kind, and rooms hang off it.

-- Chat kinds ---------------------------------------------------------------------

create type public.chat_kind as enum ('direct', 'room');

alter table public.chats
  add column kind public.chat_kind not null default 'direct';

-- Establishments -------------------------------------------------------------------

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  city_id int not null references public.cities (id),
  name text not null check (char_length(name) between 2 and 80),
  kind text not null default 'hostel' check (kind in ('hostel', 'hotel', 'other')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- The room this establishment runs. One per establishment for v1.
  chat_id uuid unique references public.chats (id) on delete set null,
  public_preview boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index establishments_city_idx on public.establishments (city_id) where active;

alter table public.establishments enable row level security;

create policy establishments_select_active
  on public.establishments for select to authenticated, anon
  using (active);

revoke all on public.establishments from anon, authenticated;
grant select on public.establishments to anon, authenticated;

-- Staff. A moderator is a normal user flagged for one establishment; the flag
-- is server-set (admins onboard venues), never self-serve.
create table public.establishment_staff (
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (establishment_id, user_id)
);

alter table public.establishment_staff enable row level security;
revoke all on public.establishment_staff from anon, authenticated;
grant select on public.establishment_staff to authenticated;

create policy establishment_staff_select
  on public.establishment_staff for select to authenticated
  using (true); -- who moderates a room is public within the app

-- Membership --------------------------------------------------------------------

create table public.room_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- What the joiner told us; drives expiry.
  departure_date date not null,
  -- Materialised so the sweep is a plain index scan.
  expires_at timestamptz not null,
  pinned boolean not null default false,
  muted boolean not null default false,
  archived_at timestamptz,
  primary key (chat_id, user_id)
);

create index room_members_user_idx on public.room_members (user_id);
create index room_members_expiry_idx on public.room_members (expires_at);

alter table public.room_members enable row level security;
revoke all on public.room_members from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.room_members from authenticated;
grant select on public.room_members to authenticated;

create policy room_members_select_own
  on public.room_members for select to authenticated
  using (user_id = auth.uid());

-- Per-user state on DIRECT chats too, so pin/mute/archive work everywhere.
create table public.chat_prefs (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  pinned boolean not null default false,
  muted boolean not null default false,
  archived_at timestamptz,
  primary key (chat_id, user_id)
);

alter table public.chat_prefs enable row level security;
revoke all on public.chat_prefs from anon;
revoke truncate, references, trigger on public.chat_prefs from authenticated;

create policy chat_prefs_rw_own
  on public.chat_prefs for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Helpers ------------------------------------------------------------------------

create function public.is_room_member(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where chat_id = p_chat_id and user_id = auth.uid() and expires_at > now()
  )
$$;

create function public.is_room_moderator(p_chat_id uuid)
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
$$;

/** True when a room is readable without an account. */
create function public.is_public_room(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.establishments
    where chat_id = p_chat_id and active and public_preview
  )
$$;

revoke execute on function
  public.is_room_member(uuid),
  public.is_room_moderator(uuid),
  public.is_public_room(uuid)
from public;
grant execute on function public.is_public_room(uuid) to anon;

-- Messages in rooms ----------------------------------------------------------------
-- Direct-chat rules are untouched; room rules are added alongside them.

alter table public.messages
  add column image_path text,
  add column moderation_status public.moderation_status not null default 'approved',
  -- Set by a moderator removing something; the row survives as evidence.
  add column removed_at timestamptz,
  add column removed_by uuid references public.users (id);

-- A message must carry text or a photo (or both) — unless a moderator has
-- removed it, which empties the content and keeps the row as evidence.
alter table public.messages
  alter column body drop not null,
  add constraint messages_have_content
    check (removed_at is not null or body is not null or image_path is not null);

create policy messages_select_room_member
  on public.messages for select to authenticated
  using (public.is_room_member(chat_id) or public.is_room_moderator(chat_id));

-- Signed-out preview. Read-only by construction: anon has no INSERT grant on
-- messages at all, and only sees rooms flagged public_preview.
create policy messages_select_public_room
  on public.messages for select to anon
  using (public.is_public_room(chat_id));

grant select (id, chat_id, sender_id, body, image_path, created_at)
  on public.messages to anon;

-- Photos in a room are visible to anyone who can read the room — including
-- signed-out visitors — so they hold at 'pending' until the moderation worker
-- clears them, exactly like profile photos.
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
        or public.is_room_member(c.id)
        or public.is_room_moderator(c.id)
      )
  )
$$;

create function public.screen_chat_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.image_path is not null and public.config_flag('require_photo_moderation') then
    new.moderation_status := 'pending';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.sender_id, 'chat_photo', new.id, 'queued_for_llm', 'photo-pipeline',
       jsonb_build_object('storage_path', new.image_path));
  end if;
  return new;
end
$$;

create trigger messages_screen_photo
  before insert on public.messages
  for each row execute function public.screen_chat_photo();

revoke execute on function public.screen_chat_photo() from public, anon, authenticated;

create function public.apply_chat_photo_verdict(p_message_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_msg from public.messages
  where id = p_message_id and moderation_status = 'pending'
  for update;
  if not found then
    raise exception 'message photo is not awaiting moderation';
  end if;

  if p_verdict ->> 'action' = 'allow' then
    update public.messages set moderation_status = 'approved' where id = p_message_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values (v_msg.sender_id, 'chat_photo', p_message_id, 'photo_approved',
            'claude-moderator', p_verdict);
  else
    update public.messages
      set moderation_status = 'rejected', image_path = null, removed_at = now()
      where id = p_message_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values (v_msg.sender_id, 'chat_photo', p_message_id,
            case when p_verdict ->> 'engine' = 'failsafe'
                 then 'photo_rejected_failsafe' else 'photo_rejected' end,
            case when p_verdict ->> 'engine' = 'failsafe'
                 then 'failsafe' else 'claude-moderator' end,
            p_verdict);
  end if;
end
$$;

revoke execute on function public.apply_chat_photo_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- Private bucket for chat photos; reads go through signed URLs like profile
-- photos, writes are owner-folder only.
insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', false)
on conflict (id) do nothing;

create policy chat_photos_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.own_object_count('chat-photos') < 200
  );

create policy chat_photos_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and exists (
      select 1 from public.messages m
      where m.image_path = storage.objects.name
        and m.moderation_status = 'approved'
        and (public.is_chat_member(m.chat_id) or public.is_room_member(m.chat_id)
             or public.is_room_moderator(m.chat_id))
    )
  );

-- Reactions ------------------------------------------------------------------------

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

create policy message_reactions_select
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and (public.is_chat_member(m.chat_id) or public.is_room_member(m.chat_id)
             or public.is_room_moderator(m.chat_id))
    )
  );

create policy message_reactions_write_own
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_send_in_chat(m.chat_id)
    )
  );

create policy message_reactions_delete_own
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.message_reactions from anon;
revoke update, truncate, references, trigger on public.message_reactions from authenticated;

-- Joining and leaving -----------------------------------------------------------------

create function public.join_room(p_chat_id uuid, p_departure_date date)
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
    select 1 from public.establishments e
    join public.chats c on c.id = e.chat_id
    where e.chat_id = p_chat_id and e.active and c.status = 'active'
  ) then
    raise exception 'room unavailable';
  end if;
  if p_departure_date < current_date then
    raise exception 'departure date is in the past';
  end if;

  -- 7 days after departure, capped at 30 days from now.
  v_expires := least(
    (p_departure_date + 7)::timestamptz,
    now() + interval '30 days'
  );

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (p_chat_id, v_user, p_departure_date, v_expires)
  on conflict (chat_id, user_id) do update
    set departure_date = excluded.departure_date,
        expires_at = excluded.expires_at,
        archived_at = null;

  return jsonb_build_object('joined', true, 'expires_at', v_expires);
end
$$;

create function public.leave_room(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.room_members
  where chat_id = p_chat_id and user_id = auth.uid()
$$;

/** Pin / mute / archive, for rooms and direct chats alike. */
create function public.set_chat_pref(
  p_chat_id uuid,
  p_pinned boolean default null,
  p_muted boolean default null,
  p_archived boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_chat_member(p_chat_id) or public.is_room_member(p_chat_id)
          or public.is_room_moderator(p_chat_id)) then
    raise exception 'chat not found';
  end if;

  insert into public.chat_prefs (chat_id, user_id, pinned, muted, archived_at)
  values (
    p_chat_id, auth.uid(),
    coalesce(p_pinned, false),
    coalesce(p_muted, false),
    case when p_archived then now() else null end
  )
  on conflict (chat_id, user_id) do update
    set pinned = coalesce(p_pinned, public.chat_prefs.pinned),
        muted = coalesce(p_muted, public.chat_prefs.muted),
        archived_at = case
          when p_archived is null then public.chat_prefs.archived_at
          when p_archived then now()
          else null
        end;
end
$$;

revoke execute on function
  public.join_room(uuid, date),
  public.leave_room(uuid),
  public.set_chat_pref(uuid, boolean, boolean, boolean)
from public, anon;

-- Moderator tools ----------------------------------------------------------------------

create function public.room_remove_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages%rowtype;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if not found or not public.is_room_moderator(v_msg.chat_id) then
    raise exception 'message not found';
  end if;
  -- Content goes, row stays: reports need the evidence.
  update public.messages
    set body = null, image_path = null, removed_at = now(), removed_by = auth.uid()
    where id = p_message_id;
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values (v_msg.sender_id, 'room_message', p_message_id, 'removed_by_moderator',
          'establishment', jsonb_build_object('chat_id', v_msg.chat_id));
end
$$;

create function public.room_remove_member(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'room not found';
  end if;
  delete from public.room_members where chat_id = p_chat_id and user_id = p_user_id;
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values (p_user_id, 'room_member', p_chat_id, 'removed_by_moderator',
          'establishment', jsonb_build_object('chat_id', p_chat_id));
end
$$;

revoke execute on function
  public.room_remove_message(uuid),
  public.room_remove_member(uuid, uuid)
from public, anon;

-- Message body is now nullable and moderator-clearable; keep clients out of it.
revoke update on public.messages from authenticated;

-- Lifecycle sweeps -----------------------------------------------------------------

/** Removes members whose stay window has passed. */
create function public.expire_room_members()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.room_members where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

/** Archives any chat with no message for 14 days (docs/DESIGN.md — Hinge's
    model: archived stays fully readable, a new message brings it back). */
create function public.archive_idle_chats()
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
  on conflict (chat_id, user_id) do update
    set archived_at = coalesce(public.chat_prefs.archived_at, now());
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

/** A new message un-archives the conversation for everyone in it. */
create function public.unarchive_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_prefs set archived_at = null
  where chat_id = new.chat_id and archived_at is not null;
  return new;
end
$$;

create trigger messages_unarchive
  after insert on public.messages
  for each row execute function public.unarchive_on_message();

revoke execute on function
  public.expire_room_members(),
  public.archive_idle_chats(),
  public.unarchive_on_message()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-room-members', '0 * * * *',
                          'select public.expire_room_members()');
    perform cron.schedule('archive-idle-chats', '30 3 * * *',
                          'select public.archive_idle_chats()');
  end if;
end
$$;

-- Reading the chat list ---------------------------------------------------------------
-- One list, both kinds, with per-user state. Return type changes, so drop first.

drop function public.my_chats();

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
  created_at timestamptz
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
    where rm.expires_at > now()
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
    case when m.kind = 'room' then e.name else op.display_name end,
    other.user_id,
    case when m.kind = 'room' then null else
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
    m.created_at
  from mine m
  left join public.establishments e on e.chat_id = m.id
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

/** Rooms in a city, for the Chat tab's "rooms near you" and the guest preview. */
create function public.city_rooms(p_city_id int)
returns table (
  chat_id uuid,
  establishment_id uuid,
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
    e.chat_id,
    e.id,
    e.name,
    e.kind,
    e.lat,
    e.lng,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = e.chat_id and rm.expires_at > now()),
    (select max(msg.created_at) from public.messages msg where msg.chat_id = e.chat_id),
    e.public_preview
  from public.establishments e
  where e.city_id = p_city_id and e.active and e.chat_id is not null
  order by 7 desc nulls last
$$;

grant execute on function public.city_rooms(int) to anon, authenticated;

/** Read a room's messages. Members and moderators always; anon only where the
    establishment left public_preview on. Rejected photos never surface. */
create function public.room_messages(p_chat_id uuid, p_limit int default 60)
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  photo_path text,
  body text,
  image_path text,
  removed boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.sender_id,
    p.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = m.sender_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    m.body,
    case when m.moderation_status = 'approved' then m.image_path else null end,
    m.removed_at is not null,
    m.created_at
  from public.messages m
  left join public.profiles p on p.user_id = m.sender_id
  where m.chat_id = p_chat_id
    and (
      public.is_room_member(p_chat_id)
      or public.is_room_moderator(p_chat_id)
      or public.is_public_room(p_chat_id)
    )
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200))
$$;

grant execute on function public.room_messages(uuid, int) to anon, authenticated;

/** Reactions for a set of messages, aggregated for rendering. */
create function public.message_reaction_summary(p_chat_id uuid)
returns table (message_id uuid, emoji text, count int, reacted_by_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.message_id,
    r.emoji,
    count(*)::int,
    bool_or(r.user_id = auth.uid())
  from public.message_reactions r
  join public.messages m on m.id = r.message_id
  where m.chat_id = p_chat_id
    and (public.is_chat_member(p_chat_id) or public.is_room_member(p_chat_id)
         or public.is_room_moderator(p_chat_id))
  group by r.message_id, r.emoji
$$;

revoke execute on function public.message_reaction_summary(uuid) from public, anon;

-- Rooms are realtime like direct chats (guarded for the local rig).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$$;
