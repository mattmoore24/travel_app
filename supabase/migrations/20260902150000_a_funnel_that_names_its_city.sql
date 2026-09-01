-- ACCEPT RATE, ANSWERABLE BY SOURCE, BY CITY, AND BY WHAT ACTUALLY HAPPENED
--
-- `admin_request_funnel` (20260817150000:458) answers one question with one
-- global number, and three decisions need it split three ways:
--
--   BY SOURCE. Is a hello that started on the map accepted less than one from
--   Travelers? That is the map-led thesis, and today nothing can test it.
--
--   BY CITY. Creep is local. One bad cohort in one launch city is diluted
--   across every other, so the number falls slowly and names nobody.
--
--   BY WHAT HAPPENED. The view folds pending, ignored and declined into one
--   denominator, so a push outage, a slow responder, and somebody who never
--   saw the hello all produce the same falling rate with the same shape.
--
-- `source` is already a column (20260816200000:378) and `responded_at`
-- already exists (:392). Only city_id is new.
--
-- WHY THE CLIENT CANNOT SUPPLY THE CITY. platform-request-funnel-db shipped
-- two optional params on useRespondToRequest that nothing passes and nothing
-- could: `incoming_requests()` never returned a city, so the client had none
-- to send, and a client-supplied one would be a claim rather than a fact
-- anyway. It is written HERE, by the function that already proves the two
-- travelers overlap, from the same predicate that authorises the hello.

-- THE DROP GOES FIRST, ABOVE THE ALTER.
--
-- A view has the restriction a RETURNS TABLE function does: create or replace
-- cannot change the column list, and this rewrite changes it entirely.
-- Postgres refuses AFTER earlier statements in the file have applied, so with
-- the drop anywhere below this line a failed run leaves the column added and
-- the view stale. Nothing above this can fail.
drop view if exists public.admin_request_funnel;

alter table public.message_requests
  add column if not exists city_id int references public.cities (id);

-- Nullable and staying that way: every row written before this has no city,
-- and the view buckets those as 'unknown' rather than dropping them, because
-- a denominator that silently loses its history is worse than one with an
-- honest unknown in it.
comment on column public.message_requests.city_id is
  'Which city the hello belongs to, written by send_message_request from the '
  'same predicate that authorised it. Null on rows written before '
  '20260902150000 and on any hello whose city could not be established; '
  'admin_request_funnel buckets those as unknown.';

-- No grant for it. message_requests carries COLUMN-level grants
-- (20260816200000:412) precisely so a `select *` cannot leak
-- moderation_verdict, and this column is for the admin view alone. Granting
-- it would put the city of every hello in reach of a client that has no use
-- for it.

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
  v_city int;
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

  -- The two source branches now SELECT the city they were already proving
  -- exists, rather than asking `exists`. The predicates are unchanged, so the
  -- authorisation is identical, and a null answer folds into the SAME
  -- oracle-proof 'recipient unavailable' with the SAME hint the exists-check
  -- raised - no branch can leak a new fact about who is out there.
  if p_source = 'trip_match' then
    select mine.city_id into v_city
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
    -- Deterministic when two travelers overlap in more than one city: the one
    -- they are in soonest is the one the hello is about.
    order by greatest(mine.start_date, theirs.start_date), mine.city_id
    limit 1;
    if v_city is null then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  elsif p_source = 'pin' then
    select p.city_id into v_city
    from public.pins p
    join public.launch_cities lc on lc.city_id = p.city_id and lc.active
    where p.user_id = p_recipient and p.expires_at > now()
    -- The pin with longest left is the one somebody is answering.
    order by p.expires_at desc, p.city_id
    limit 1;
    if v_city is null then
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
       moderation_verdict, status, city_id)
    values
      (v_sender, p_recipient, p_source, p_profile_element, p_first_message,
       v_verdict, v_status, v_city)
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


-- THE FOUR-WAY DENOMINATOR.
--
-- `accepted`, `declined` and `expired_unanswered` are what happened.
-- `still_pending` is what has not happened YET and is deliberately kept out
-- of the rate: a hello sent an hour ago is not a refusal, and counting it as
-- one is how a healthy day reads as a collapsing one every evening.
--
-- Seven days is the line between "still deciding" and "never going to". It
-- is longer than the notification retry window and shorter than a trip.
create view public.admin_request_funnel as
select
  coalesce(c.name, 'unknown') as city,
  r.source::text as source,
  count(*) filter (where r.status <> 'blocked_by_moderation') as delivered,
  count(*) filter (where r.status = 'accepted') as accepted,
  count(*) filter (where r.status = 'declined') as declined,
  count(*) filter (
    where r.status in ('pending', 'pending_moderation')
      and r.created_at > now() - interval '7 days') as still_pending,
  count(*) filter (
    where r.status in ('pending', 'pending_moderation')
      and r.created_at <= now() - interval '7 days') as expired_unanswered,
  count(*) filter (where r.status = 'blocked_by_moderation') as currently_blocked,
  -- The rate over DECIDED hellos only, for the reason above.
  round(100.0 * count(*) filter (where r.status = 'accepted')
    / greatest(count(*) filter (
        where r.status = 'accepted'
           or r.status = 'declined'
           or (r.status in ('pending', 'pending_moderation')
               and r.created_at <= now() - interval '7 days')), 1), 1)
    as accept_rate_pct,
  -- How long a yes or a no actually takes, which is what separates "nobody
  -- is interested" from "nobody got the push".
  round(extract(epoch from percentile_cont(0.5) within group (
    order by r.responded_at - r.created_at)) / 3600.0, 1)
    as median_hours_to_respond
from public.message_requests r
left join public.cities c on c.id = r.city_id
where r.created_at > now() - interval '30 days'
group by coalesce(c.name, 'unknown'), r.source;

-- Re-stated after the drop, verbatim from 20260817150000:523. A view
-- recreated without its revoke is readable by every signed-in client, and
-- this one is the whole hello graph by city.
revoke all on public.admin_liquidity, public.admin_request_funnel,
  public.admin_moderation_stats, public.admin_pin_stats
from anon, authenticated;
