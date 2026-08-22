-- Four holes found by an adversarial review of the audit build
-- ===========================================================================
--
-- Every one of these is a case where a guard exists somewhere in the schema
-- and the new code walked around it.
--
--   1. daily_spotlight() is SECURITY DEFINER and calls get_matches(), which
--      is SECURITY INVOKER and does none of its own filtering — every check
--      that matters lives in the trips_select_overlap POLICY. Running it as
--      the owner therefore skipped all of them, and handed a blocked
--      person's name, age, bio, occupation, languages and photo to the
--      person they blocked. Rule 3 of the brief, breached by a missing
--      clause.
--   2. The two unique indexes on daily_spotlights cannot express "one
--      spotlight per person per day": a user may be user_a in one row and
--      user_b in another, so the unique_violation the function catches is
--      never raised and two people can both be paired with the same third.
--   3. The daily first-message cap counts and then inserts with nothing in
--      between, while every other counted cap in this schema takes a
--      per-user advisory lock first.
--   4. pin_message counts live pins without asking whether their MESSAGE is
--      still alive, so unsending a pinned message leaves a slot held by a
--      pin that nothing renders and nothing can unpin.
--
-- ---------------------------------------------------------------------------
-- 1 and 2. The spotlight
-- ---------------------------------------------------------------------------

-- The old comment claimed these enforce one spotlight per person per day.
-- They do not, and saying so was worse than saying nothing: it is why the
-- exception handler below was believed to close the race. What they DO
-- enforce is one row per person per SIDE of a pair, which is worth keeping;
-- the invariant itself is now held by the lock in daily_spotlight().
comment on index public.daily_spotlights_a_idx is
  'At most one row per person per day as the LOW side of a pair. Not the '
  'whole invariant: see the day lock in daily_spotlight().';
comment on index public.daily_spotlights_b_idx is
  'At most one row per person per day as the HIGH side of a pair. Not the '
  'whole invariant: see the day lock in daily_spotlight().';

create or replace function public.daily_spotlight()
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  occupation text,
  city_name text,
  overlap_start date,
  overlap_end date,
  photo_path text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Already paired today, from either side.
  select case when s.user_a = v_me then s.user_b else s.user_a end
  into v_other
  from public.daily_spotlights s
  where s.day = current_date and (s.user_a = v_me or s.user_b = v_me);

  if v_other is null then
    -- One lock for the day, held for the transaction. The pairing is a
    -- decision about TWO people, so a per-user lock is not enough: the race
    -- that actually happens is somebody else claiming my candidate, or
    -- claiming me, between my scan and my insert, and neither of us holds
    -- the other's lock at the time. Contention is one short transaction per
    -- person per day, and only on the day's first read.
    perform pg_advisory_xact_lock(hashtext('daily_spotlight:' || current_date::text));

    -- Re-read under the lock: somebody may have paired me while I queued.
    select case when s.user_a = v_me then s.user_b else s.user_a end
    into v_other
    from public.daily_spotlights s
    where s.day = current_date and (s.user_a = v_me or s.user_b = v_me);
  end if;

  if v_other is null then
    select m.user_id into v_other
    from public.get_matches() m
    join public.profiles p on p.user_id = m.user_id
    join public.profiles me on me.user_id = v_me
    where
      -- THE FILTERS get_matches() DOES NOT DO ITSELF.
      --
      -- get_matches is SECURITY INVOKER, so for every other caller the
      -- trips_select_overlap policy supplies these. This function is
      -- SECURITY DEFINER, so the policy does not run and every one of them
      -- has to be restated here. Without them the spotlight reached past
      -- blocks, suspensions, bans, shadowbans, cancelled trips and accounts
      -- that never finished onboarding.
      public.is_discoverable_owner(m.user_id)
      and not public.is_blocked_pair(m.user_id)
      and exists (
        select 1 from public.trips t
        where t.id = m.trip_id and t.status = 'active'
      )
      -- Never somebody already spoken for today, on either side.
      and not exists (
        select 1 from public.daily_spotlights s
        where s.day = current_date and (s.user_a = m.user_id or s.user_b = m.user_id)
      )
      -- Never somebody there is nothing left to start.
      and not public.has_accepted_chat(m.user_id)
      and not exists (
        select 1 from public.message_requests r
        where r.sender_id = v_me and r.recipient_id = m.user_id
      )
    order by
      public.spotlight_score(
        (m.overlap_end - m.overlap_start + 1)::int,
        (select count(*)::int from unnest(p.languages) l
          where l = any(me.languages)),
        p.verified and me.verified,
        (case when p.bio is not null then 4 else 0 end)
          + (case when me.bio is not null then 4 else 0 end)
          + (case when p.occupation is not null then 2 else 0 end)
          + (case when me.occupation is not null then 2 else 0 end)
      ) desc,
      -- Deterministic, and different every day, so a tie does not pin the
      -- same person to the top of the tab all week.
      md5(least(v_me::text, m.user_id::text) || greatest(v_me::text, m.user_id::text)
          || current_date::text)
    limit 1;

    if v_other is null then
      return;
    end if;

    -- Under the day lock this cannot collide, but the handler stays: a
    -- constraint is the only thing that can still say no, and swallowing
    -- that would turn a bug into a silent wrong answer.
    begin
      insert into public.daily_spotlights (day, user_a, user_b)
      values (current_date, least(v_me, v_other), greatest(v_me, v_other));
    exception when unique_violation then
      select case when s.user_a = v_me then s.user_b else s.user_a end
      into v_other
      from public.daily_spotlights s
      where s.day = current_date and (s.user_a = v_me or s.user_b = v_me);
      if v_other is null then
        return;
      end if;
    end;
  end if;

  -- Read back through get_matches so the row carries the same overlap the
  -- rest of the tab shows, and so a pairing whose trip has since been
  -- cancelled quietly returns nothing instead of a stale card.
  --
  -- Same restatement as above, for the same reason: yesterday's pairing is
  -- not a licence to show somebody who has since blocked you, been
  -- suspended, or cancelled the trip you shared.
  return query
  select
    m.user_id, m.display_name, m.age, m.verified, m.languages, m.bio,
    m.occupation, m.city_name, m.overlap_start, m.overlap_end, m.photo_path
  from public.get_matches() m
  where m.user_id = v_other
    and public.is_discoverable_owner(m.user_id)
    and not public.is_blocked_pair(m.user_id)
    and exists (
      select 1 from public.trips t
      where t.id = m.trip_id and t.status = 'active'
    )
  order by m.overlap_start
  limit 1;
