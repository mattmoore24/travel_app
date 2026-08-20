-- Chat, brought up to what people expect from a messaging app.
--
-- Two changes, both enforced here rather than in the client, because the
-- client is UX and Postgres is the boundary.
--
-- 1. ONE REACTION PER PERSON PER MESSAGE. The original primary key was
--    (message_id, user_id, emoji), which let one person stack six different
--    emoji on the same message. A reaction is a single reply, and tapping a
--    second emoji should MOVE yours, not add another.
--
-- 2. UNSEND. A sender can take a message back. This follows the shape the
--    moderator-removal path already established in the rooms migration: the
--    content is emptied, the ROW survives, and the original is archived to
--    moderation_events first. Reports reference messages, and a hard delete
--    would let someone send something abusive, get reported, and erase the
--    evidence before anyone could look at it.
--
--    `unsent_at` is deliberately separate from `removed_at`. "I withdrew
--    this" and "a moderator took this down" are different facts and a report
--    reviewer needs to tell them apart.

-- ---------------------------------------------------------------------------
-- 1. One reaction per person per message
-- ---------------------------------------------------------------------------

-- Collapse existing stacks to each person's most recent choice, or the
-- narrower key cannot be created. Ties broken by emoji so the result is
-- deterministic rather than dependent on scan order.
delete from public.message_reactions r
using public.message_reactions keep
where r.message_id = keep.message_id
  and r.user_id = keep.user_id
  and (r.created_at, r.emoji) < (keep.created_at, keep.emoji);

alter table public.message_reactions
  drop constraint message_reactions_pkey;

alter table public.message_reactions
  add constraint message_reactions_pkey primary key (message_id, user_id);

-- Changing your reaction is now an UPDATE of an existing row rather than a
-- second insert. The rooms migration revoked update on this table wholesale,
-- so a policy alone would be inert — RLS filters privileges, it does not
-- grant them. The grant comes back scoped to the one column that may move:
-- nobody can reassign a reaction to another person or another message.
grant update (emoji) on public.message_reactions to authenticated;

drop policy if exists message_reactions_update_own on public.message_reactions;
create policy message_reactions_update_own
  on public.message_reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Unsend
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists unsent_at timestamptz;

comment on column public.messages.unsent_at is
  'Set when the SENDER withdraws a message. Distinct from removed_at, which '
  'means a moderator took it down. Content is emptied; the original is '
  'archived to moderation_events first so reports stay reviewable.';

-- A withdrawn message has no content, exactly as a removed one does.
alter table public.messages
  drop constraint messages_have_content;

alter table public.messages
  add constraint messages_have_content
    check (
      removed_at is not null
      or unsent_at is not null
      or body is not null
      or image_path is not null
    );

-- One intent, one entry point. SECURITY DEFINER because the archive write
-- touches moderation_events, which callers cannot write to directly.
create or replace function public.unsend_message(p_message_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg
    from public.messages
   where id = p_message_id
     and sender_id = auth.uid()
     and unsent_at is null
     and removed_at is null
   for update;

  if not found then
    raise exception 'That message is not yours to unsend, or it is already gone.'
      using errcode = '42501';
  end if;

  -- Archive BEFORE emptying, so a failure here cannot lose the content.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values (
    v_msg.sender_id,
    'message',
    v_msg.id,
    'unsent_by_sender',
    'user',
    jsonb_build_object(
      'body', v_msg.body,
      'image_path', v_msg.image_path,
      'chat_id', v_msg.chat_id,
      'sent_at', v_msg.created_at
    )
  );

  update public.messages
     set unsent_at = now(),
         body = null,
         image_path = null
   where id = p_message_id;

  -- A withdrawn message should not keep the reactions it collected.
  delete from public.message_reactions where message_id = p_message_id;
end;
$$;

grant execute on function public.unsend_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Setting a reaction, in one statement
-- ---------------------------------------------------------------------------
--
-- PostgREST's upsert writes EVERY column in the payload on the conflict
-- branch, including message_id and user_id, and update is granted on `emoji`
-- alone — so `.upsert()` from the client fails with permission denied. Worse,
-- widening the grant to fix that would let a member move an existing reaction
-- onto a message in a chat they are not in, since the update policy can only
-- see user_id.
--
-- So the move is a function. SECURITY INVOKER on purpose: it runs with the
-- caller's privileges and under the caller's RLS, which means the insert
-- policy still proves chat membership and the update policy still proves
-- ownership. All this adds is the ability to touch one column.
create or replace function public.set_reaction(p_message_id uuid, p_emoji text)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.message_reactions (message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji;
$$;

revoke execute on function public.set_reaction(uuid, text) from public, anon;
grant execute on function public.set_reaction(uuid, text) to authenticated;
