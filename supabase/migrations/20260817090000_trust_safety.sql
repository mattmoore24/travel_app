-- Phase 5: trust & safety. Completes hard rule 5 ("every first message passes
-- moderation before delivery") with a Claude classification stage behind the
-- Phase 2 seam, and adds the enforcement machinery around it:
--
--   * app_config flags (server-only) gate the LLM stages so keyless dev/CI
--     keeps working: with `require_llm_moderation` off, behavior is exactly
--     Phase 2-4 (regex pre-filter only).
--   * With the flag ON, a first message that clears the regex pre-filter is
--     held in status 'pending_moderation' — invisible to the recipient, masked
--     as plain 'sent' for the sender — until supabase/functions/
--     moderation-worker gets a verdict from Claude and applies it through a
--     service-role-only RPC. There is no path to 'pending' that skips the
--     classifier while the flag is on.
--   * Strike system (warn -> suspend -> ban) driven off moderation_events, the
--     audit spine every moderation decision already lands in.
--   * Suspended/banned senders are refused at the DB layer (RPC gates +
--     can_send_in_chat), not just in the UI.
--   * Photo moderation flag replaces the Phase 1 auto-approve behavior when
--     enabled; the worker classifies pending photos.
--   * Selfie verification: a Claude-vision plausibility check that the selfie
--     matches the profile photos. HONESTY NOTE: this is NOT certified
--     liveness/identity verification (no challenge-response, no document
--     check); it deters casual catfishing only. A vendor liveness product is
--     the flagged upgrade path (docs/ARCHITECTURE.md).
--   * Admin report review queue: a service-role-only view + resolve RPC.
--
-- All verdict-applying and admin functions are executable ONLY by
-- postgres/service_role: EXECUTE is revoked from public, anon, AND
-- authenticated, plus a runtime guard rejects anon/authenticated JWT roles as
-- defense in depth.

-- App config (server-only feature flags) ----------------------------------------

create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

revoke all on public.app_config from anon, authenticated;

insert into public.app_config (key, value) values
  ('require_llm_moderation', 'false'),   -- flip on once ANTHROPIC_API_KEY is set
  ('require_photo_moderation', 'false'); -- and moderation-worker is scheduled

create function public.config_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value #>> '{}' from public.app_config where key = p_key), 'false'
  )::boolean
$$;

revoke execute on function public.config_flag(text) from public, anon, authenticated;

-- Runtime guard for server-only RPCs. EXECUTE revokes are the real barrier;
-- this catches misconfiguration (e.g. a future grant regression) at call time.
create function public.assert_service_caller()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    raise exception 'admin only' using errcode = '42501';
  end if;
end
$$;

revoke execute on function public.assert_service_caller()
  from public, anon, authenticated;

-- Account standing ----------------------------------------------------------------

alter table public.users add column suspended_until timestamptz;

-- Caller standing gate for the messaging RPCs. Shadowbanned users pass on
-- purpose: a shadowban must be unnoticeable, and everything they produce is
-- already invisible to others via is_visible_owner/is_discoverable_owner.
create function public.assert_good_standing()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status public.user_status;
begin
  select status into v_status from public.users where id = auth.uid();
  if v_status = 'suspended' then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if v_status = 'banned' then
    raise exception 'account banned' using errcode = '42501';
  end if;
end
$$;

revoke execute on function public.assert_good_standing()
  from public, anon, authenticated;

-- Suspensions are timed; this lifts the expired ones. Scheduled via pg_cron on
-- hosted Supabase (guarded below, like expire_pins).
create function public.lift_expired_suspensions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.users
    set status = 'active', suspended_until = null
    where status = 'suspended'
      and suspended_until is not null
      and suspended_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.lift_expired_suspensions()
  from public, anon, authenticated;

-- Strike system -------------------------------------------------------------------
-- Strikes are moderation_events with one of the STRIKE ACTIONS below. The
-- policy is deterministic and total-count based (strikes never expire in v1):
--   3 strikes -> warning (event + push)
--   5 strikes -> 7-day suspension
--   7 strikes -> permanent ban
-- Admin actions can also suspend/ban directly via admin_resolve_report.

