-- Rooms and groups now send push notifications.
--
-- enqueue_message_push has only ever read chat_participants, which direct
-- chats use and rooms and groups do not. So every message in a hostel room or
-- a traveler group reached nobody's lock screen: you found out somebody had
-- posted by opening the app and looking. A group chat nobody is told about is
-- a group chat nobody comes back to, and it is the founder's headline feature.
--
-- What a group push says is not what a direct one says. A direct chat's title
-- is the sender, because that is the whole context. A room's title is the
-- room, and the sender belongs in the body, which is how every other
-- messaging app reads on a lock screen.
--
-- Muting is honoured (room_members.muted, which the room screen already
-- sets), archived members are skipped, and so is anyone whose stay has
-- lapsed. The sender never pushes themselves.

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
  where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id;

  -- Rooms and groups: the room is the title, the sender opens the body.
  select coalesce(e.name, g.name) into v_room
    from public.chats c
    left join public.establishments e on e.chat_id = c.id
    left join public.groups g on g.chat_id = c.id
   where c.id = new.chat_id and c.kind = 'room';

  if v_room is not null then
    insert into public.push_queue (user_id, title, body, data)
    select rm.user_id,
           v_room,
           case when v_name is null then v_text else v_name || ': ' || v_text end,
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id)
    from public.room_members rm
    where rm.chat_id = new.chat_id
      and rm.user_id <> new.sender_id
      and not rm.muted
      and rm.archived_at is null
      and rm.expires_at > now();
  end if;

  return new;
end
$$;

revoke execute on function public.enqueue_message_push() from public, anon, authenticated;
