-- A BUDGET THAT SAYS NO.
--
-- The moderation pipeline is the only thing in this app that spends money per
-- unit of user activity, and until now nothing in the system counted it.
--
-- WHAT BOUNDED IT BEFORE, exactly, because "unbounded" would be wrong and
-- "bounded" would be misleading:
--
--   The worker's per-tick limits are real and they do bound THROUGHPUT.
--   Nine queues, each with a `.limit()`:
--     chat photos 8, held messages 10, profile photos 5, business photos 5,
--     post photos 5, group photos 5, selfies 3, storefronts 3, scans 3
--   = 47 model calls per tick, against a cron that fires every minute
--   (20260817230000: '* * * * *'), so 47 x 1440 = 67,680 calls a day. The
--   50-second TICK_BUDGET_MS pulls the real number below that, since a queue
--   only gets its slice of the clock, but the clock is a LATENCY device -- it
--   exists so a slow queue cannot starve the one behind it -- and treating it
--   as a spend control is reading a fence as a wall.
--
--   67,680 calls a day of Opus 5 at max_tokens 16000, most of them carrying an
--   image, is roughly two thousand dollars a day. Nothing anywhere refuses the
--   67,681st. The per-user caps below bound what one ACCOUNT can queue; they
--   do not bound what N accounts can queue, and the queue is the bill.
--
-- So: a daily ceiling, claimed before the spend rather than counted after it.
--
-- CLAIM, THEN RELEASE, and the asymmetry is the point. The worker asks for
-- what a queue might use, gets what is left, and hands back what it did not
-- spend. If the isolate is killed mid-tick -- which is the failure this
-- pipeline has actually had, and why TICK_BUDGET_MS exists -- the release
-- never runs and the day is charged for calls that never happened. That is
-- the correct direction to be wrong in: a killed worker under-spends the cap
-- instead of escaping it. Counting after each call would fail the other way.
--
-- HITTING THE CAP IS NOT A SAFETY EVENT. A queue that cannot claim budget
-- stops selecting rows, so content stays exactly where it was: 'pending', held,
-- undelivered, unshown. The degradation is LATENCY, never an approval. There is
-- no path here that lets an unclassified first message or photo through --
-- that would break hard rule 5, and the whole design of this cap is that
-- running out of money looks like a slow queue and never like an open door.
--
-- The day is `current_date` in the database's clock, which on Supabase is UTC.
-- A cap is a spend control, not a user-facing window, so it does not need a
-- city's clock the way pin expiry does.

-- 1. The counter. Server-owned: RLS on, no policies, deny-all, exactly like
--    app_config and push_queue and the other thirteen.
create table if not exists public.moderation_spend (
  day date primary key,
  calls integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.moderation_spend enable row level security;
revoke all on public.moderation_spend from anon, authenticated;

comment on table public.moderation_spend is
  'One row per UTC day: model calls the moderation worker has CLAIMED (not '
  'necessarily made -- a killed isolate never releases its unspent claim, '
  'which under-spends the cap rather than escaping it). Server-owned: RLS on '
  'with no policies, so no API role can read or write it.';

-- 2. An integer companion to config_flag. Eight migrations have inlined this
--    same lookup; the ninth may as well have a name for it.
create or replace function public.config_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value #>> '{}')::int from public.app_config where key = p_key),
    p_default
  )
$$;

revoke execute on function public.config_int(text, int) from public, anon, authenticated;

-- 3. The ceiling and the kill switch.
--
--    2000/day is deliberately near-term rather than aspirational: this app is
--    in TestFlight, where honest traffic is a couple of dozen calls a day, and
--    a cap two orders of magnitude above real usage still refuses a runaway
--    three orders below the old one. It is one UPDATE to raise, and raising it
--    is on the launch checklist -- a cap sized for TestFlight would hold real
--    users' first messages on launch day, which is the failure mode this
--    comment exists to prevent.
insert into public.app_config (key, value) values
  ('moderation_daily_call_cap', '2000'),
  ('moderation_paused', 'false')