create function public.is_strike_action(p_action text)
returns boolean
language sql
immutable
as $$
  select p_action in ('blocked', 'llm_blocked', 'photo_rejected', 'admin_strike')
$$;

revoke execute on function public.is_strike_action(text)
  from public, anon, authenticated;

create function public.apply_strike_policy()
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
            'Your account has been permanently banned for repeated guideline violations.',
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
            'Your account is suspended for 7 days for repeated guideline violations.',
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
            'Recent messages or photos broke our guidelines. This app is for platonic travel friends — further violations will suspend your account.',
            jsonb_build_object('type', 'moderation'));
  end if;
  return new;
end
$$;

-- The trigger inserts non-strike events into its own table; the recursive
-- firing is a no-op because those actions fail is_strike_action.
create trigger moderation_events_strikes
  after insert on public.moderation_events
  for each row execute function public.apply_strike_policy();

revoke execute on function public.apply_strike_policy()
  from public, anon, authenticated;

-- Message-request LLM stage --------------------------------------------------------

-- Worker retry bookkeeping (server-only: not in the client column grant).
alter table public.message_requests
  add column moderation_attempts int not null default 0;

create index message_requests_pending_moderation_idx
  on public.message_requests (created_at)
  where status = 'pending_moderation';

-- send_message_request, Phase 5 shape: standing gate + LLM hold state.
create or replace function public.send_message_request(
  p_recipient uuid,
  p_source public.request_source,
  p_first_message text,
  p_profile_element text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_verdict jsonb;
  v_status public.request_status;
  v_masked public.request_status;
  v_id uuid;
  v_shadowbanned boolean;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable';
  end if;
  if public.has_accepted_chat(p_recipient) then
    raise exception 'already connected with this traveler';
  end if;

  if p_source = 'trip_match' then
    if not exists (
      select 1
      from public.trips mine
      join public.trips theirs
        on theirs.city_id = mine.city_id
       and theirs.start_date <= mine.end_date
       and mine.start_date <= theirs.end_date
       and theirs.end_date >= current_date
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date
    ) then
      raise exception 'no overlapping trip with recipient';
    end if;
  elsif p_source = 'pin' then
    -- Only pins the sender could actually have seen count: live, and in an
    -- ACTIVE launch city — otherwise this branch becomes an oracle for pin
    -- existence in deactivated cities.
    if not exists (
      select 1
      from public.pins p
      join public.launch_cities lc on lc.city_id = p.city_id and lc.active
      where p.user_id = p_recipient and p.expires_at > now()
    ) then
      raise exception 'recipient has no active pin';
    end if;
  else
    raise exception 'unknown request source';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  v_status := case
    when v_verdict ->> 'action' = 'block' then 'blocked_by_moderation'::public.request_status
    -- HARD RULE 5: while LLM moderation is on, nothing reaches 'pending'
    -- (deliverable) without a classifier verdict — apply_message_verdict is
    -- the only transition out of 'pending_moderation'.
    when public.config_flag('require_llm_moderation') then 'pending_moderation'::public.request_status
    else 'pending'::public.request_status
  end;

  -- Shadowban suppression: a shadowbanned sender's clean message must look
  -- sent to them but never reach (or push-notify) the recipient — the row
  -- lands directly as 'declined', which sent_requests() masks as 'sent'.
  -- Blocked messages keep their real feedback (and strikes) either way.
  v_masked := v_status;
  select status = 'shadowbanned' into v_shadowbanned
  from public.users where id = v_sender;
  if v_shadowbanned and v_status in ('pending', 'pending_moderation') then
    v_status := 'declined';
  end if;

  -- A moderation-blocked attempt may be rewritten and retried — replace it.
  -- (The audit trail survives in moderation_events.) Delivered requests stay
  -- one-per-pair forever via the unique constraint.
  delete from public.message_requests
  where sender_id = v_sender and recipient_id = p_recipient
    and status = 'blocked_by_moderation';

  begin
    insert into public.message_requests
      (sender_id, recipient_id, source, profile_element, first_message,
       moderation_verdict, status)
    values
      (v_sender, p_recipient, p_source, p_profile_element, p_first_message,
       v_verdict, v_status)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'request already sent to this traveler';
  end;

  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_sender, 'message_request', v_id,
     case
       when v_status = 'blocked_by_moderation' then 'blocked'
       when v_status = 'declined' then 'shadowban_suppressed'
       when v_status = 'pending_moderation' then 'queued_for_llm'
       else 'stub_approved'
     end,
     'prefilter-v1', v_verdict);

  -- Delivery feedback reflects v_masked, not v_status: the shadowban
  -- suppression must be invisible to the sender.
  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_masked = 'pending',
    'queued', v_masked = 'pending_moderation',
    'blocked', v_masked = 'blocked_by_moderation');
