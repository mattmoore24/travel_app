-- One name for one act, in the database's own words.
--
-- 20260904120000 was reworded AFTER it had applied: a copy-lint fix changed
-- the four raise literals in send_message_request from "request" to
-- "hello" in a file the deploy had already recorded, so production still
-- raises the 2026-09-02 wording and the file on the branch says something
-- that has never run anywhere. Editing an applied migration is the thing
-- the runbook says never to do, and this is the fix-forward it asks for.
--
-- The wording lands on the product's own verb rather than on "hello", which
-- the client's one-name rule (src/app/__tests__/one-name-for-one-act) keeps
-- out of anything a person reads - and the client reads these literals to
-- match them. The hints are unchanged: they are the machine tokens the app
-- keys its sentences on. Nothing else in the body moves; it is the
-- 20260904120000 body verbatim except for three strings.
--
-- Same signature, so `create or replace` is enough; the grants are restated
-- anyway, as every function restatement here does.

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
  -- is (trips, pins, photos, strikes, verification, group creation).
  perform pg_advisory_xact_lock(hashtext('first_messages:' || v_sender::text));
  select coalesce(
    (select (value #>> '{}')::int from public.app_config
      where key = 'first_messages_per_day'), 8)
  into v_cap;
  select count(*)::int into v_sent_today
  from public.message_requests
  where sender_id = v_sender and created_at >= date_trunc('day', now());
  if v_sent_today >= v_cap then
    return jsonb_build_object(
      'request_id', null, 'delivered', false, 'queued', false, 'blocked', false,
      'capped', true, 'allowed', v_cap, 'used', v_sent_today,
      'category', null);
  end if;

  if (select count(*) from public.moderation_events
      where subject_user_id = v_sender
        and entity_type = 'message_request'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily limit for saying hi reached'
      using errcode = 'check_violation', hint = 'hello_daily_cap';
  end if;
  if p_recipient = v_sender then
    raise exception 'cannot say hi to yourself';
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

  -- Both branches SELECT the city they are proving exists; a null answer
  -- folds into the SAME oracle-proof 'recipient unavailable' with the SAME
  -- hint, so no branch can leak a new fact about who is out there.
  if p_source = 'trip_match' then
    -- The SENDER's radius from the SENDER's city: exactly the reach of the
    -- queue the hello was sent from, so a person the queue showed is never
    -- refused here.
    select mine.city_id into v_city
    from public.trips mine
    join public.profiles me on me.user_id = mine.user_id
    join public.cities_within_km(mine.city_id, me.travelers_radius_km) near on true
    join public.trips theirs
      on theirs.city_id = near.id
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
    where p.user_id = p_recipient and p.expires_at > now()
    -- The pin with longest left is the one somebody is answering.
    order by p.expires_at desc, p.city_id
    limit 1;
    if v_city is null then
      raise exception 'recipient unavailable' using hint = 'recipient_unavailable';
    end if;
  else
    raise exception 'unknown source for saying hi';
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
    raise exception 'already said hi to this traveler'
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
revoke execute on function public.send_message_request(uuid, public.request_source, text, text)
  from public, anon;
grant execute on function public.send_message_request(uuid, public.request_source, text, text)
  to authenticated;
