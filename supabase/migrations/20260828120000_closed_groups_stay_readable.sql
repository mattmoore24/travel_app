-- A closed group has to stay readable, and it did not.
--
-- 20260827170000 stopped `expire_room_members` from sweeping a closed group's
-- members, on the reasoning that "the conversation would be gone, permanently,
-- from the app that had just promised it was still readable". Keeping the row
-- was necessary and not sufficient: nothing downstream asks whether a row
-- EXISTS. `is_room_member` asks `expires_at > now()`, and that is what the
-- messages SELECT policy and `groups_select_member` use; `my_chats` asks the
-- same thing in its room arm. So a member whose own stay lapsed after the
-- group closed kept a row nobody consults, and the group vanished from their
-- chat list and their history with it.
--
-- The admin fared no better: their row survives on `role = 'admin'`, so the
-- group stayed in the list, but `is_room_member` gates the messages and the
-- `groups` row alike — so the thread opened EMPTY, with no name and none of
-- the "Everything in it is still here to read" copy, because that copy needs
-- the group.
--
-- Both gates now recognise a closed group. Nothing here lets anybody post:
-- `can_send_in_chat` refuses a closed group on its own clause, and reopening
-- one (the admin sets a future date) puts every lapsed member straight back in
-- the sweep's path, which is right.

-- ---------------------------------------------------------------------------
-- 1. Reading a closed group
-- ---------------------------------------------------------------------------

create or replace function public.is_room_member(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where chat_id = p_chat_id
      and user_id = auth.uid()
      and (expires_at > now() or public.group_chat_closed(p_chat_id))
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. And finding it in the list
-- ---------------------------------------------------------------------------
--
-- Restated whole because the room arm is one line inside it. The OUT columns
-- are untouched, so `create or replace` is allowed here and the grants survive
-- (see the traps skill: it is a signature change Postgres refuses, not a body
-- change).

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
