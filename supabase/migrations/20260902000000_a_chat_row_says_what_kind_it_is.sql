-- A chat row says what kind of thing it is
-- =============================================================================
--
-- Three rows in the inbox, three privacy models, and nothing on the screen to
-- tell them apart. "Maestro crew" is a private group. "Rooftop hello from
-- Maestro" is a plan hung off a pin, and post_joinable_pin opens it with
-- speaking = 'everyone', so anybody who can see that pin can walk in. "Once
-- Again Hostel" is a business room a signed-out visitor can read. Somebody
-- typing "I am at the hostel on Rua X until Tuesday, come find me" into what
-- they believe is a four-person crew has no signal that a stranger can open
-- it. The room screen knows and says so once you are inside; the LIST, which
-- is where the sentence gets typed, could not, because my_chats returned
-- neither the pin nor the room's readability. my_role tells a business room
-- from a traveler group and stops there: post_joinable_pin makes the creator
-- 'admin' either way, so a plan and a crew were indistinguishable.
--
-- Two OUT columns close it:
--
--   plan_date       the day the pin is for, so a plan's date stops vanishing
--                   the moment anybody writes in the room and the row falls
--                   through to the last message.
--   public_preview  the room's own readability, straight off the business
--                   the room belongs to.
--
-- Both come off joins the query already makes (`g` for the group, `b` for the
-- business), so this costs no new scan.
--
-- HARD RULE 3 is enforced in the plan_date expression, not left to the sweep.
-- expire_pins hard-deletes on a fifteen-minute cadence, so between a pin's
-- expiry and its deletion the row would still have carried a readable date;
-- the `p.expires_at > now()` guard closes that window. Once the sweep runs,
-- groups.pin_id goes null (ON DELETE SET NULL) and the group carries on as an
-- ordinary group with no date, which is the recorded intent: the conversation
-- is not on the pin's timer.
--
-- THE DEPLOY HAZARD, and why this file is shaped the way it is: `create or
-- replace` cannot add an OUT column to a RETURNS TABLE signature. Postgres
-- refuses, and it refuses AFTER everything earlier in the migration has
-- already applied. So: drop first, re-create, and re-state both grants the
-- drop takes with it (20260827100000_business_accounts.sql:657-658).
--
-- Older binaries are safe. my_chats is called by name over the wire and
-- PostgREST hands back extra keys an old bundle ignores. Adding columns is
-- fine; removing or reordering them is not.

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
  my_role text,
  unread_count int,
  first_message_element text,
  plan_date date,
  public_preview boolean
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
    case
      -- A business's own room. No groups row, no room_members row, and until
      -- now no role either.
      when b.chat_id is not null then
        case when public.is_room_moderator(m.id) then 'admin' else null end
      when g.chat_id is not null then rmine.role::text
      else null
    end,
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
    r.profile_element,
    -- The plan this room opened from, and only while the pin is alive: hard
    -- rule 3 says an expired pin is unreadable, and `expire_pins` sweeps on a
    -- fifteen-minute cadence, so the window between expiry and deletion has
    -- to be closed here rather than left to the sweep. `groups.pin_id` is
    -- ON DELETE SET NULL, so once the sweep does run the plan simply stops
    -- being a plan and the group carries on as an ordinary group.
    (select p.intent_date from public.pins p
      where p.id = g.pin_id and p.expires_at > now()),
    b.public_preview
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

revoke execute on function public.my_chats(boolean) from public, anon;
grant execute on function public.my_chats(boolean) to authenticated;

comment on function public.my_chats(boolean) is
  'Every conversation this caller is in, one row each, with the reader''s own '
  'prefs folded in. plan_date is the day of the pin the room opened from and '
  'is null once that pin has expired or been swept (hard rule 3); '
  'public_preview is the room''s readability, null for a traveler group.';

notify pgrst, 'reload schema';
