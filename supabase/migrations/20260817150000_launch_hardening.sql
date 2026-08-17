-- Phase 6: launch hardening.
--
--   * Volume caps on every hot client-reachable write path. The Phase 2-5
--     caps bound STANDING state (5 active trips, 10 live pins, 7 photos,
--     one request per pair); these bound VELOCITY, so a single hostile
--     account can't flood chats, fan out request spam, wear out the report
--     queue, or rack up storage/push costs. All caps are enforced in
--     triggers/RPCs (not the client) and sized far above any honest usage.
--   * Push-token hygiene: at most 5 device tokens per account.
--   * Storage-object caps: bucket uploads were previously unbounded when no
--     DB row was created alongside them.
--   * Admin metrics views (service-role only): the "simple admin query set"
--     from brief §6, computable from the DB. App-usage metrics (map DAU,
--     D1/D7 in trip window) live in PostHog — see docs/DASHBOARD.md.
--
-- Account deletion (App Review 5.1.1(v)) is an Edge Function
-- (supabase/functions/delete-account) because it must remove storage objects
-- and the auth user via the admin API; the FK graph does the rest. The
-- cascade behavior is proven in 09_launch_hardening.test.sql.

-- Velocity caps ------------------------------------------------------------------

-- Chat messages: 30 per rolling minute per sender across all chats. An
-- excited human tops out far below this; a flood script does not.
create index messages_sender_recent_idx on public.messages (sender_id, created_at desc);

create function public.throttle_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id
        and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'sending too fast — wait a moment' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger messages_throttle
  before insert on public.messages
  for each row execute function public.throttle_messages();

-- Message requests: 30 attempts per rolling day per sender. Counted from
-- moderation_events (every attempt is logged there, including blocked and
-- suppressed ones, and rows survive the blocked-row replacement delete).
create index moderation_events_subject_recent_idx
  on public.moderation_events (subject_user_id, entity_type, created_at desc);

-- Reports: 10 per rolling day per reporter.
create function public.throttle_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports
      where reporter_id = new.reporter_id
        and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'daily report limit reached' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger reports_throttle
  before insert on public.reports
  for each row execute function public.throttle_reports();

-- Trips: the 5-ACTIVE cap doesn't stop cancel/recreate churn writing
-- unbounded rows. 20 inserts per rolling day is generous for a human.
create function public.throttle_trips()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.trips
      where user_id = new.user_id
        and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'daily trip limit reached' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger trips_throttle
  before insert on public.trips
  for each row execute function public.throttle_trips();

-- Pins: same churn argument (delete + recreate cycles under the 10-live cap
-- would otherwise let one account repaint heat cells all day).
create function public.throttle_pins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.seeded and (select count(*) from public.pins
      where user_id = new.user_id
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily pin limit reached' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger pins_throttle
  before insert on public.pins
  for each row execute function public.throttle_pins();

-- Photos: the 7-slot cap bounds standing rows, not delete/re-insert churn —
-- and with photo moderation on, every insert is an LLM classification, so
-- churn is also a cost amplifier.
create function public.throttle_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.moderation_events
      where subject_user_id = new.user_id
        and entity_type = 'profile_photo'
        and created_at > now() - interval '24 hours') >= 25 then
    raise exception 'daily photo upload limit reached' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger profile_photos_throttle
  before insert on public.profile_photos
  for each row execute function public.throttle_photos();

-- Blocks: a safety action, so the cap is generous — but each block fires the
-- join-heavy sever trigger, and block/unblock cycling shouldn't be a free
-- way to hammer it.
create function public.throttle_blocks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.moderation_events
      where subject_user_id = new.blocker_id
        and entity_type = 'block' and action = 'created'
        and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'daily block limit reached' using errcode = 'check_violation';
  end if;
  -- Counted via the audit spine because unblocking deletes the blocks row.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source)
  values (new.blocker_id, 'block', null, 'created', 'rate-limit');
  return new;
end
$$;

