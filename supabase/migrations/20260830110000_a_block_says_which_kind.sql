-- A block notice that can teach: screen_first_message computes a category
-- ('sexual' or 'flirtation') and every layer above threw it away, so a
-- message caught by the flirtation patterns was told it "came across as
-- explicit", which is not what the classifier said. The composer can only
-- say which kind of wrong if the send path returns it.
--
-- Two jsonb-returning functions reissued with one extra key on their blocked
-- answers. Returning the category is safe: it is the sender's own message,
-- and preview_first_message already hands the same value to any
-- authenticated caller. It is NOT extended to the recipient side or to any
-- other function's return. Never the matched pattern - the blocklist is a
-- table of regexes and naming the trigger hands out the evasion rule.
--
-- send_message_request: byte-identical to 20260822235000_review_fixes.sql
-- :195-352 (the live definition) except 'category' on the final return and,
-- because every branch of this function returns the same keys by contract
-- (13_first_message_cap.test.sql holds the exact list), a null 'category' on
-- the capped branch. message_business: byte-identical to
-- 20260828160000_businesses_not_places.sql:56-137 except 'category' on both
-- blocked returns. No RETURNS TABLE signatures change, so `create or
-- replace` is correct and no grants move; message_business's revoke/grant
-- pair is restated below unchanged, as its source file did.

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
    'used', v_sent_today + 1,
    'category', case when v_masked = 'blocked_by_moderation'
                     then v_verdict ->> 'category' else null end);
end
$$;

create or replace function public.message_business(p_business_id uuid, p_first_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_owner uuid;
  v_verdict jsonb;
  v_chat uuid;
  v_opened int;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_business_account(v_sender) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if public.is_guest_account(v_sender) then
    raise exception 'make an account first' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'business not found';
  end if;

  select owner_user_id into v_owner from public.businesses where id = p_business_id;
  if v_owner is null then
    -- A seeded venue nobody has claimed. It has a room anybody can join, but
    -- there is no one on the other end of a message, and saying so is better
    -- than opening a chat into the void. The client no longer offers Message
    -- here at all (business_detail carries `claimed`), so reaching this is a
    -- race with somebody unclaiming, not the ordinary path.
    raise exception 'nobody runs this business yet. Try its chat instead';
  end if;

  -- Already talking to them: same conversation, not a second one.
  select c.id into v_chat
    from public.chats c
    join public.chat_participants me on me.chat_id = c.id and me.user_id = v_sender
    join public.chat_participants them on them.chat_id = c.id and them.user_id = v_owner
   where c.kind = 'business'
   limit 1;
  if v_chat is not null then
    -- Screened like any other, because it is a message to somebody who has
    -- not agreed to anything: the existing thread is not consent to whatever
    -- the next one says.
    v_verdict := public.screen_first_message(p_first_message);
    if (v_verdict ->> 'action') = 'block' then
      return jsonb_build_object('chat_id', v_chat, 'blocked', true, 'existing', true,
                                'category', v_verdict ->> 'category');
    end if;
    insert into public.messages (chat_id, sender_id, body, moderation_status)
    values (v_chat, v_sender, p_first_message, 'approved');
    return jsonb_build_object('chat_id', v_chat, 'blocked', false, 'existing', true);
  end if;

  -- Its own budget, separate from the eight hellos a day. Writing to ten
  -- hostels about beds is a normal evening's planning; writing to ten
  -- strangers is not the same act and should not share a counter.
  select count(*) into v_opened
    from public.chats c
    join public.chat_participants cp on cp.chat_id = c.id and cp.user_id = v_sender
   where c.kind = 'business' and c.created_at > now() - interval '24 hours';
  if v_opened >= 10 then
    raise exception 'that is as many businesses as you can write to today';
  end if;

  v_verdict := public.screen_first_message(p_first_message);
  if (v_verdict ->> 'action') = 'block' then
    -- No chat is created at all. There is nothing to release later, which is
    -- the difference between this and the held first-message path.
    return jsonb_build_object('blocked', true, 'category', v_verdict ->> 'category');
  end if;

  insert into public.chats (kind) values ('business') returning id into v_chat;
  insert into public.chat_participants (chat_id, user_id) values (v_chat, v_sender), (v_chat, v_owner);
  insert into public.messages (chat_id, sender_id, body, moderation_status)
  values (v_chat, v_sender, p_first_message, 'approved');

  return jsonb_build_object('chat_id', v_chat, 'blocked', false, 'existing', false);
end
$$;

revoke execute on function public.message_business(uuid, text) from public, anon;
grant execute on function public.message_business(uuid, text) to authenticated;
