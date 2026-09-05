-- The accept push said 'Chat open' / '{name} replied. Say hi.' It goes to the
-- person who already said hi, so it instructed a repeat of the thing that just
-- worked, and it promised a reply that does not exist: respond_to_message_request
-- creates the chat and the participant rows and writes no message, so the
-- thread holds only the sender's own sentence.
--
-- New copy is the exact phrase the in-app card already uses
-- (src/features/matching/connected-notice.tsx): 'Connected with {name}. Your
-- chat is open.' One event, one name, on the lock screen and in the app.
--
-- Body otherwise byte-identical to 20260820001000_copy_pass.sql:292-310 (the
-- live definition). Trigger function, no OUT columns, so `create or replace`
-- is correct and no grants move.

create or replace function public.enqueue_accept_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    select display_name into v_name from public.profiles where user_id = new.recipient_id;
    insert into public.push_queue (user_id, title, body, data)
    values (new.sender_id, 'Connected',
            'Connected with ' || coalesce(v_name, 'a traveler') || '. Your chat is open.',
            jsonb_build_object('type', 'accepted', 'chat_id', new.chat_id));
  end if;
  return new;
end
$$;
