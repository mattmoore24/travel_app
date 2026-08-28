-- Three things the newer features never told the older ones about.
--
-- 1. `room_messages` predates unsend. `unsend_message` nulls the body and sets
--    `unsent_at`, leaving `removed_at` null — so a withdrawn message came back
--    from a room with `removed = false`, no unsent flag and nothing in it, and
--    the thread drew an empty coloured bubble under the sender's name. For
--    everyone, permanently, still long-pressable and still reactable. Unsend
--    is offered in rooms unconditionally and its confirmation says "It
--    disappears for everyone." Direct chats were fine only because they read
--    the table with `select *`.
--
-- 2. Muting a chat did nothing to push. `enqueue_message_push`'s direct arm
--    reads `chat_participants` with no mute test at all, and its room arm
--    reads `room_members.muted`, a column `authenticated` cannot write.
--    Mute is written to `chat_prefs.muted` by `set_chat_pref`, which is also
--    what `my_chats` reads back — so the app showed the bell struck through,
--    hid the badge, and kept ringing the phone.
--
-- 3. `my_chats` left-joins `message_requests` on chat_id alone. Nothing stops
--    two rows sharing a chat (both directions can be pending at once, and both
--    can then be accepted), and a second row duplicates the whole conversation
--    in the list.

-- ---------------------------------------------------------------------------
-- 1. A room shows a withdrawn message as withdrawn
-- ---------------------------------------------------------------------------
--
-- DROP first: adding an OUT column to a RETURNS TABLE is a signature change
-- and `create or replace` refuses it. The grant goes with the drop, so it is
-- restated below.

drop function if exists public.room_messages(uuid, int);

create function public.room_messages(p_chat_id uuid, p_limit int default 60)
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  photo_path text,
  body text,
  image_path text,
  removed boolean,
  unsent_at timestamptz,
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
    m.unsent_at,
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

-- ---------------------------------------------------------------------------
-- 2. Mute silences the phone as well as the badge
-- ---------------------------------------------------------------------------

-- create-or-replace ONLY: the AFTER INSERT trigger `messages_push` on
-- public.messages depends on this function, and a DROP would need CASCADE,
-- which would take the trigger with it and leave push silently dead.

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
  left join public.chat_prefs pref
    on pref.chat_id = new.chat_id and pref.user_id = cp.user_id
  where cp.chat_id = new.chat_id
    and cp.user_id <> new.sender_id
    -- The bell the person actually pressed. This arm had no mute test at all,
    -- so muting a conversation struck the bell through, hid the badge, and
    -- kept ringing the phone.
    and coalesce(pref.muted, false) = false;

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
    left join public.chat_prefs pref
      on pref.chat_id = new.chat_id and pref.user_id = rm.user_id
    where rm.chat_id = new.chat_id
      and rm.user_id <> new.sender_id
      -- Both, because `room_members.muted` predates chat_prefs and older paths
      -- still set it, while `authenticated` has no grant to write it — so the
      -- mute a person can actually perform lives in chat_prefs.
      and not rm.muted
      and coalesce(pref.muted, false) = false
      and rm.archived_at is null
      and rm.expires_at > now();
  end if;

  return new;
end
$$;

revoke execute on function public.enqueue_message_push() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. One row per conversation
-- ---------------------------------------------------------------------------
--
-- `message_requests` is unique on (sender_id, recipient_id), not on chat_id,
-- so a pair who both said hi before either accepted have two rows pointing at
-- the same chat and the left join returned the conversation twice. The chat
-- list keys on chat_id, so React also had two children with the same key.
-- Taking the earliest row keeps the opener that started the conversation.

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

notify pgrst, 'reload schema';
