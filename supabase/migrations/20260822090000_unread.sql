-- Unread state
-- ===========================================================================
--
-- The app had no idea what you had already read. Every chat row looked
-- identical whether somebody had written to you thirty seconds ago or you
-- had left the thread open yesterday, and the Chat tab never said there was
-- anything waiting. This adds the one fact that makes all of that possible:
-- when did THIS user last look at THIS chat.
--
-- It lives on chat_prefs rather than a new table because chat_prefs is
-- already the per-user, per-chat row for direct chats, groups and
-- establishment rooms alike, already has RLS scoped to auth.uid(), and is
-- already left-joined by my_chats().

alter table public.chat_prefs
  add column if not exists last_read_at timestamptz;

comment on column public.chat_prefs.last_read_at is
  'When this user last had this chat open. Null means never opened, and the '
  'unread baseline falls back to when they joined — so joining a room with '
  'six months of history does not arrive with six months of unread.';

-- ---------------------------------------------------------------------------
-- Marking a chat read
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER for the same reason set_chat_pref is: the membership test
-- spans three tables the caller cannot all read directly. Never moves the
-- mark backwards, so a stale in-flight call from a screen that has since been
-- left cannot resurrect unread rows.

create or replace function public.mark_chat_read(p_chat_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  -- clock_timestamp(), not now(): now() is the START of the surrounding
  -- transaction, and the mark means "everything up to this instant is read".
  -- The difference is microseconds in production and the whole ballgame in a
  -- single-transaction test, where every now() is identical.
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_chat_member(p_chat_id) or public.is_room_member(p_chat_id)
          or public.is_room_moderator(p_chat_id)) then
    raise exception 'chat not found';
  end if;

  insert into public.chat_prefs (chat_id, user_id, last_read_at)
  values (p_chat_id, auth.uid(), v_now)
  on conflict (chat_id, user_id) do update
    set last_read_at = greatest(public.chat_prefs.last_read_at, v_now);

  return v_now;
end;
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- my_chats() gains unread_count
-- ---------------------------------------------------------------------------
--
-- Postgres refuses to add an OUT column to an existing RETURNS TABLE
-- signature through create or replace, so this drops first — and the drop
-- takes the grants with it, which is why they are restated below (AGENTS.md).
--
-- Two other things are corrected while the body is being rewritten:
--
--   * the last-message lateral only excluded moderator-REMOVED messages, so a
--     message the sender had unsent still won the "most recent" race and the
--     row rendered with no preview at all, hiding the real last message
--     underneath it;
--   * and a message still in the moderation queue was previewed to the
--     recipient before it had cleared, which is the one thing §7 rule 5 is
--     there to prevent.

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
  unread_count int
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
    )
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