end;
$$;

revoke execute on function public.daily_spotlight() from public, anon;
grant execute on function public.daily_spotlight() to authenticated;

comment on function public.daily_spotlight() is
  'Today''s mutual spotlight. SECURITY DEFINER, so it restates every filter '
  'the trips_select_overlap policy would otherwise apply to get_matches(), '
  'and takes a per-day advisory lock so a pairing cannot be raced.';

-- ---------------------------------------------------------------------------
-- 3. The daily first-message cap, serialised
-- ---------------------------------------------------------------------------

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
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  -- THE DAILY CAP.
  --
  -- Checked before anything about the recipient, on purpose: the answer is
  -- then identical whoever you aimed at, so a capped sender learns nothing
  -- about who exists, who blocked them, or who is discoverable.
  --
  -- This returns rather than raising, because it is not an error — it is the
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
      'capped', true, 'allowed', v_cap, 'used', v_sent_today);
  end if;

  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily request limit reached' using errcode = 'check_violation';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot send a request to yourself';
  end if;
  -- ORACLE-PROOF ERRORS: every relationship failure raises the SAME message.
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
       and theirs.end_date >= current_date - 1
      where mine.user_id = v_sender and mine.status = 'active'
        and theirs.user_id = p_recipient and theirs.status = 'active'
        and mine.end_date >= current_date - 1
        and greatest(mine.start_date, theirs.start_date) <= current_date + 180
    ) then
      raise exception 'recipient unavailable';
    end if;
  elsif p_source = 'pin' then
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

  return jsonb_build_object(
    'request_id', v_id,
    'delivered', v_masked = 'pending',
    'queued', v_masked = 'pending_moderation',
    'blocked', v_masked = 'blocked_by_moderation',
    'capped', false,
    'allowed', v_cap,
    'used', v_sent_today + 1);
end
$$;


-- ---------------------------------------------------------------------------
-- 4. A pin never outlives its message — including its slot
-- ---------------------------------------------------------------------------
--
-- room_pins() already refuses to return a pin whose message was unsent or
-- taken down, and there is an assertion holding that. pin_message counted
-- the TABLE, though, with no join to messages, so the dead pin went on
-- holding one of the three slots. And it could not be freed by hand: the
-- strip renders from room_pins, so there was no row to long-press, and
-- re-pinning the same message raises 'message not found'. A host who
-- unsent two of their own pins was left looking at an empty strip above
-- "Three is the limit. Unpin one first."

create or replace function public.pin_message(p_message_id uuid, p_hours int default 24)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat uuid;
  v_live int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select chat_id into v_chat from public.messages
  where id = p_message_id and removed_at is null and unsent_at is null;
  if v_chat is null then
    raise exception 'message not found';
  end if;
  if not public.is_room_moderator(v_chat) then
    raise exception 'only a host can pin';
  end if;

  -- Counted over pins that are BOTH unexpired and still attached to a live
  -- message, which is exactly what room_pins shows. The two predicates have
  -- to agree: a slot the strip cannot render is a slot nobody can free.
  select count(*)::int into v_live
  from public.pinned_messages pm
  join public.messages m on m.id = pm.message_id
  where pm.chat_id = v_chat
    and pm.expires_at > now()
    and m.removed_at is null
    and m.unsent_at is null
    and pm.message_id <> p_message_id;
  if v_live >= 3 then
    raise exception 'three pins is the limit';
  end if;

  insert into public.pinned_messages (chat_id, message_id, pinned_by, expires_at)
  values (
    v_chat,
    p_message_id,
    auth.uid(),
    now() + make_interval(hours => least(greatest(p_hours, 1), public.max_pin_hours()))
  )
  on conflict (chat_id, message_id) do update
    set expires_at = excluded.expires_at, pinned_by = excluded.pinned_by;
end;
$$;

revoke execute on function public.pin_message(uuid, int) from public, anon;
grant execute on function public.pin_message(uuid, int) to authenticated;

-- And sweep them, so the table does not accumulate rows for messages that
-- no longer exist. Hourly, alongside the expiry it already ran.
create or replace function public.expire_pinned_messages()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with gone as (
    delete from public.pinned_messages pm
    where pm.expires_at <= now()
       or exists (
         select 1 from public.messages m
         where m.id = pm.message_id
           and (m.removed_at is not null or m.unsent_at is not null)
       )
    returning 1
  )
  select count(*)::int from gone
$$;

revoke execute on function public.expire_pinned_messages() from public, anon, authenticated;
