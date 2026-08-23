-- A venue room stays read-only for a guest, in the database
-- ===========================================================================
--
-- 20260823060000 drew the line correctly and then only enforced half of it.
-- The rule is: a chat somebody handed you a link to is yours to answer, and a
-- venue's open room is a public front door that a free-to-mint identity does
-- not get to post through. The client has always said so - the room footer
-- offers an account rather than a composer - but the client is not where a
-- rule lives. Anybody holding the anon key, which ships inside the app, could
-- sign in anonymously and insert straight into a hostel's room.
--
-- The two are the same shape and tell apart by one row: both are chats of
-- kind 'room' with room_members, and a traveler group additionally has a
-- `groups` row naming it. So "no groups row" is the venue room, and that is
-- the check.
--
-- Guests were never able to JOIN a venue room from the app, so nothing that
-- exists today starts failing; this closes the door the UI was holding shut.

create or replace function public.guest_message_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_guest_account(new.sender_id) then
    return new;
  end if;
  if new.image_path is not null then
    raise exception 'make an account to send photos' using errcode = 'check_violation';
  end if;
  -- A room with no groups row is a venue's own open chat. Reading it is what
  -- it is for; posting into it is the part that needs a name somebody can be
  -- held to.
  if exists (
    select 1 from public.chats c
    where c.id = new.chat_id
      and c.kind = 'room'
      and not exists (select 1 from public.groups g where g.chat_id = c.id)
  ) then
    raise exception 'make an account to post in an open room'
      using errcode = 'check_violation';
  end if;
  if (select count(*) from public.messages
      where sender_id = new.sender_id
        and created_at > now() - interval '24 hours') >= 200 then
    raise exception 'daily limit reached. Make an account to keep going'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function public.guest_message_limits() is
  'Guests: no photos, no posting in a venue room (a group they hold a link '
  'for is fine), 200 messages a day. The client draws the same line; this is '
  'the one that holds when somebody skips the client.';
