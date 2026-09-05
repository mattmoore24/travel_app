-- A reword is not a strike, and a strike does not last forever
-- ---------------------------------------------------------------------------
--
-- Two defects, one cause: the prefilter's guess was being counted as evidence.
--
-- 1. Every prefilter block wrote a moderation_event with action 'blocked',
--    is_strike_action counts 'blocked', and the ladder is three to a warning,
--    five to a seven-day pause, seven to a closed account. So three attempts
--    that all keep the same unlucky phrase is a warning and seven is a ban,
--    for trying to arrange a beer at the night market - while the composer's
--    own copy invites exactly those attempts ("Reword it and send again").
--    apply_message_verdict already draws this distinction on the LLM side:
--    'blocked_failsafe' is excluded from the ladder because the sender did
--    nothing wrong (20260830030000, following 20260820001000:180-183). A
--    regex guess deserves the same treatment for the same reason, so the
--    prefilter branch now logs 'prefilter_blocked', which is simply not in
--    is_strike_action's list. That list is left untouched: not being on it
--    IS the mechanism.
--
-- 2. apply_strike_policy counted with no time window at all, so an account
--    could be closed in month eighteen for four bad nights spread over two
--    years. The count is now a ninety-day rolling window. Founder decision,
--    2026-09-01, overturning the "strikes never expire in v1" line in
--    docs/ARCHITECTURE.md, which was written before the prefilter's
--    false-positive rate was known; ARCHITECTURE.md is updated in the same
--    change so the record matches the code.
--
-- Order matters. The two view replacements go FIRST: `create or replace view`
-- refuses outright if a column name, type or position moved, and a failure
-- there must leave nothing half-applied behind it. The function reissue and
-- the backfill follow, in one transaction, so the ladder never reads a table
-- where half the prefilter blocks are renamed and half are not.

-- ---------------------------------------------------------------------------
-- 1. The triage queue counts strikes the way the ladder counts them
-- ---------------------------------------------------------------------------
--
-- Body restated whole from 20260901200000:72, with the ninety-day predicate
-- on reported_user_strikes. A reviewer reading "6 strikes" next to an active
-- account, because five of them aged out, is a queue that lies about its own
-- ladder. Column names, types and order are unchanged, so replace is legal.

create or replace view public.admin_report_queue as
select
  r.id,
  r.created_at,
  r.reason,
  r.details,
  r.context,
  r.reporter_id,
  r.reported_user_id,
  r.reported_chat_id,
  coalesce(
    (select g.name from public.groups g where g.chat_id = r.reported_chat_id),
    (select b.name from public.businesses b where b.chat_id = r.reported_chat_id)
  ) as reported_chat_name,
  u.status as reported_user_status,
  (select count(*) from public.moderation_events e
    where e.subject_user_id = r.reported_user_id
      and public.is_strike_action(e.action)
      and e.created_at > now() - interval '90 days') as reported_user_strikes,
  (select count(*) from public.reports r2
    where r2.reported_user_id = r.reported_user_id) as total_reports_against
from public.reports r
left join public.users u on u.id = r.reported_user_id
where r.status = 'open'
order by (r.reason::text in ('underage', 'immediate_danger')) desc, r.created_at;

-- `create or replace view` keeps the old privileges, but re-stating them is
-- the habit that survives someone turning this into a drop-and-create later.
revoke all on public.admin_report_queue from anon, authenticated;

comment on view public.admin_report_queue is
  'Open reports for a human reviewer, urgent claims first (D34: priority, '
  'never automatic suppression). A report may name a chat instead of a person, '
  'so the user join is outer. Strike count is the same ninety-day window the '
  'ladder uses. Service role only.';

-- ---------------------------------------------------------------------------
-- 2. The creep metric keeps counting prefilter blocks under their new name
-- ---------------------------------------------------------------------------
--
-- Without this the rename below silently zeroes blocked_prefilter and drops
-- every prefilter block out of both the numerator and the denominator, so the
-- brief's creep early-warning (§6) would read as a safety improvement on the
-- day a rename shipped. Body restated from 20260817150000:470.

