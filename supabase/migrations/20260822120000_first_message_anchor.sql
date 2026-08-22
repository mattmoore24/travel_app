-- The anchor an accepted chat opened on
-- ===========================================================================
--
-- Every first message in this app is a reply to something specific on the
-- other person's profile — a photo, a line of the bio, or the dates the two
-- of you share. The recipient saw that context when they decided to accept.
-- Then the chat opened and it vanished, leaving a sentence with no subject.
--
-- my_chats() already joins message_requests for first_message; this exposes
-- the element beside it. Postgres will not add an OUT column to an existing
-- RETURNS TABLE signature, so the function is dropped and the grants
-- restated (AGENTS.md).

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
  my_role text,
  /**
   * Messages somebody else has sent into this chat since this user last
   * opened it. Counts only what a human actually wrote and what has actually
   * cleared moderation, so the badge can only ever mean one thing.
   */
  unread_count int,
  /**
   * What the first message was a reply TO: 'trip', 'bio', 'photo:0',
   * 'languages', 'home', or 'pin:<venue>'. Both people already know the
   * message itself; this is the context that made it make sense, and
   * without it an accepted chat opens on a sentence with no subject.
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
  left join public.establishments e on e.chat_id = m.id
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
