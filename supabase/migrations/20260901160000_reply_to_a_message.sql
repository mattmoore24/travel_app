-- Answering one message rather than the room.
--
-- In a group of six discussing three plans for tonight, "I'm in" carries no
-- information, and the five-minute grouping window welds it to whatever came
-- before it. One column fixes that for every kind of conversation at once:
-- `messages` is ONE table serving direct chats and rooms alike
-- (20260816220000:15-21), and room_messages is an RPC over it.

alter table public.messages
  add column reply_to_message_id uuid references public.messages (id) on delete set null;

create index messages_reply_idx on public.messages (reply_to_message_id);

-- `messages` carries TABLE-level grants (20260816220000:57-58 revokes from
-- anon and narrows authenticated by statement, never by column), so a new
-- column is covered by the grant that is already there and `select *` keeps
-- working. 31_select_star_stays_readable.test.sql is the proof, and it stays
-- the proof: a column-level grant on this table would need this comment
-- rewritten and the new column granted here.

-- ---------------------------------------------------------------------------
-- A reply cannot point out of its own conversation
-- ---------------------------------------------------------------------------
--
-- A check constraint cannot ask this question — it needs a subquery — so it is
-- a trigger. Without it a client could quote a message from a chat the reader
-- is not in, and the quoted line would be delivered to everybody in this one.
--
-- SECURITY DEFINER on purpose: the question is about the DATA ("is the parent
-- in this chat"), not about what the writer happens to be allowed to read. As
-- an invoker query, a parent hidden by RLS would look identical to a parent in
-- another chat, which is the right answer by luck rather than by construction.

create function public.messages_reply_same_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.messages m
     where m.id = new.reply_to_message_id
       and m.chat_id = new.chat_id
  ) then
    raise exception 'You can only reply to a message in this chat.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke execute on function public.messages_reply_same_chat() from public, anon, authenticated;

create trigger messages_reply_same_chat
  before insert on public.messages
  for each row execute function public.messages_reply_same_chat();

-- ---------------------------------------------------------------------------
-- room_messages carries the quoted line
-- ---------------------------------------------------------------------------
--
-- DROP FIRST. `create or replace` cannot add an OUT column to a RETURNS TABLE
-- signature: Postgres refuses, and the deploy fails AFTER the statements above
-- have already applied. Both live signatures are dropped (the two-argument
-- form in case a deploy lands out of order), and the grant is restated,
-- because the drop takes it with it.

drop function if exists public.room_messages(uuid, int);
drop function if exists public.room_messages(uuid, int, timestamptz);

create function public.room_messages(
  p_chat_id uuid,
  p_limit int default 60,
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
  kind public.message_kind,
  -- What this message answers. The id is what the app scrolls to one day; the
  -- name and the line are what it draws now.
  reply_to_message_id uuid,
  -- The parent sender's DISPLAY NAME and never a handle. Hard rule 4: a handle
  -- is invisible until an accepted one-to-one chat, and a room is neither.
  reply_to_name text,
  -- Null once the parent is unsent or taken down, rather than a preserved copy
  -- of something the reader is no longer allowed to see. The id survives, so
  -- the strip still says the message was an answer.
  reply_to_body text
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
    m.kind,
    m.reply_to_message_id,
    (select rp.display_name
       from public.messages r
       left join public.profiles rp on rp.user_id = r.sender_id
      where r.id = m.reply_to_message_id),
    (select case
              when r.unsent_at is not null or r.removed_at is not null then null
              else r.body
            end
       from public.messages r
      where r.id = m.reply_to_message_id)
  from public.messages m
  left join public.profiles p on p.user_id = m.sender_id
  where m.chat_id = p_chat_id
    and (p_before is null or m.created_at < p_before)
    -- Unchanged, and it governs the quoted columns too: a non-member gets no
    -- rows at all, so there is nothing for the reply fields to leak out of.
    and (
      public.is_room_member(p_chat_id)
      or public.is_room_moderator(p_chat_id)
      or public.is_public_room(p_chat_id)
    )
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200))
$$;

grant execute on function public.room_messages(uuid, int, timestamptz) to anon, authenticated;