on conflict (key) do nothing;

-- 4. Claim. Returns {granted, day}: how many calls the caller may make, and
--    the day it was charged to.
--
--    RETURNS JSONB RATHER THAN INT, and the day is the reason. A tick starts at
--    23:59:58 and finishes after midnight; a release that targeted
--    current_date at RELEASE time would credit the unspent remainder to
--    tomorrow, which both loses today's refund and hands tomorrow up to a
--    tick's worth of budget it never claimed. The caller hands the day back.
create or replace function public.claim_moderation_budget(p_want int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := current_date;
  v_cap   int;
  v_used  int;
  v_grant int;
begin
  perform public.assert_service_caller();

  if p_want is null or p_want <= 0 then
    return jsonb_build_object('granted', 0, 'day', v_day);
  end if;

  -- The kill switch, checked first so that flipping it stops spend on the very
  -- next tick without waiting for a counter to catch up.
  if public.config_flag('moderation_paused') then
    return jsonb_build_object('granted', 0, 'day', v_day);
  end if;

  v_cap := public.config_int('moderation_daily_call_cap', 2000);

  -- ON CONFLICT DO UPDATE, not DO NOTHING, and this is not a style choice.
  --
  -- With DO NOTHING followed by a separate SELECT ... FOR UPDATE, two ticks
  -- racing on the first claim of a new day deadlock into a hole: the loser's
  -- insert is skipped, and the winner's row is not yet COMMITTED, so the
  -- loser's select sees nothing and v_used comes back NULL. Postgres's
  -- least() IGNORES nulls - least(47, null) is 47, not null - so the guard
  -- evaluated to greatest(0, least(p_want, null)) = p_want, the caller was
  -- granted everything it asked for, and the UPDATE beneath it matched zero
  -- rows and recorded none of it. A cap that hands out unlimited budget on
  -- exactly the transition it is most likely to be raced on.
  --
  -- DO UPDATE takes the row lock and RETURNING hands back the committed value,
  -- so the loser blocks until the winner commits and then reads the truth.
  -- The SET is a deliberate no-op: it exists to make this an UPDATE.
  insert into public.moderation_spend (day, calls)
  values (v_day, 0)
  on conflict (day) do update set updated_at = public.moderation_spend.updated_at
  returning calls into v_used;

  -- Belt and braces. If v_used is ever null again, refuse rather than grant:
  -- this function's whole job is to be able to say no.
  if v_used is null then
    raise exception 'moderation_spend has no row for %', v_day
      using errcode = 'internal_error';
  end if;

  v_grant := greatest(0, least(p_want, v_cap - v_used));

  if v_grant > 0 then
    update public.moderation_spend
    set calls = calls + v_grant, updated_at = now()
    where day = v_day;
  end if;

  return jsonb_build_object('granted', v_grant, 'day', v_day);
end
$$;

revoke execute on function public.claim_moderation_budget(int)
  from public, anon, authenticated;

comment on function public.claim_moderation_budget(int) is
  'Reserve up to p_want model calls against a day''s ceiling. Returns '
  '{"granted": n, "day": "YYYY-MM-DD"} - hand BOTH back to '
  'release_moderation_budget so an unspent claim is refunded to the day it '
  'was charged to. Claim BEFORE the call.';

-- 5. Release. Hands back an unspent claim, to the day it was charged to.
create or replace function public.release_moderation_budget(p_unused int, p_day date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, current_date);
begin
  perform public.assert_service_caller();

  if p_unused is null or p_unused <= 0 then
    return;
  end if;

  -- greatest(0, ...) so a double release can never drive the day negative and
  -- hand out budget that was already spent.
  update public.moderation_spend
  set calls = greatest(0, calls - p_unused), updated_at = now()
  where day = v_day;
end
$$;

revoke execute on function public.release_moderation_budget(int, date)
  from public, anon, authenticated;

-- 6. CHAT PHOTOS GET THE VELOCITY CAP PROFILE PHOTOS ALREADY HAVE.
--
-- 20260817150000 put a daily cap on profile-photo inserts with this reasoning,
-- which is worth quoting because it applies here word for word: "the 7-slot cap
-- bounds standing rows, not delete/re-insert churn -- and with photo moderation
-- on, every insert is an LLM classification, so churn is also a cost
-- amplifier."
--
-- A chat photo never got the same treatment. What bounds it today is
-- own_object_count('chat-photos') < 200, which is a STANDING cap on objects in
-- the bucket -- delete two hundred, upload two hundred more, and the storage
-- policy is satisfied every time while the moderation queue is not. The only
-- velocity bound is throttle_messages' 30 a minute, which is 43,200 photo
-- messages a day from one account: more, on its own, than the whole pipeline's
-- daily ceiling.
--
-- 120 a day. A person sharing pictures in a conversation does not approach it;
-- a script pointed at the classifier hits it in four minutes.
create index if not exists messages_sender_photo_recent_idx
  on public.messages (sender_id, created_at desc)
  where image_path is not null;

create or replace function public.throttle_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id
        and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'sending too fast, give it a moment'
      using errcode = 'check_violation', hint = 'message_throttle';
  end if;

  -- Photo messages only: each one is a model call when photo moderation is on.
  if new.image_path is not null
     and (select count(*) from public.messages
          where sender_id = new.sender_id
            and image_path is not null
            and created_at > now() - interval '24 hours') >= 120 then
    raise exception 'daily photo limit reached'
      using errcode = 'check_violation', hint = 'chat_photo_daily_cap';
  end if;

  return new;
end
$$;

-- 7. Make the spend visible where somebody already looks when the pipeline is
--    misbehaving. Same OUT columns, so create or replace is safe here.
create or replace function public.worker_status()
returns table (check_name text, result text)
language plpgsql
security definer
set search_path = public, extensions, net, vault, cron
as $$
begin
  begin
    return query
      select 'vault: ' || s.name,
             'present, length ' || length(s.decrypted_secret)::text
      from vault.decrypted_secrets s
      where s.name in ('project_url', 'service_role_key');
  exception when others then
    return query select 'vault'::text, 'UNREADABLE - ' || sqlstate || ': ' || sqlerrm;
  end;

  begin
    return query
      select 'cron job: ' || j.jobname, 'active=' || j.active::text || ' schedule=' || j.schedule
      from cron.job j
      where j.jobname in ('moderation-worker', 'push-worker');
  exception when others then
    return query select 'cron'::text, 'UNREADABLE - ' || sqlerrm;
  end;

  begin
    return query
      select 'last invoke: ' || l.worker,
             l.last_outcome || coalesce(' - ' || l.last_detail, '')
               || ' @ ' || to_char(l.last_attempt_at, 'HH24:MI:SS')
      from public.worker_invoke_log l;
  exception when others then
    return query select 'invoke log'::text, 'UNREADABLE - ' || sqlerrm;
  end;

  -- The spend row, so "why is nothing being classified" and "have we run out
  -- of budget" are the same question asked once.
  begin
    return query
      select 'moderation spend today'::text,
             coalesce((select s.calls from public.moderation_spend s
                       where s.day = current_date), 0)::text
               || ' / ' || public.config_int('moderation_daily_call_cap', 2000)::text
               || ' claimed'
               || case when public.config_flag('moderation_paused')
                       then ' - PAUSED' else '' end;
  exception when others then
    return query select 'moderation spend'::text, 'UNREADABLE - ' || sqlerrm;
  end;

  begin
    return query
      select 'last http response',
             r.status_code::text || coalesce(' - ' || r.error_msg, '')
               || ' @ ' || to_char(r.created, 'HH24:MI:SS')
      from net._http_response r
      order by r.created desc
      limit 3;
  exception when others then
    return query select 'http response'::text, 'UNREADABLE - ' || sqlerrm;
  end;
end
$$;

revoke all on function public.worker_status() from public, anon, authenticated;

notify pgrst, 'reload schema';
