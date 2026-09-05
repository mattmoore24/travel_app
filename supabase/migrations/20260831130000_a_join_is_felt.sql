-- Joining somebody's plan is felt: a line in the chat, a push to the host.
--
-- join_pin_chat inserted a room_members row and returned a chat_id, and that
-- was the whole of it. It queued no push, and because it wrote no message row
-- the enqueue_message_push trigger never fired either — so unread_count
-- stayed zero, the chat row got no dot, and the host learned three people
-- were coming only by opening the app and re-reading the Groups list, inside
-- a window where the whole premise is that the plan is tonight. It punished
-- the joiner too: the Join tap produced no visible consequence anywhere.
--
-- Founder ruling (UX_PLAN.md D28): the join writes a visible line into the
-- plan's chat AND rings the host. The pin sheet already shows the crew's
-- faces to anyone who can see the pin, so the line broadcasts nothing new.
--
-- Four parts:
--   1. messages.kind — 'said' | 'joined'. A kind column rather than a plain
--      body row, because a thread that must follow iMessage conventions
--      exactly cannot render "Ana is in" as a bubble Ana appears to have
--      typed.
--   2. room_messages returns it. DROP first: adding an OUT column to a
--      RETURNS TABLE is a signature change `create or replace` refuses,
--      failing the deploy AFTER earlier statements applied. The grant goes
--      with the drop and is restated.
--   3. join_pin_chat writes the line, once per person per chat, so a
--      leave-and-rejoin does not post twice.
--   4. enqueue_message_push branches on kind = 'joined': one push to the
--      host only, capped at the fifth join, never the member fan-out —
--      the cap lives here and not in join_pin_chat because the fan-out is
--      what would otherwise machine-gun a popular plan. create-or-replace
--      ONLY for this one: the messages_push trigger depends on it and a
--      drop would take the trigger too.

-- 1. The kind of a message -----------------------------------------------------

create type public.message_kind as enum ('said', 'joined');

alter table public.messages
  add column kind public.message_kind not null default 'said';

-- The star-read check: `authenticated` holds a TABLE-level select on
-- messages, so the new column rides along and the app's `select *`
-- (31_select_star_stays_readable.test.sql) keeps working. The column-level
-- anon grant from 20260817200000 is untouched — signed-out preview reads go
-- through the room_messages definer below, never a bare select.

-- The system voice cannot be forged. messages_insert_member checks only
-- sender and membership, and `kind` rides the table-level insert grant, so
-- without this guard any member could insert kind='joined' with an arbitrary
-- body and have it rendered as the room's own centred caption ("Host
-- cancelled this, do not come"). join_pin_chat is SECURITY DEFINER, so its
-- insert runs as the function owner and passes; API roles are refused.
create function public.messages_kind_is_earned()
returns trigger
language plpgsql
as $$
begin
  if new.kind <> 'said' and current_user in ('authenticated', 'anon') then
    raise exception 'Only the app writes system lines.'
      using hint = 'system_line_forged';
  end if;
  return new;
end
$$;

create trigger messages_kind_is_earned
  before insert on public.messages
  for each row execute function public.messages_kind_is_earned();

-- 2. room_messages says which kind ---------------------------------------------

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
  created_at timestamptz,
  -- 'none'     — no photo on this message
  -- 'ready'    — cleared, and image_path above is real
  -- 'checking' — with the worker now; the app draws the review tile
  -- 'blocked'  — refused. Rare on this path: apply_chat_photo_verdict also
  --              sets removed_at, so the thread usually shows it as removed
  --              before this is ever read.
  photo_state text,
  -- 'said' is a person talking; 'joined' is the room recording an arrival.
  -- The thread renders the second as a centred line, never as a bubble.
  kind public.message_kind
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
    -- The sender sees their own picture while it is being checked; everybody
    -- else waits for the verdict. This gives away nothing: the storage read
    -- policy `chat_photos_select_own` already lets somebody read their own
    -- upload, so a path they cannot use is the only thing that was being
    -- withheld — and withholding it meant the person who took the photo got a
    -- blank tile telling them their own picture was under review.
    case
      when m.moderation_status = 'approved' or m.sender_id = auth.uid() then m.image_path
      else null
    end,
    m.removed_at is not null,
    m.unsent_at,
    m.created_at,
    case
      when m.image_path is null then 'none'
      when m.moderation_status = 'approved' then 'ready'
      when m.moderation_status = 'rejected' then 'blocked'
      else 'checking'
    end,
    m.kind
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