end
$$;

-- The request push now fires in two ways: on direct delivery (insert lands at
-- 'pending') and on classifier release ('pending_moderation' -> 'pending').
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
    values (new.recipient_id, 'New message request',
            coalesce(v_name, 'A traveler') || ' wants to say hi',
            jsonb_build_object('type', 'request'));
  end if;
  return new;
end
$$;

create trigger message_requests_release_push
  after update on public.message_requests
  for each row execute function public.enqueue_request_push();

-- Applies the classifier's verdict. Service-role only: this is the ONLY
-- transition out of 'pending_moderation', so nothing client-callable can
-- release (or block) a held message.
--
-- Verdicts with engine 'failsafe' (the worker giving up after persistent
-- non-classifier failures) block WITHOUT a strike — a system outage must not
-- put users on the suspension ladder.
create function public.apply_message_verdict(p_request_id uuid, p_verdict jsonb)
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
              then 'Your message request couldn''t be reviewed and wasn''t delivered. Please try sending it again.'
              else 'Your message request wasn''t delivered — it reads as flirtatious or explicit. Rewrite it to keep things platonic.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

revoke execute on function public.apply_message_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- A block must also sever requests still held in the LLM queue, so a later
-- 'allow' verdict can't deliver across the block (apply_message_verdict
-- re-checks too — belt and braces).
create or replace function public.sever_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_requests
    set status = 'declined', responded_at = now()
    where status in ('pending', 'pending_moderation')
      and ((sender_id = new.blocker_id and recipient_id = new.blocked_id)
        or (sender_id = new.blocked_id and recipient_id = new.blocker_id));

  update public.chats
    set status = 'closed'
    where status = 'active'
      and id in (
        select a.chat_id
        from public.chat_participants a
        join public.chat_participants b on b.chat_id = a.chat_id
        where a.user_id = new.blocker_id and b.user_id = new.blocked_id
      );
  return new;
end
$$;

-- Standing gates on the existing paths ---------------------------------------------

-- Accepting a request builds a connection (and unlocks social handles) —
-- suspended/banned accounts don't get to do that either.
create or replace function public.respond_to_message_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.message_requests%rowtype;
  v_chat uuid;
begin
  perform public.assert_good_standing();
  select * into v_req
  from public.message_requests
  where id = p_request_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if not found then
    raise exception 'request not found';
  end if;

  if p_accept then
    -- Re-validate at accept time: a block created (or an account banned)
    -- after the request was sent must prevent the chat — and therefore the
    -- social-handle unlock — from ever forming.
    if public.is_blocked_pair(v_req.sender_id)
       or not public.is_discoverable_owner(v_req.sender_id) then
      raise exception 'request unavailable';
    end if;

    -- If a chat between the pair already exists (the reverse-direction
    -- request was accepted first), attach to it instead of creating a
    -- duplicate conversation.
    select c.id into v_chat
    from public.chats c
    join public.chat_participants a on a.chat_id = c.id and a.user_id = v_req.sender_id
    join public.chat_participants b on b.chat_id = c.id and b.user_id = v_req.recipient_id
    where c.status = 'active'
    limit 1;

    if v_chat is null then
      insert into public.chats default values returning id into v_chat;
      insert into public.chat_participants (chat_id, user_id)
      values (v_chat, v_req.sender_id), (v_chat, v_req.recipient_id);
    end if;

    update public.message_requests
      set status = 'accepted', chat_id = v_chat, responded_at = now()
      where id = p_request_id;
    return jsonb_build_object('accepted', true, 'chat_id', v_chat);
  end if;

  update public.message_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id;
  return jsonb_build_object('accepted', false);
