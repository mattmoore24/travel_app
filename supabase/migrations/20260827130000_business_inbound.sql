-- Business accounts, part 4: messaging a place
-- ===========================================================================
--
-- docs/BUSINESS_ACCOUNTS.md phase 16, and §7 rule 5 as the founder restated
-- it: "Messages to businesses should always go through."
--
-- The accept inbox is waived and so is the LLM hold. A question to a hostel
-- about beds should not sit in a queue waiting on a classifier trained to
-- spot flirting - that classifier screens for the wrong thing entirely. The
-- prefilter stays, because slurs and scam patterns are still slurs and scam
-- patterns whoever they are aimed at. Rule 5 remains true; it just means the
-- right moderation for the speech act.
--
-- The chat is `kind = 'business'` and NOT 'direct', which is not a label. The
-- handle gate that unlocks personal socials requires kind = 'direct', so this
-- one enum value is what makes "a chat with a business never unlocks anybody's
-- Instagram, in either direction" true rather than merely promised.

/**
 * Write to the people who run a place.
 *
 * A business can never call this: rule 8, and the check is explicit rather
 * than inherited, because this is the one function whose whole job is to
 * open a conversation.
 */
create function public.message_business(p_business_id uuid, p_first_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_owner uuid;
  v_verdict jsonb;
  v_chat uuid;
  v_opened int;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_business_account(v_sender) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if public.is_guest_account(v_sender) then
    raise exception 'make an account first' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'place not found';
  end if;

  select owner_user_id into v_owner from public.businesses where id = p_business_id;
  if v_owner is null then
    -- A seeded venue nobody has claimed. It has a room anybody can join, but
    -- there is no one on the other end of a message, and saying so is better
    -- than opening a chat into the void.
    raise exception 'nobody runs this place yet. Try its chat instead';
  end if;

  -- Already talking to them: same conversation, not a second one.
  select c.id into v_chat
    from public.chats c
    join public.chat_participants me on me.chat_id = c.id and me.user_id = v_sender
    join public.chat_participants them on them.chat_id = c.id and them.user_id = v_owner
   where c.kind = 'business'
   limit 1;
  if v_chat is not null then
    return jsonb_build_object('chat_id', v_chat, 'blocked', false, 'existing', true);
  end if;

  -- Its own budget, separate from the eight hellos a day. Writing to ten
  -- hostels about beds is a normal evening's planning; writing to ten
  -- strangers is not the same act and should not share a counter.
  select count(*) into v_opened
    from public.chats c
    join public.chat_participants cp on cp.chat_id = c.id and cp.user_id = v_sender
   where c.kind = 'business' and c.created_at > now() - interval '24 hours';
  if v_opened >= 10 then
    raise exception 'that is as many places as you can write to today';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  if (v_verdict ->> 'action') = 'block' then
    -- No chat is created at all. There is nothing to release later, which is
    -- the difference between this and the held first-message path.
    return jsonb_build_object('blocked', true);
  end if;

  insert into public.chats (kind) values ('business') returning id into v_chat;
  insert into public.chat_participants (chat_id, user_id) values (v_chat, v_sender), (v_chat, v_owner);
  insert into public.messages (chat_id, sender_id, body, moderation_status)
  values (v_chat, v_sender, p_first_message, 'approved');

  return jsonb_build_object('chat_id', v_chat, 'blocked', false, 'existing', false);
end
$$;

revoke execute on function public.message_business(uuid, text) from public, anon;

/**
 * Which business a chat belongs to, for the row in Chats.
 *
 * Its own lookup rather than a column on `chats`, because the relationship is
 * already there through the owner and a denormalised column is one more thing
 * that can disagree with itself.
 */
create function public.business_for_chat(p_chat_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.chats c
  join public.chat_participants cp on cp.chat_id = c.id
  join public.businesses b on b.owner_user_id = cp.user_id
  where c.id = p_chat_id and c.kind = 'business'
  limit 1
$$;

revoke execute on function public.business_for_chat(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- my_chats learns about business chats
-- ---------------------------------------------------------------------------
--
-- Body-only change, so create-or-replace rather than a drop: the OUT columns
-- are identical and it is only a signature change that Postgres refuses.
--
-- Two things this arm has to get right. A traveler's row must be titled with
-- the PLACE, not with whoever happens to own it, or "Casa Azul" reads as some
-- stranger's name. And a shadowbanned traveler's chat must be invisible to
-- the business while still looking perfectly normal to the traveler, which is
-- what shadowbanning is for; that is the `is_visible_owner` test on the other
-- participant, evaluated only when the reader is the business.

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
    where rm.expires_at > now() or rm.role = 'admin'
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

revoke execute on function public.my_chats(boolean) from public, anon;
grant execute on function public.my_chats(boolean) to authenticated;
