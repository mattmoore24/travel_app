-- A room can tell you a photo is being checked, instead of drawing nothing.
--
-- `room_messages` masks `image_path` until the verdict lands — correctly; an
-- unscreened photo in a publicly-readable room is the most exposed content in
-- the product. But masking was ALL it did, so a photo in review came back as a
-- row with no image and (usually) no body, and the thread drew an empty
-- coloured bubble under the sender's name for the whole wait. The founder saw
-- it as "a tiny bubble", which is exactly what it is.
--
-- The state is not a secret: every photo in this app is checked, and saying so
-- is the honest version of a blank rectangle. The PATH stays masked, which is
-- the part that matters — and the storage read policy independently refuses
-- anyone but the sender until `moderation_status = 'approved'`, so this column
-- widens nothing.
--
-- DROP first: adding an OUT column to a RETURNS TABLE is a signature change
-- and `create or replace` refuses it, failing the deploy AFTER the statements
-- above it have applied. The grant goes with the drop, so it is restated.

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
  photo_state text
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
    end
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