-- 3. join_pin_chat leaves a line -----------------------------------------------
--
-- Body restated whole from 20260829190000_a_business_is_not_a_traveler.sql,
-- unchanged up to and including the room_members upsert; the message insert
-- is the addition.

create or replace function public.join_pin_chat(p_pin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_chat uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('join a plan');

  select p.user_id, g.chat_id into v_owner, v_chat
    from public.pins p
    join public.groups g on g.pin_id = p.id
   where p.id = p_pin_id
     and p.expires_at > now();

  -- One sentence for every way this can fail, on purpose. "Not open any more"
  -- covers expired, taken down, never joinable, and a person who cannot see
  -- you — and a caller cannot tell those apart, which is the point. The
  -- alternative is an endpoint that answers "does this person's audience
  -- admit me" for any uuid you feed it.
  if v_chat is null then
    raise exception 'That plan is not open to join any more.' using errcode = '42501';
  end if;

  if v_owner is distinct from v_user then
    if not public.is_discoverable_owner(v_owner)
       or public.is_blocked_pair(v_owner)
       or not public.discovery_pair_ok(v_user, v_owner) then
      raise exception 'That plan is not open to join any more.' using errcode = '42501';
    end if;
  end if;

  if (select c.status from public.chats c where c.id = v_chat) <> 'active'
     or public.group_chat_closed(v_chat) then
    raise exception 'This chat has ended.' using errcode = '42501';
  end if;

  -- Removed by an admin means removed. Tapping the pin again is not a way
  -- back in — the same tombstone join_group_with_invite reads.
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

  -- No departure date to ask for: this group has no end, so a joiner has no
  -- horizon to be clamped to. Rejoining after leaving is just this insert
  -- again, and it must not demote an admin who left and came back.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (v_chat, v_user, null, 'infinity')
  on conflict (chat_id, user_id) do update
    set expires_at = 'infinity',
        archived_at = null;

  -- The line the thread shows. Once per person per chat: a leave-and-rejoin
  -- is the same arrival, and announcing it twice would read as a glitch.
  -- 'approved' because this is the room recording a fact, not a person
  -- talking — there is nothing to moderate. The insert is what makes the
  -- host's unread_count move and the enqueue_message_push trigger fire.
  if not exists (
    select 1 from public.messages m
     where m.chat_id = v_chat
       and m.sender_id = v_user
       and m.kind = 'joined'
  ) then
    insert into public.messages (chat_id, sender_id, body, kind, moderation_status)
    values (
      v_chat,
      v_user,
      coalesce(
        (select display_name from public.profiles where user_id = v_user),
        'Somebody'
      ) || ' is in',
      'joined',
      'approved'
    );
  end if;

  return jsonb_build_object('chat_id', v_chat);
end
$$;

revoke execute on function public.join_pin_chat(uuid) from public, anon;
grant execute on function public.join_pin_chat(uuid) to authenticated;

-- 4. The push, host only, capped -----------------------------------------------
--
-- Body restated whole from 20260831090000_a_push_knows_where_it_goes.sql;
-- the 'joined' branch at the top is the addition, and it returns without
-- falling through to the member fan-out.

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
  v_going int;
begin
  -- An arrival rings the host and nobody else. One row, addressed to
  -- groups.created_by, titled with the plan, only while this is among the
  -- first five joins — past that a popular plan would machine-gun the
  -- host's phone, which is why the cap lives on this side and not in
  -- join_pin_chat. The count includes the row that fired this trigger, so
  -- joins one to five push and the sixth is the first that does not.
  if new.kind = 'joined' then
    select count(*) into v_going
      from public.room_members rm
     where rm.chat_id = new.chat_id
       and rm.archived_at is null
       and rm.expires_at > now();

    insert into public.push_queue (user_id, title, body, data)
    select g.created_by,
           coalesce(p.venue_name, g.name),
           new.body || case when v_going > 1
             then '. That makes ' || v_going || '.'
             else '.' end,
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'room')
      from public.groups g
      left join public.pins p on p.id = g.pin_id
      join public.room_members rm
        on rm.chat_id = new.chat_id and rm.user_id = g.created_by
      left join public.chat_prefs pref
        on pref.chat_id = new.chat_id and pref.user_id = g.created_by
     where g.chat_id = new.chat_id
       and g.created_by is not null
       and g.created_by <> new.sender_id
       -- The same mute tests the fan-out below applies to every member.
       and not rm.muted
       and coalesce(pref.muted, false) = false
       and rm.archived_at is null
       and rm.expires_at > now()
       and (select count(*) from public.messages m
             where m.chat_id = new.chat_id and m.kind = 'joined') <= 5;

    return new;
  end if;

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
         jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'direct')
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
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'room')
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
