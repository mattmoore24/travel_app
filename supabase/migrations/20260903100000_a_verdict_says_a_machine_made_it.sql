-- A verdict says a machine made it
-- ===========================================================================
--
-- DSA Art. 17(3)(c): a statement of reasons says whether the decision was
-- taken by automated means. Four of the five moderation pushes already do -
-- both photo bodies (20260901100000) and the warning, pause and closure
-- notices (20260901130000). The fifth, 'Message not delivered', lives in
-- apply_message_verdict and was left alone rather than copied into a photo
-- migration for one sentence (docs/PROGRESS.md, "Owed"). This is that
-- sentence, and nothing else.
--
-- RESTATED FROM THE CURRENT DEFINITION, and that has to be said because this
-- function was silently reverted once this week by a restate from an older
-- file. The two definitions in the tree are 20260820001000_copy_pass.sql:109
-- and 20260830030000_curated_pins_say_it_plainly.sql:100, and a diff of the
-- two bodies is three lines: two em dashes in comments, and the refusal body
-- itself, which 20260830030000 reworded from "wasn't delivered — it came
-- across as explicit" to plain sentences. THIS file is the 20260830030000
-- body, checked line by line before the one edit below. Anybody restating it
-- again starts from here: `grep -ln "create or replace function
-- public.apply_message_verdict" supabase/migrations/*.sql | tail -1`.
--
-- THE ONE EDIT. The llm_blocked body gains one sentence, in the words the
-- photo push already uses ("An automatic check made that call"), and says
-- where a person can be asked to look again - House rules and help, which is
-- the screen this push already opens (use-notification-routing.ts routes
-- type 'moderation' to /guidelines). The failsafe body is untouched: a
-- failsafe hold is the check NOT running, not a decision anybody took, and a
-- machine-decided claim on it would be its own kind of wrong (the same
-- reasoning 20260901130000 gives for leaving the admin warning alone).
--
-- WHO RECEIVES IT. The push is queued for v_req.sender_id and for nobody
-- else, about the sender's OWN message. The recipient is told nothing here
-- and never was: the row moves to blocked_by_moderation, which
-- incoming_requests() excludes, and no push_queue row is written for them.
-- 30_copy_is_ours.test.sql asserts both halves. No em dash, sentence case,
-- no banned word.
--
-- Returns void, no OUT columns: create or replace is correct. The revoke is
-- restated so the file reads on its own. The 'request is not awaiting
-- moderation' raise is reissued byte for byte - it is service-facing (only
-- the moderation worker can call this) and is allowlisted for the copy lint
-- the same way 20260830030000's reissue is.

create or replace function public.apply_message_verdict(p_request_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.message_requests%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_req
  from public.message_requests
  where id = p_request_id and status = 'pending_moderation'
  for update;
  if not found then
    raise exception 'request is not awaiting moderation';
  end if;

  -- Re-validate the pair at release time: a block filed, the sender no longer
  -- plain-active (suspended/banned - or shadowbanned, whose requests must
  -- never surface to recipients), a recipient turned invisible, or a chat
  -- that already formed via the reverse direction must keep the message from
  -- delivering. Decline silently (sender-invisible, like any decline) - the
  -- sender did nothing wrong here.
  if p_verdict ->> 'action' = 'allow' and (
    exists (
      select 1 from public.blocks
      where (blocker_id = v_req.sender_id and blocked_id = v_req.recipient_id)
         or (blocker_id = v_req.recipient_id and blocked_id = v_req.sender_id)
    )
    or not public.is_discoverable_owner(v_req.recipient_id)
    or not exists (
      select 1 from public.users
      where id = v_req.sender_id and status = 'active'
    )
    or exists (
      select 1
      from public.chats c
      join public.chat_participants a on a.chat_id = c.id and a.user_id = v_req.sender_id
      join public.chat_participants b on b.chat_id = c.id and b.user_id = v_req.recipient_id
      where c.status = 'active'
    )
  ) then
    update public.message_requests
      set status = 'declined', moderation_verdict = p_verdict, responded_at = now()
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id, 'release_declined',
       'claude-moderator', p_verdict);
    return;
  end if;

  if p_verdict ->> 'action' = 'allow' then
    update public.message_requests
      set status = 'pending', moderation_verdict = p_verdict
      where id = p_request_id; -- fires message_requests_release_push
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id, 'llm_approved',
       'claude-moderator', p_verdict);
  else
    update public.message_requests
      set status = 'blocked_by_moderation', moderation_verdict = p_verdict
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'blocked_failsafe'      -- not a strike
            else 'llm_blocked' end,      -- a strike (apply_strike_policy)
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
    -- To the SENDER, about their own message. The failsafe body carries no
    -- automation claim: the check did not run, so nothing was decided.
    insert into public.push_queue (user_id, title, body, data)
    values (v_req.sender_id, 'Message not delivered',
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'Your message couldn''t be checked and wasn''t delivered. Please try again.'
              else 'Your message wasn''t delivered. It came across as explicit, so reword it and try again. An automatic check made that call, and a person will look again if you write to us from House rules and help.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

revoke execute on function public.apply_message_verdict(uuid, jsonb)
  from public, anon, authenticated;
