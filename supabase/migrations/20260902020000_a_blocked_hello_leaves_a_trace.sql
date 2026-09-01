-- A hello the classifier stopped after sending leaves a trace
-- ---------------------------------------------------------------------------
--
-- With require_llm_moderation on, the composer says the message is on its way
-- and the row appears under "You said hi". When the worker comes back with a
-- block minutes later, apply_message_verdict flips the status, and the Chat
-- tab - which filters that section to state 'sent' - simply stops drawing the
-- row on the next refetch. The app confirmed a message and then deleted the
-- record of it, and unique (sender_id, recipient_id) means the sender can
-- never write to that person again. Same instinct as failOptimistic in
-- src/features/chat/outgoing.ts: never destroy the only copy of what somebody
-- wrote.
--
-- The Chat tab's comment is right that a PREFILTER block is the sender's own
-- doing and does not belong in a waiting list: the composer warned them, they
-- pressed send anyway, and they were told immediately. It is wrong about the
-- asynchronous one, which the sender was never told about at all. So the two
-- have to be told apart, and the only place that knows is the verdict on the
-- row.
--
-- The distinction is the ENGINE, not the action. 'prefilter-v1' is the regex
-- the composer already showed them; anything else ('claude-moderator',
-- 'failsafe') landed after the confirmation. Failsafe counts as after-send
-- for the same reason it is not a strike: the sender did nothing wrong and
-- was equally not told.
--
-- Adding an OUT column to a `RETURNS TABLE` function needs `drop function`
-- first: `create or replace` is refused, and refused AFTER earlier statements
-- have applied (AGENTS.md, and the traps skill). The drop takes the grants
-- with it, so both lines are restated below. Without the grant the Chat tab
-- returns permission denied for every signed-in traveler; without the revoke,
-- anon quietly regains execute.
--
-- Body otherwise verbatim from 20260831194500:149.

drop function if exists public.sent_requests();

create function public.sent_requests()
returns table (
  id uuid,
  recipient_id uuid,
  source public.request_source,
  profile_element text,
  first_message text,
  state text,
  chat_id uuid,
  created_at timestamptz,
  expired_at timestamptz,
  blocked_after_send boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    recipient_id,
    source,
    profile_element,
    first_message,
    case status
      when 'accepted' then 'accepted'
      when 'blocked_by_moderation' then 'blocked'
      else 'sent'
    end,
    case when status = 'accepted' then chat_id else null end,
    created_at,
    expired_at,
    -- Stopped after the app said it was sent. The prefilter's own blocks are
    -- false here: those were refused in the composer, in front of the person
    -- writing, with the text still in the box.
    status = 'blocked_by_moderation'
      and coalesce(moderation_verdict ->> 'engine', '') <> 'prefilter-v1'
  from public.message_requests
  where sender_id = auth.uid()
  order by created_at desc
$$;

revoke execute on function public.sent_requests() from public, anon;
grant execute on function public.sent_requests() to authenticated;

comment on function public.sent_requests() is
  'The sender''s only read path for their own hellos. Collapses pending, '
  'declined and expired into a flat "sent" (invariants 4 and 5), and marks '
  'the one case the sender was never told about: a message stopped by the '
  'classifier after the app had already confirmed it.';
