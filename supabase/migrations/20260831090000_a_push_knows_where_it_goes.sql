-- A message push says which kind of conversation it belongs to, so the tap
-- routing on the phone can open /room/[id] or /chat/[id] without guessing a
-- chat's kind from a client cache that may not have loaded yet. Mirrors
-- exactly what the chat tab already switches on (kind = 'room').
--
-- create-or-replace ONLY, never drop: the AFTER INSERT trigger
-- `messages_push` on public.messages depends on this function, and a DROP
-- would need CASCADE and would take the trigger with it
-- (20260828140000_room_unsend_and_mute.sql:80-84 records the same rule). No
-- OUT columns change, so the drop-function-first rule does not bite. Body
-- byte-identical to 20260828140000:85-147 except the two
-- jsonb_build_object payloads, which gain 'kind'. Old builds tolerate the
-- extra key (they read none of the payload at all); new builds tolerate
-- pushes already queued without it.

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