create trigger blocks_throttle
  before insert on public.blocks
  for each row execute function public.throttle_blocks();

-- Profile text: display_name and bio are broadcast to every overlapping
-- traveler but previously passed through no moderation at all. The regex
-- pre-filter catches the obvious cases at write time (same blocklist as
-- first messages); update velocity is capped alongside it.
create function public.screen_profile_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verdict jsonb;
begin
  if (select count(*) from public.moderation_events
      where subject_user_id = new.user_id
        and entity_type = 'profile' and action = 'updated'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily profile update limit reached' using errcode = 'check_violation';
  end if;
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source)
  values (new.user_id, 'profile', new.user_id, 'updated', 'rate-limit');

  if new.display_name is distinct from old.display_name
     or new.bio is distinct from old.bio then
    v_verdict := public.screen_first_message(
      coalesce(new.display_name, '') || ' ' || coalesce(new.bio, ''));
    if v_verdict ->> 'action' = 'block' then
      -- No audit row here: the raise aborts this transaction, so an insert
      -- could never persist. The enforcement is the rejection itself — the
      -- text never goes public. (LLM-grade bio review stays a flagged
      -- follow-up in ARCHITECTURE.)
      raise exception 'that text breaks our community guidelines'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create trigger profiles_screen_text
  before update on public.profiles
  for each row execute function public.screen_profile_text();

revoke execute on function
  public.throttle_messages(),
  public.throttle_reports(),
  public.throttle_trips(),
  public.throttle_pins(),
  public.throttle_photos(),
  public.throttle_blocks(),
  public.screen_profile_text()
from public, anon, authenticated;

-- send_message_request gains the daily attempt cap (replace; body otherwise
-- identical to the Phase 5 version).
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
  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily request limit reached' using errcode = 'check_violation';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  -- ORACLE-PROOF ERRORS: every relationship failure — blocked pair, banned/
  -- shadowbanned recipient, no overlap, no live pin — raises the SAME
  -- message. Distinct messages would let a sender with a known overlap
  -- probe whether someone blocked them (found by the Phase 6 audit).
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
      raise exception 'recipient unavailable';
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
      raise exception 'recipient unavailable';
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

-- Push tokens: at most 5 devices per account — registering a 6th silently
-- prunes the stalest (register_push_token is the only insert path).
create or replace function public.register_push_token(p_token text, p_platform text default 'ios')
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
  delete from public.push_tokens
  where user_id = auth.uid()
    and token not in (
      select token from public.push_tokens
      where user_id = auth.uid()
      order by updated_at desc
      limit 5
    );
end
$$;

-- Storage-object caps ------------------------------------------------------------
-- Bucket uploads previously had no ceiling when no DB row was created
-- alongside the object. Caller-scoped definer counter (the verification
-- bucket has no client SELECT policy, so a plain subquery would count 0).

-- VOLATILE on purpose: a STABLE function would use the statement-start
-- snapshot, letting one multi-row INSERT sail past the cap with every row
-- seeing the same pre-statement count.
create function public.own_object_count(p_bucket text)
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from storage.objects
  where bucket_id = p_bucket
    and split_part(name, '/', 1) = auth.uid()::text
$$;

revoke execute on function public.own_object_count(text) from public, anon;

drop policy profile_photos_storage_insert_own on storage.objects;
create policy profile_photos_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.own_object_count('profile-photos') < 30
  );

drop policy verification_selfies_insert_own on storage.objects;
create policy verification_selfies_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.own_object_count('verification-selfies') < 10
  );

-- Admin metrics views (brief §6 — the DB-computable slice) -----------------------
-- Service-role only, like admin_report_queue. PostHog covers the app-usage
-- metrics; docs/DASHBOARD.md maps each §6 metric to its source.

