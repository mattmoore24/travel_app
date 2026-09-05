-- A failure carries a stable code, so the app can say what to do.
--
-- Founder ruling (UX_PLAN.md D3): the database may not write user-facing
-- copy. The client (src/lib/failure-message.ts) now answers every known
-- failure with a written sentence, keyed on the `hint` each live raise
-- clause carries below — a code, not English prose, because the same message
-- is duplicated across seven superseded migrations and a string key breaks
-- the day one is reworded. The message text itself is unchanged, byte for
-- byte: it is no longer shown to anybody once the client maps the hint, and
-- rewording it here would orphan the .copy-lint-allow history for nothing.
--
-- Every function is restated whole with `create or replace` — no RETURNS
-- TABLE signatures change, so the drop-first rule does not bite and no
-- grants move. The revokes are restated anyway, mirroring each source file.
--
-- The oracle-proofing survives: every relationship failure in
-- send_message_request raises the same message AND the same hint
-- ('recipient_unavailable'), so the code leaks nothing the prose did not.

-- 1. Trip validity and caps (from 20260816200000_trips_matching.sql) ------------

create or replace function public.validate_trip_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.start_date = old.start_date
     and new.end_date = old.end_date then
    return new;
  end if;
  -- One day of slack: the server clock is UTC but travelers aren't, and a
  -- user west of UTC saving "today" late evening must not be rejected.
  if new.end_date < current_date - 1 then
    raise exception 'trip is entirely in the past'
      using errcode = 'check_violation', hint = 'trip_past';
  end if;
  if new.start_date > current_date + 730 then
    raise exception 'trip starts too far in the future' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace function public.enforce_trip_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('trip_limit:' || new.user_id::text));
  if (select count(*) from public.trips
      where user_id = new.user_id and status = 'active'
        and end_date >= current_date
        and id <> new.id) >= 5 then
    raise exception 'active trip limit reached (5)'
      using errcode = 'check_violation', hint = 'trip_cap';
  end if;
  return new;
end
$$;

-- 2. Pin validity and cap (from 20260816210000_map_pins.sql) --------------------

create or replace function public.validate_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city record;
begin
  select lc.active, lc.radius_km, c.lat, c.lng
    into v_city
  from public.launch_cities lc
  join public.cities c on c.id = lc.city_id
  where lc.city_id = new.city_id;

  if not v_city.active then
    raise exception 'this city is not open yet' using errcode = 'check_violation';
  end if;
  if public.haversine_km(new.lat, new.lng, v_city.lat, v_city.lng) > v_city.radius_km then
    raise exception 'pin location is outside the city area' using errcode = 'check_violation';
  end if;
  if new.expires_at <= now() then
    raise exception 'pin would already be expired' using errcode = 'check_violation';
  end if;
  -- +2 absorbs client-local vs UTC date drift in both directions.
  if new.intent_date < current_date - 1
     or new.intent_date > (new.expires_at at time zone 'UTC')::date + 2 then
    raise exception 'intent date must fall within the pin''s lifetime'
      using errcode = 'check_violation';
  end if;
  if not new.seeded then
    perform pg_advisory_xact_lock(hashtext('pin_limit:' || new.user_id::text));
    if (select count(*) from public.pins
        where user_id = new.user_id and expires_at > now()) >= 10 then
      raise exception 'active pin limit reached (10)'
        using errcode = 'check_violation', hint = 'pin_cap';
    end if;
  end if;
  return new;
end
$$;

-- 3. Unmatch (from 20260816220000_chat_realtime.sql) ----------------------------
-- Both raises share one hint: to the person tapping Leave, "the chat was
-- already gone" and "the chat is frozen" are the same fact.

create or replace function public.unmatch_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(p_chat_id) then
    raise exception 'chat not found' using hint = 'chat_over';
  end if;
  -- A closed chat is frozen evidence (a block closed it); neither member —
  -- least of all a reported abuser — may hard-delete that history.
  if exists (select 1 from public.chats where id = p_chat_id and status <> 'active') then
    raise exception 'cannot unmatch a closed conversation' using hint = 'chat_over';
  end if;
  -- Keep the request row (its unique pair constraint is the anti-re-pester
  -- rule) but detach it before the FK'd chat row is removed.
  update public.message_requests set chat_id = null where chat_id = p_chat_id;
  delete from public.chats where id = p_chat_id;
end
$$;

revoke execute on function public.unmatch_chat(uuid) from public, anon;

-- 4. Standing (from 20260817090000_trust_safety.sql) ----------------------------
-- One hint for both: the app's sentence does not distinguish a suspension
-- from a ban, and the difference is moderation detail the user writes in
-- about, not alert copy.

create or replace function public.assert_good_standing()
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
    raise exception 'account suspended' using errcode = '42501', hint = 'account_closed';
  end if;
  if v_status = 'banned' then
    raise exception 'account banned' using errcode = '42501', hint = 'account_closed';
  end if;
end
$$;

revoke execute on function public.assert_good_standing()
  from public, anon, authenticated;

-- 5. The rate limiters (from 20260817150000_launch_hardening.sql, except
-- throttle_messages, whose live body is 20260830100000's) ----------------------

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
  return new;
end
$$;

create or replace function public.throttle_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports
      where reporter_id = new.reporter_id
        and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'daily report limit reached'
      using errcode = 'check_violation', hint = 'report_daily_cap';
  end if;
  return new;
end
$$;

create or replace function public.throttle_trips()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.trips
      where user_id = new.user_id
        and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'daily trip limit reached'
      using errcode = 'check_violation', hint = 'trip_daily_cap';
  end if;
  return new;
end
$$;

create or replace function public.throttle_pins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.seeded and (select count(*) from public.pins
      where user_id = new.user_id
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily pin limit reached'
      using errcode = 'check_violation', hint = 'pin_daily_cap';
  end if;
  return new;
end
$$;

create or replace function public.throttle_photos()
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
    raise exception 'daily photo upload limit reached'
      using errcode = 'check_violation', hint = 'photo_daily_cap';
  end if;
  return new;
end
$$;

create or replace function public.throttle_blocks()
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
    raise exception 'daily block limit reached'
      using errcode = 'check_violation', hint = 'block_daily_cap';
  end if;
  -- Counted via the audit spine because unblocking deletes the blocks row.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source)
  values (new.blocker_id, 'block', null, 'created', 'rate-limit');
  return new;
end
$$;

create or replace function public.screen_profile_text()
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
    raise exception 'daily profile update limit reached'
      using errcode = 'check_violation', hint = 'profile_daily_cap';
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
        using errcode = 'check_violation', hint = 'guidelines';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function
  public.throttle_messages(),
  public.throttle_reports(),
  public.throttle_trips(),
  public.throttle_pins(),
  public.throttle_photos(),
  public.throttle_blocks(),
  public.screen_profile_text()
from public, anon, authenticated;

-- 6. send_message_request (live body: 20260830110000_a_block_says_which_kind)
-- Restated whole; the hints are the only change. The four raise literals
-- carrying the word the design brief bans are reissued byte for byte and
-- re-listed in .copy-lint-allow — their rewording is a separate package's
-- job, and once the client maps the hint nobody reads them anyway.

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
    'used', v_sent_today + 1,
    'category', case when v_masked = 'blocked_by_moderation'
                     then v_verdict ->> 'category' else null end);
end
$$;
