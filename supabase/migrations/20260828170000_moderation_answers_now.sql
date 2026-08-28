-- Moderation stops waiting for the clock.
--
-- Every photo posted into a chat is held invisible until Claude has looked at
-- it (hard rule: fail closed). That is not negotiable — but the WAIT was, and
-- almost all of it was scheduling rather than thinking:
--
--   cron fires every minute            -> mean 30s of doing nothing at all
--   chat photos drain third of six     -> behind messages and profile photos
--   the classifier itself              -> a few seconds
--
-- So somebody sending a photo in a group chat watched a placeholder for the
-- better part of a minute, and the app could not honestly tell them how long
-- it would be.
--
-- This makes the insert itself the trigger. Posting a photo pokes the worker
-- immediately; the every-minute cron stays exactly as it is, as the backstop
-- for anything a poke misses (pg_net down, the throttle below swallowing a
-- burst, a queue filled by something with no trigger on it).
--
-- Nothing here changes a verdict, a policy, or what is visible to whom.

-- The throttle's state. One row per worker.
--
-- A poke is an HTTP request, and a room where six people paste photos at once
-- would otherwise fire six overlapping invocations of a worker that drains a
-- shared queue — each one paying for a vault read and a cold start to find
-- work the first has already claimed.
create table if not exists public.worker_pokes (
  worker text primary key,
  last_poked_at timestamptz not null default now()
);

-- Server-side only. Nothing in the app has any business reading or writing it,
-- and RLS with no policy at all is the flat "no" this wants.
alter table public.worker_pokes enable row level security;
revoke all on public.worker_pokes from anon, authenticated;

comment on table public.worker_pokes is
  'Throttle state for fire-on-insert worker pokes. Server-side only.';

/**
 * Ask a worker to run now, at most once every few seconds.
 *
 * The claim is the UPDATE itself rather than a read-then-write: the `where` on
 * the conflict clause means only the statement that actually moves the
 * timestamp forward gets a row back, so concurrent inserts in the same second
 * settle it between themselves without a lock of ours.
 */
create or replace function public.poke_worker(p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_claimed boolean := false;
begin
  -- invoke_edge_worker allowlists the name itself; this mirrors it so a bad
  -- name cannot even reach the throttle table.
  if p_name not in ('moderation-worker', 'push-worker') then
    return;
  end if;

  insert into public.worker_pokes as w (worker, last_poked_at)
  values (p_name, now())
  on conflict (worker) do update
    set last_poked_at = now()
    where w.last_poked_at < now() - interval '3 seconds'
  returning true into v_claimed;

  if coalesce(v_claimed, false) then
    perform public.invoke_edge_worker(p_name);
  end if;
exception
  when others then
    -- A poke is an optimisation. The cron backstop is the guarantee, so a
    -- failure here must never take down the insert that triggered it — which
    -- would mean a photo that could not be sent at all.
    return;
end
$$;

revoke all on function public.poke_worker(text) from public, anon, authenticated;

/**
 * The trigger side. One function for every queue, because they all want the
 * same thing: the worker, now.
 *
 * AFTER INSERT, so the row the worker is about to look for is really there.
 * pg_net queues its request transactionally, so the HTTP call leaves only
 * once this transaction commits — a rolled-back send never pokes anything.
 */
create or replace function public.poke_moderation_worker()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
begin
  perform public.poke_worker('moderation-worker');
  return null;
end
$$;

revoke all on function public.poke_moderation_worker() from public, anon, authenticated;

-- A photo in a chat: the one somebody is actually watching.
drop trigger if exists messages_poke_moderation on public.messages;
create trigger messages_poke_moderation
  after insert on public.messages
  for each row
  when (new.moderation_status = 'pending' and new.image_path is not null)
  execute function public.poke_moderation_worker();

-- A held first message. The sender sees "waiting to be delivered" and the
-- recipient sees nothing at all until this clears.
drop trigger if exists message_requests_poke_moderation on public.message_requests;
create trigger message_requests_poke_moderation
  after insert on public.message_requests
  for each row
  when (new.status = 'pending_moderation')
  execute function public.poke_moderation_worker();

-- A profile photo, watched on the person's own profile with "in review" on it.
drop trigger if exists profile_photos_poke_moderation on public.profile_photos;
create trigger profile_photos_poke_moderation
  after insert on public.profile_photos
  for each row
  when (new.moderation_status = 'pending')
  execute function public.poke_moderation_worker();

-- A selfie verification, taken seconds ago on a screen that is still open.
drop trigger if exists verification_requests_poke_moderation on public.verification_requests;
create trigger verification_requests_poke_moderation
  after insert on public.verification_requests
  for each row
  when (new.status = 'pending')
  execute function public.poke_moderation_worker();

/**
 * How long the wait actually is, per queue.
 *
 * The app is about to tell people a number ("usually about N seconds"), and a
 * number nobody measured is a promise nobody can keep. Every queued item logs
 * a `queued_for_llm` event and every verdict logs another against the same
 * entity, so the gap between them is the whole wait — scheduling, queue
 * position and thinking together, which is exactly what somebody staring at a
 * placeholder experiences.
 *
 * Seven days, because a number from launch week should not still be shaping
 * copy a month later.
 */
create or replace view public.admin_moderation_latency as
with queued as (
  select entity_type, entity_id, min(created_at) as queued_at
  from public.moderation_events
  where action = 'queued_for_llm'
    and entity_id is not null
    and created_at > now() - interval '7 days'
  group by entity_type, entity_id
),
decided as (
  select q.entity_type, q.entity_id, q.queued_at, min(e.created_at) as decided_at
  from queued q
  join public.moderation_events e
    on e.entity_type = q.entity_type
   and e.entity_id = q.entity_id
   and e.created_at > q.queued_at
   and e.source in ('claude-moderator', 'claude-verifier', 'claude-storefront', 'failsafe')
  group by q.entity_type, q.entity_id, q.queued_at
),
waits as (
  select entity_type, extract(epoch from decided_at - queued_at) as seconds
  from decided
)
select
  entity_type,
  count(*) as decided,
  round(avg(seconds)::numeric, 1) as mean_seconds,
  round((percentile_cont(0.5) within group (order by seconds))::numeric, 1) as p50_seconds,
  round((percentile_cont(0.95) within group (order by seconds))::numeric, 1) as p95_seconds,
  round(max(seconds)::numeric, 1) as max_seconds,
  (select count(*) from queued q2 where q2.entity_type = waits.entity_type)
    - count(*) as still_waiting
from waits
group by entity_type;

revoke all on public.admin_moderation_latency from anon, authenticated;

comment on view public.admin_moderation_latency is
  'Queued-to-verdict wait per moderation queue over the last 7 days. The '
  'source of truth for any "usually about N seconds" the app promises.';
