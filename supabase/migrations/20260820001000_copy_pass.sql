-- Copy pass on everything the server says out loud (founder review).
--
-- The push bodies were written in the same punitive register the in-app copy
-- has now dropped: "platonic travel friends", "violations", "flirtatious",
-- and the word "request" for what is just a first message. A notification is
-- read on a lock screen by whoever is looking at it, so this is the copy
-- that most needs to be plain and adult.
--
-- Function bodies are otherwise byte-identical to what is deployed; only the
-- strings changed.

create or replace function public.apply_strike_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_status public.user_status;
begin
  if new.subject_user_id is null or not public.is_strike_action(new.action) then
    return new;
  end if;

  -- Serialize per-user so concurrent strikes can't both read a stale count.
  perform pg_advisory_xact_lock(hashtext('strikes:' || new.subject_user_id::text));

  select count(*) into v_count
  from public.moderation_events
  where subject_user_id = new.subject_user_id
    and public.is_strike_action(action);

  select status into v_status from public.users where id = new.subject_user_id;
  if v_status is null or v_status = 'banned' then
    return new;
  end if;

  if v_count >= 7 then
    update public.users
      set status = 'banned', suspended_until = null
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'banned', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account banned',
            'Your account has been closed for repeated guideline breaches.',
            jsonb_build_object('type', 'moderation'));
  -- Suspension applies only to plain-active accounts: suspending a
  -- shadowbanned user would both reveal the shadowban (gate screen) and
  -- launder it into 'active' when lift_expired_suspensions runs. Shadowbanned
  -- accounts still hit the ban rung at 7.
  elsif v_count >= 5 and v_status = 'active' then
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'suspended', 'strike_policy',
       jsonb_build_object('strike_count', v_count, 'days', 7));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account suspended',
            'Your account is paused for 7 days for repeated guideline breaches.',
            jsonb_build_object('type', 'moderation'));
  elsif v_count >= 3 and not exists (
    select 1 from public.moderation_events
    where subject_user_id = new.subject_user_id and action = 'warning_issued'
  ) then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'warning_issued', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Community guidelines warning',
            'Some recent messages or photos broke our guidelines. Please keep it casual and friendly.',
            jsonb_build_object('type', 'moderation'));
  end if;
  return new;
end
$$;

create or replace function public.enqueue_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and old.status = 'pending_moderation'
         and new.status = 'pending') then
    select display_name into v_name from public.profiles where user_id = new.sender_id;
    insert into public.push_queue (user_id, title, body, data)
    values (new.recipient_id, 'Someone said hi',
            coalesce(v_name, 'A traveler') || ' wants to say hi',
            jsonb_build_object('type', 'request'));
  end if;
  return new;
end
$$;

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
  -- plain-active (suspended/banned — or shadowbanned, whose requests must
  -- never surface to recipients), a recipient turned invisible, or a chat
  -- that already formed via the reverse direction must keep the message from
  -- delivering. Decline silently (sender-invisible, like any decline) — the
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
    insert into public.push_queue (user_id, title, body, data)
    values (v_req.sender_id, 'Message not delivered',
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'Your message couldn''t be checked and wasn''t delivered. Please try again.'
              else 'Your message wasn''t delivered — it came across as explicit. Reword it and try again.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_rows int;
begin
  perform public.assert_service_caller();
  if p_action not in ('dismiss', 'warn', 'strike', 'suspend', 'ban', 'shadowban') then
    raise exception 'unknown action %', p_action;
  end if;

  select * into v_report
  from public.reports
  where id = p_report_id and status = 'open'
  for update;
  if not found then
    raise exception 'report not open';
  end if;

  if p_action = 'warn' then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'warning_issued', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
    insert into public.push_queue (user_id, title, body, data)
    values (v_report.reported_user_id, 'Community guidelines warning',
            'A report about your account was reviewed. Please keep it casual and friendly.',
            jsonb_build_object('type', 'moderation'));
  elsif p_action = 'strike' then
    -- The strike policy trigger handles any resulting warn/suspend/ban.
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_strike', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'suspend' then
    -- Applies to active accounts (or extends an existing suspension). Never
    -- overwrites a shadowban — lift_expired_suspensions would launder it into
    -- 'active' — and never downgrades a ban. Audit events are only written
    -- for state changes that actually happened.
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = v_report.reported_user_id and status in ('active', 'suspended');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'suspend does not apply to this account''s status';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_suspended', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'ban' then
    update public.users
      set status = 'banned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'account is already banned';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_banned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'shadowban' then
    update public.users
      set status = 'shadowbanned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'cannot shadowban a banned account';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_shadowbanned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  end if;

  update public.reports
    set status = 'resolved:' || p_action
    where id = p_report_id;
end
$$;

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
    values (new.sender_id, 'Chat open',
            coalesce(v_name, 'A traveler') || ' replied. Say hi.',
            jsonb_build_object('type', 'accepted', 'chat_id', new.chat_id));
  end if;
  return new;
end
$$;