create or replace view public.admin_moderation_stats as
select
  count(*) as attempts,
  count(*) filter (where action in ('blocked', 'prefilter_blocked', 'llm_blocked'))
    as blocked,
  count(*) filter (where action in ('blocked', 'prefilter_blocked'))
    as blocked_prefilter,
  count(*) filter (where action = 'llm_blocked') as blocked_llm,
  round(100.0 * count(*) filter
      (where action in ('blocked', 'prefilter_blocked', 'llm_blocked'))
    / greatest(count(*), 1), 1) as blocked_pct
from public.moderation_events
where entity_type = 'message_request'
  and action in ('blocked', 'prefilter_blocked', 'llm_blocked', 'stub_approved',
                 'llm_approved', 'queued_for_llm', 'shadowban_suppressed')
  and created_at > now() - interval '30 days';

revoke all on public.admin_moderation_stats from anon, authenticated;

comment on view public.admin_moderation_stats is
  'Creep early-warning over 30 days. blocked_pct is a LAGGING and '
  'deliberately suppressed number: the composer warns about a risky draft '
  'before anybody presses send, which removes events from this numerator on '
  'purpose. Read it beside the draft_flagged analytics event, per '
  'docs/DASHBOARD.md. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. The ladder counts ninety days
-- ---------------------------------------------------------------------------
--
-- Restated whole from 20260901130000:36; the window on the count is the only
-- change. Trigger-returning, so create or replace is correct and there is no
-- OUT-column hazard here.

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

  -- NINETY DAYS, not for ever. A lifetime counter closes an account in month
  -- eighteen for four bad nights spread over two years, and the ladder's
  -- three/five/seven rungs were chosen before anybody knew how often the
  -- prefilter is wrong. The window is rolling and deliberately long enough
  -- that a run of real breaches inside one trip still reaches every rung.
  select count(*) into v_count
  from public.moderation_events
  where subject_user_id = new.subject_user_id
    and public.is_strike_action(action)
    and created_at > now() - interval '90 days';

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
    values (new.subject_user_id, 'Account closed',
            'Your account is closed for repeated house rules breaches. Our checks are automatic, so if that is wrong, open the app and tap Appeal this.',
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
    values (new.subject_user_id, 'Account paused',
            'Your account is paused for 7 days for repeated house rules breaches. Our checks are automatic, so if that is wrong, open the app and tap Appeal this.',
            jsonb_build_object('type', 'moderation'));
  elsif v_count >= 3 and not exists (
    select 1 from public.moderation_events
    where subject_user_id = new.subject_user_id and action = 'warning_issued'
      -- The SAME window the count above uses, and it only matters now that
      -- the count decays. Under the old lifetime counter a total that reached
      -- three could never fall back below it, so a person was warned once and
      -- then climbed; with a ninety-day window the ladder genuinely resets,
      -- and a latch that looked over all time would let a second cycle run
      -- from three straight to a seven-day pause with no warning at all. The
      -- rung and the count have to read the same clock.
      and created_at > now() - interval '90 days'
  ) then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'warning_issued', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'House rules warning',
            'Recent messages or photos broke our house rules, on an automatic check. More of it will pause your account.',
            jsonb_build_object('type', 'moderation'));
  end if;
  return new;
end
$$;

