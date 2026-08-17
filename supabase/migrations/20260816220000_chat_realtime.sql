-- Phase 4: realtime 1:1 messaging on accepted chats, unmatch/report tooling,
-- and the server-side push-notification queue.
--
-- Semantics decided here (documented in ARCHITECTURE):
--   * BLOCK freezes a chat (status='closed' via the Phase 2 sever trigger):
--     history stays readable to both members as evidence for reports, but
--     nothing new can be sent.
--   * UNMATCH deletes the chat for both (brief §1: "unmatch (deletes chat
--     for both)") — messages hard-delete via cascade.
--   * Push delivery is queue-based: triggers enqueue, an Edge Function
--     drains (supabase/functions/push-worker). The queue is server-only.

-- Messages ----------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_chat_idx on public.messages (chat_id, created_at desc);

-- Caller-scoped: can the CALLER send into this chat right now?
create function public.can_send_in_chat(p_chat_id uuid)
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
    where c.id = p_chat_id
      and c.status = 'active'
      and cp.user_id = auth.uid()
  )
$$;

revoke execute on function public.can_send_in_chat(uuid) from public, anon;

alter table public.messages enable row level security;

create policy messages_select_member
  on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));

-- Sending requires an ACTIVE chat: a block (which closes the chat) freezes
-- the conversation immediately in both directions.
create policy messages_insert_member
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_in_chat(chat_id));

revoke all on public.messages from anon;
revoke update, delete, truncate, references, trigger on public.messages from authenticated;

-- Realtime: hosted Supabase streams RLS-filtered postgres changes to
-- subscribed clients. Guarded so the migration also runs where the
-- publication doesn't exist (local test rig, CI).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;

-- Unmatch ------------------------------------------------------------------------

create function public.unmatch_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(p_chat_id) then
    raise exception 'chat not found';
  end if;
  -- A closed chat is frozen evidence (a block closed it); neither member —
  -- least of all a reported abuser — may hard-delete that history.
  if exists (select 1 from public.chats where id = p_chat_id and status <> 'active') then
    raise exception 'cannot unmatch a closed conversation';
  end if;
  -- Keep the request row (its unique pair constraint is the anti-re-pester
  -- rule) but detach it before the FK'd chat row is removed.
  update public.message_requests set chat_id = null where chat_id = p_chat_id;
  delete from public.chats where id = p_chat_id;
end
$$;

revoke execute on function public.unmatch_chat(uuid) from public, anon;

-- Reports ------------------------------------------------------------------------

create type public.report_reason as enum
  ('flirtation_or_sexual', 'harassment', 'spam', 'fake_profile', 'safety_concern', 'other');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id) on delete cascade,
  reported_user_id uuid not null references public.users (id) on delete cascade,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) <= 1000),
  -- Where the report came from, e.g. 'chat:<uuid>', 'profile', 'pin:<uuid>'.
  context text check (context is null or char_length(context) <= 80),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

alter table public.reports enable row level security;

create policy reports_insert_own
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

create policy reports_select_own
  on public.reports for select to authenticated
  using (reporter_id = auth.uid());

revoke all on public.reports from anon;
revoke update, delete, truncate, references, trigger on public.reports from authenticated;
revoke select on public.reports from authenticated;
grant select (id, reporter_id, reported_user_id, reason, details, context, created_at)
  on public.reports to authenticated; -- review status is admin-only

-- Every report lands in the moderation audit spine (Phase 5 review queue).
create function public.log_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (new.reported_user_id, 'report', new.id, 'filed', 'user_report',
     jsonb_build_object('reason', new.reason, 'context', new.context));
  return new;
end
$$;

create trigger reports_log
  after insert on public.reports
  for each row execute function public.log_report();

-- Push notifications -------------------------------------------------------------

-- One row per device token; a token follows the device, so re-registration
-- by a different account (shared device) reassigns it via the RPC below.
create table public.push_tokens (
  token text primary key check (char_length(token) between 10 and 200),
  user_id uuid not null references public.users (id) on delete cascade,
  platform text not null default 'ios',
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own
  on public.push_tokens for select to authenticated
  using (user_id = auth.uid());

create policy push_tokens_delete_own
  on public.push_tokens for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.push_tokens from anon;
revoke insert, update, truncate, references, trigger on public.push_tokens from authenticated;

create function public.register_push_token(p_token text, p_platform text default 'ios')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.push_tokens where token = p_token;
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), coalesce(p_platform, 'ios'));
end
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;

-- Server-only outbox drained by supabase/functions/push-worker.
create table public.push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.push_queue enable row level security; -- no policies: server-only
revoke all on public.push_queue from anon, authenticated;

-- Enqueue triggers. All SECURITY DEFINER (they read profiles and write the
-- server-only queue); none are client-callable.

create function public.enqueue_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status = 'pending' then
    select display_name into v_name from public.profiles where user_id = new.sender_id;
    insert into public.push_queue (user_id, title, body, data)
    values (new.recipient_id, 'New message request',
            coalesce(v_name, 'A traveler') || ' wants to say hi',
            jsonb_build_object('type', 'request'));
  end if;
  return new;
end
$$;

create trigger message_requests_push
  after insert on public.message_requests
  for each row execute function public.enqueue_request_push();

create function public.enqueue_accept_push()
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
    values (new.sender_id, 'Request accepted',
            coalesce(v_name, 'A traveler') || ' accepted your request — say hi!',
            jsonb_build_object('type', 'accepted', 'chat_id', new.chat_id));
  end if;
  return new;
end
$$;

create trigger message_requests_accept_push
  after update on public.message_requests
  for each row execute function public.enqueue_accept_push();

create function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select display_name into v_name from public.profiles where user_id = new.sender_id;
  insert into public.push_queue (user_id, title, body, data)
  select cp.user_id,
         coalesce(v_name, 'New message'),
         left(new.body, 140),
         jsonb_build_object('type', 'message', 'chat_id', new.chat_id)
  from public.chat_participants cp
  where cp.chat_id = new.chat_id and cp.user_id <> new.sender_id;
  return new;
end
$$;

create trigger messages_push
  after insert on public.messages
  for each row execute function public.enqueue_message_push();

revoke execute on function
  public.log_report(),
  public.enqueue_request_push(),
  public.enqueue_accept_push(),
  public.enqueue_message_push()
from public, anon, authenticated;

-- Chat list gains last-message context and activity ordering (return type
-- changes, so drop + recreate).
drop function public.my_chats();

create function public.my_chats()
returns table (
  chat_id uuid,
  chat_status public.chat_status,
  other_user_id uuid,
  other_display_name text,
  other_photo_path text,
  first_message text,
  first_message_sender_id uuid,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.status,
    other.user_id,
    op.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = other.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.first_message,
    r.sender_id,
    lm.body,
    lm.created_at,
    c.created_at
  from public.chats c
  join public.chat_participants me
    on me.chat_id = c.id and me.user_id = auth.uid()
  join public.chat_participants other
    on other.chat_id = c.id and other.user_id <> auth.uid()
  left join public.profiles op on op.user_id = other.user_id
  left join public.message_requests r on r.chat_id = c.id
  left join lateral (
    select m.body, m.created_at
    from public.messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc
$$;

revoke execute on function public.my_chats() from public, anon;
