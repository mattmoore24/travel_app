-- Sending a photo in a one-to-one chat always failed.
--
-- push_queue.body is NOT NULL. A photo message carries image_path and a NULL
-- body, so `left(new.body, 140)` was NULL, the trigger's insert violated the
-- constraint, and because this is an AFTER INSERT trigger on messages the
-- violation took the whole message down with it. The upload had already
-- happened, so the storage object was left behind too.
--
-- Rooms and groups escaped it only by accident: the trigger reads
-- chat_participants, which they do not use, so its select matched no rows and
-- inserted nothing. That is also why nobody in a room gets a push at all,
-- which is a separate gap and not this migration's business.
--
-- The body now says what arrived. A push that reads "Photo" is what every
-- other messaging app sends, and it leaks nothing the notification did not
-- already leak by naming the sender.

create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select display_name into v_name from public.profiles where user_id = new.sender_id;
  insert into public.push_queue (user_id, title, body, data)
  select cp.user_id,
         coalesce(v_name, 'New message'),
         coalesce(
           nullif(left(new.body, 140), ''),
           case when new.image_path is not null then 'Photo' else 'New message' end
         ),
         jsonb_build_object('type', 'message', 'chat_id', new.chat_id)
  from public.chat_participants cp
  where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id;
  return new;
end
$$;

revoke execute on function public.enqueue_message_push() from public, anon, authenticated;