end
$$;

-- Chat sending: suspended/banned senders are cut off at the RLS layer.
-- Shadowbanned users keep chatting in existing chats (a shadowban must be
-- unnoticeable; new discovery is already closed to them).
create or replace function public.can_send_in_chat(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants cp on cp.chat_id = c.id
    join public.users u on u.id = cp.user_id
    where c.id = p_chat_id
      and c.status = 'active'
      and cp.user_id = auth.uid()
      and u.status in ('active', 'shadowbanned')
  )
$$;

-- Photo moderation ------------------------------------------------------------------

alter table public.profile_photos
  add column moderation_attempts int not null default 0;

-- With require_photo_moderation ON, new photos hold at 'pending' (owner-only
-- visible — the Phase 1 RLS already gates others on 'approved') until the
-- worker classifies them. Flag off = Phase 1 auto-approve behavior, so
-- keyless dev keeps working.
create or replace function public.moderate_photo_stub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.config_flag('require_photo_moderation') then
    new.moderation_status := 'pending';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.user_id, 'profile_photo', new.id, 'queued_for_llm', 'photo-pipeline',
       jsonb_build_object('storage_path', new.storage_path, 'position', new.position));
  else
    new.moderation_status := 'approved';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.user_id, 'profile_photo', new.id, 'auto_approved', 'stub',
       jsonb_build_object('storage_path', new.storage_path, 'position', new.position));
  end if;
  return new;
end
$$;