-- The liquidity number: per launch city, distinct users with a live pin or
-- an active trip whose window is current or upcoming.
create view public.admin_liquidity as
select
  c.name as city,
  lc.city_id,
  lc.active as city_open,
  (select count(distinct p.user_id) from public.pins p
    where p.city_id = lc.city_id and p.user_id is not null
      and p.expires_at > now()) as users_with_live_pin,
  (select count(distinct t.user_id) from public.trips t
    where t.city_id = lc.city_id and t.status = 'active'
      and t.end_date >= current_date) as users_with_active_trip,
  (select count(*) from (
    select p.user_id from public.pins p
      where p.city_id = lc.city_id and p.user_id is not null
        and p.expires_at > now()
    union
    select t.user_id from public.trips t
      where t.city_id = lc.city_id and t.status = 'active'
        and t.end_date >= current_date
  ) liquid) as liquidity
from public.launch_cities lc
join public.cities c on c.id = lc.city_id;

-- Marketplace health: request → accept rate, last 30 days.
create view public.admin_request_funnel as
select
  count(*) filter (where status <> 'blocked_by_moderation') as delivered_or_pending,
  count(*) filter (where status = 'accepted') as accepted,
  count(*) filter (where status = 'blocked_by_moderation') as currently_blocked,
  round(100.0 * count(*) filter (where status = 'accepted')
    / greatest(count(*) filter (where status <> 'blocked_by_moderation'), 1), 1)
    as accept_rate_pct
from public.message_requests
where created_at > now() - interval '30 days';

-- Creep early-warning: % of first-message attempts blocked, last 30 days.
create view public.admin_moderation_stats as
select
  count(*) as attempts,
  count(*) filter (where action in ('blocked', 'llm_blocked')) as blocked,
  count(*) filter (where action = 'blocked') as blocked_prefilter,
  count(*) filter (where action = 'llm_blocked') as blocked_llm,
  round(100.0 * count(*) filter (where action in ('blocked', 'llm_blocked'))
    / greatest(count(*), 1), 1) as blocked_pct
from public.moderation_events
where entity_type = 'message_request'
  and action in ('blocked', 'llm_blocked', 'stub_approved', 'llm_approved',
                 'queued_for_llm', 'shadowban_suppressed')
  and created_at > now() - interval '30 days';

-- Ops health: queue depths + oldest ages. If oldest_held_message_minutes
-- climbs past ~10, the moderation-worker schedule is broken (held messages
-- fail closed — nothing delivers unscreened — but users are waiting).
-- Same logic for push_queue and the push-worker.
create view public.admin_ops_health as
select
  (select count(*) from public.message_requests where status = 'pending_moderation')
    as held_messages,
  (select round(extract(epoch from now() - min(created_at)) / 60)
     from public.message_requests where status = 'pending_moderation')
    as oldest_held_message_minutes,
  (select count(*) from public.profile_photos where moderation_status = 'pending')
    as pending_photos,
  (select count(*) from public.verification_requests where status = 'pending')
    as pending_verifications,
  (select count(*) from public.push_queue where sent_at is null)
    as unsent_pushes,
  (select round(extract(epoch from now() - min(created_at)) / 60)
     from public.push_queue where sent_at is null)
    as oldest_unsent_push_minutes,
  (select count(*) from public.pins where expires_at <= now())
    as expired_pins_awaiting_sweep;

revoke all on public.admin_ops_health from anon, authenticated;

-- Pin supply: live inventory per launch city. (True creation RATE comes from
-- the PostHog pin_created event — expired pins hard-delete within 15 minutes
-- of expiry (rule 3), so this table can't see history by design.)
create view public.admin_pin_stats as
select
  c.name as city,
  lc.city_id,
  count(p.id) filter (where p.expires_at > now()) as live_pins,
  count(p.id) filter (where p.expires_at > now() and p.seeded) as live_seeded_pins
from public.launch_cities lc
join public.cities c on c.id = lc.city_id
left join public.pins p on p.city_id = lc.city_id
group by c.name, lc.city_id;

revoke all on public.admin_liquidity, public.admin_request_funnel,
  public.admin_moderation_stats, public.admin_pin_stats
from anon, authenticated;