revoke execute on function public.apply_strike_policy() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The prefilter branch logs its own action
-- ---------------------------------------------------------------------------
--
-- Restated whole from 20260831140000:333 (live body). The single change is the
-- audit action on the blocked branch: 'blocked' becomes 'prefilter_blocked'.
-- The four raise literals carrying the word the design brief bans are reissued
-- byte for byte and re-listed in .copy-lint-allow, exactly as 20260830110000
-- and 20260831140000 did; rewording them is a separate package's job.

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
  v_cap int;
  v_sent_today int;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'not_authenticated';
  end if;
  perform public.assert_good_standing();

  -- THE DAILY CAP.
  --
  -- Checked before anything about the recipient, on purpose: the answer is
  -- then identical whoever you aimed at, so a capped sender learns nothing
  -- about who exists, who blocked them, or who is discoverable.
  --
  -- This returns rather than raising, because it is not an error - it is the
  -- app saying you have done enough for one day, and the composer says so
  -- warmly. And it is a SAFETY limit, never a tier: hard rule 1 says the core
  -- is free, so this must never be sold back as "more hellos per day".
  -- Serialised per sender, the way every other counted cap in this schema
  -- is (trips, pins, photos, strikes, verification, group creation). Without
  -- it the count below and the insert 70 lines down are a read-then-write
  -- across two statements, and twenty parallel hellos to twenty different
  -- travelers all read 0 and all commit: the unique (sender_id, recipient_id)
  -- constraint does not help, because they aim at different people. The lock
  -- is taken before the count so the count cannot be stale by the time it is
  -- acted on, and released with the transaction.
  perform pg_advisory_xact_lock(hashtext('first_messages:' || v_sender::text));
  select coalesce(
    (select (value #>> '{}')::int from public.app_config
      where key = 'first_messages_per_day'), 8)
  into v_cap;
  select count(*)::int into v_sent_today
  from public.message_requests
  where sender_id = v_sender and created_at >= date_trunc('day', now());
  if v_sent_today >= v_cap then
    -- Same KEYS as every other return from this function, so the client's
    -- one result type is true on every branch. It used to omit request_id
    -- and used, which typed as present and arrived undefined on exactly the
    -- branch where the composer wants to say "8 of 8".
    return jsonb_build_object(
      'request_id', null, 'delivered', false, 'queued', false, 'blocked', false,
      'capped', true, 'allowed', v_cap, 'used', v_sent_today,
      'category', null);
  end if;

  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily request limit reached'
      using errcode = 'check_violation', hint = 'hello_daily_cap';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  -- ORACLE-PROOF ERRORS: every relationship failure raises the SAME message
  -- and the SAME hint.
  if not public.is_discoverable_owner(p_recipient)
     or public.is_blocked_pair(p_recipient) then
    raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
  end if;
  if public.has_accepted_chat(p_recipient) then
    raise exception 'already connected with this traveler' using hint = 'already_connected';
  end if;

  if p_source = 'trip_match' then
    if not exists (
      select 1
      from public.trips mine
      join public.trips theirs
        on theirs.city_id = mine.city_id
       and theirs.start_date <= mine.end_date
       and mine.start_date <= theirs.end_date
       and theirs.end_date >= current_date - 1
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date - 1
        and greatest(mine.start_date, theirs.start_date) <= current_date + 180
    ) then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  elsif p_source = 'pin' then
    if not exists (
      select 1
      from public.pins p
      join public.launch_cities lc on lc.city_id = p.city_id and lc.active
      where p.user_id = p_recipient and p.expires_at > now()
    ) then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  else
    raise exception 'unknown request source';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  v_status := case
    when v_verdict ->> 'action' = 'block' then 'blocked_by_moderation'::public.request_status
    when public.config_flag('require_llm_moderation') then 'pending_moderation'::public.request_status
    else 'pending'::public.request_status
  end;

  v_masked := v_status;
  select status = 'shadowbanned' into v_shadowbanned
  from public.users where id = v_sender;
  if v_shadowbanned and v_status in ('pending', 'pending_moderation') then
    v_status := 'declined';
  end if;

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
    raise exception 'request already sent to this traveler'
      using hint = 'hello_already_sent';
  end;

  -- 'prefilter_blocked', NOT 'blocked'. The regex said maybe; nobody read the
  -- sentence; the app then told the writer to reword it and send again. That
  -- is not evidence of anything, so it is audited (the creep metric needs it)
  -- and kept off is_strike_action's list.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_sender, 'message_request', v_id,
     case
       when v_status = 'blocked_by_moderation' then 'prefilter_blocked'
       when v_status = 'declined' then 'shadowban_suppressed'
       when v_status = 'pending_moderation' then 'queued_for_llm'
       else 'stub_approved'
     end,
     'prefilter-v1', v_verdict);

  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_masked = 'pending',
    'queued', v_masked = 'pending_moderation',
    'blocked', v_masked = 'blocked_by_moderation',
    'capped', false,
    'allowed', v_cap,
    'used', v_sent_today + 1,
    'category', case when v_masked = 'blocked_by_moderation'
                     then v_verdict ->> 'category' else null end);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. The backfill, in the same transaction as the rename
-- ---------------------------------------------------------------------------
--
-- moderation_events.action is free text with no check constraint
-- (20260816190000:93), so there is no enum to widen. Scoped to the prefilter's
-- own source so an LLM block or a photo rejection cannot be caught by it.
-- The strike trigger is AFTER INSERT, so an update cannot re-run the ladder.

update public.moderation_events
   set action = 'prefilter_blocked'
 where entity_type = 'message_request'
   and action = 'blocked'
   and source = 'prefilter-v1';