create function public.apply_photo_verdict(p_photo_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo public.profile_photos%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_photo
  from public.profile_photos
  where id = p_photo_id and moderation_status = 'pending'
  for update;
  if not found then
    raise exception 'photo is not awaiting moderation';
  end if;

  if p_verdict ->> 'action' = 'allow' then
    update public.profile_photos
      set moderation_status = 'approved' where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_photo.user_id, 'profile_photo', p_photo_id, 'photo_approved',
       'claude-moderator', p_verdict);
  else
    update public.profile_photos
      set moderation_status = 'rejected' where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_photo.user_id, 'profile_photo', p_photo_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'photo_rejected_failsafe'  -- not a strike
            else 'photo_rejected' end,      -- a strike (apply_strike_policy)
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
    insert into public.push_queue (user_id, title, body, data)
    values (v_photo.user_id, 'Photo removed',
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'One of your photos couldn''t be reviewed and was removed. Please try uploading it again.'
              else 'One of your photos broke our guidelines and was removed.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

revoke execute on function public.apply_photo_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- Selfie verification ---------------------------------------------------------------

create type public.verification_status as enum ('pending', 'approved', 'rejected');

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null,
  status public.verification_status not null default 'pending',
  -- User-facing rejection reason ("selfie too dark"); the full model verdict
  -- stays in the server-only `verdict` column.
  reason text,
  verdict jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index verification_requests_user_idx on public.verification_requests (user_id);
create index verification_requests_pending_idx
  on public.verification_requests (created_at) where status = 'pending';

alter table public.verification_requests enable row level security;

create policy verification_requests_select_own
  on public.verification_requests for select to authenticated
  using (user_id = auth.uid());

revoke all on public.verification_requests from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.verification_requests from authenticated;
revoke select on public.verification_requests from authenticated;
grant select (id, user_id, status, reason, created_at, reviewed_at)
  on public.verification_requests to authenticated; -- verdict/attempts server-only

-- Private bucket for verification selfies. Write-only for owners: no client
-- SELECT policy at all — only the worker (service role) ever reads these.
insert into storage.buckets (id, name, public)
values ('verification-selfies', 'verification-selfies', false)
on conflict (id) do nothing;

create policy verification_selfies_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy verification_selfies_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create function public.submit_verification(p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if split_part(p_storage_path, '/', 1) <> v_user::text then
    raise exception 'selfie must live in your own storage folder';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'verification-selfies' and name = p_storage_path
  ) then
    raise exception 'selfie upload not found';
  end if;
  if exists (select 1 from public.profiles where user_id = v_user and verified) then
    raise exception 'already verified';
  end if;
  -- The worker compares the selfie against APPROVED profile photos; without
  -- one the request could only auto-reject, silently burning a daily attempt.
  if not exists (
    select 1 from public.profile_photos
    where user_id = v_user and moderation_status = 'approved'
  ) then
    raise exception 'add a profile photo before verifying';
  end if;

  perform pg_advisory_xact_lock(hashtext('verification:' || v_user::text));
  if exists (
    select 1 from public.verification_requests
    where user_id = v_user and status = 'pending'
  ) then
    raise exception 'verification already in review';
  end if;
  if (select count(*) from public.verification_requests
      where user_id = v_user and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too many verification attempts today';
  end if;

  insert into public.verification_requests (user_id, storage_path)
  values (v_user, p_storage_path)
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end
$$;

revoke execute on function public.submit_verification(text) from public, anon;

create function public.apply_verification_verdict(p_request_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.verification_requests%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_req
  from public.verification_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'verification request is not pending';
  end if;

  if p_verdict ->> 'action' = 'approve' then
    update public.verification_requests
      set status = 'approved', verdict = p_verdict, reviewed_at = now()
      where id = p_request_id;
    update public.profiles
      set verified = true,
          verification = jsonb_build_object(
            'method', 'claude-vision-plausibility',
            'request_id', p_request_id,
            'verdict', p_verdict,
            'at', now())
      where user_id = v_req.user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.user_id, 'verification', p_request_id, 'verification_approved',
       'claude-verifier', p_verdict);
    insert into public.push_queue (user_id, title, body, data)
    values (v_req.user_id, 'You''re verified', 'Your profile now shows the verified badge.',
            jsonb_build_object('type', 'verification'));
  else
    update public.verification_requests
      set status = 'rejected',
          reason = coalesce(p_verdict ->> 'reason', 'The selfie could not be matched to your profile photos.'),
          verdict = p_verdict,
          reviewed_at = now()
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.user_id, 'verification', p_request_id, 'verification_rejected',
       'claude-verifier', p_verdict); -- not a strike
  end if;
end
$$;

revoke execute on function public.apply_verification_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- Admin report review queue ---------------------------------------------------------
-- Service-role surface (SQL editor / future admin dashboard). Clients never
-- see it: the view has no anon/authenticated grants, and the resolve RPC is
-- execute-revoked + runtime-guarded.

create view public.admin_report_queue as
select
  r.id,
  r.created_at,
  r.reason,
  r.details,
  r.context,
  r.reporter_id,
  r.reported_user_id,
  u.status as reported_user_status,
  (select count(*) from public.moderation_events e
    where e.subject_user_id = r.reported_user_id
      and public.is_strike_action(e.action)) as reported_user_strikes,
  (select count(*) from public.reports r2
    where r2.reported_user_id = r.reported_user_id) as total_reports_against
from public.reports r
join public.users u on u.id = r.reported_user_id
where r.status = 'open'
order by r.created_at;

revoke all on public.admin_report_queue from anon, authenticated;

create function public.admin_resolve_report(
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
            'A report against your account was reviewed. This app is for platonic travel friends — further violations will suspend your account.',
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

revoke execute on function public.admin_resolve_report(uuid, text, text)
  from public, anon, authenticated;

-- Scheduling ------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('lift-suspensions', '*/15 * * * *',
                          'select public.lift_expired_suspensions()');
  end if;
end
$$;
