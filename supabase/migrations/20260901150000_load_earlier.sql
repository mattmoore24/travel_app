-- A conversation can be read past its first screenful.
--
-- room_messages has taken a limit since it was written and no client ever
-- passed one, so a busy hostel room was silently capped at sixty messages
-- with nothing on screen to say a limit had been applied. This adds the
-- cursor the thread pages backwards with.
--
-- DROP FIRST, and it is not optional. Adding a defaulted parameter to a
-- Postgres function creates a second OVERLOAD rather than replacing the
-- original, and a two-argument call then matches both and fails with
-- "function is not unique". PostgREST calls by named argument, which does not
-- save you (20260827170000:295-298 records the same lesson for update_group).
-- The drop also removes the grant, so it is restated below.

drop function if exists public.room_messages(uuid, int);
drop function if exists public.room_messages(uuid, int, timestamptz);

create function public.room_messages(
  p_chat_id uuid,
  p_limit int default 60,
  -- Newest-first, so "the next page" is OLDER: this is the created_at of the
  -- oldest row already on screen, and null is the first page.
  p_before timestamptz default null
)
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
    and (p_before is null or m.created_at < p_before)
    -- The membership test is unchanged and stays INSIDE the same where
    -- clause: a cursor is not an access token, and a non-member passing any
    -- p_before at all must still get nothing back.
    and (
      public.is_room_member(p_chat_id)
      or public.is_room_moderator(p_chat_id)
      or public.is_public_room(p_chat_id)
    )
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200))
$$;

grant execute on function public.room_messages(uuid, int, timestamptz) to anon, authenticated;
