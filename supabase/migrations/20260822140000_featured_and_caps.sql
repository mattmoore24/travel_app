-- Never ship a faceless featured traveler, and pace the senders
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. featured_traveler requires a face
-- ---------------------------------------------------------------------------
--
-- This is the ONE person a signed-out visitor sees, and the whole pitch of
-- the screen is "here is somebody real who is here right now". Somebody with
-- no approved photo rendered as a grey slab with a name on it, which makes
-- exactly the opposite case.
--
-- A WHERE-only change, so create-or-replace is safe here: the OUT columns are
-- untouched and nothing has to be dropped (AGENTS.md).

create or replace function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    p.display_name,
    p.age,
    p.verified,
    p.languages,
    p.bio,
    c.name,
    t.start_date,
    t.end_date,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = t.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1)
  from public.trips t
  join public.profiles p on p.user_id = t.user_id
  join public.cities c on c.id = t.city_id
  join public.users u on u.id = t.user_id
  where t.city_id = p_city_id
    and t.status = 'active'
    and u.status = 'active'
    and p.onboarding_completed_at is not null
    and t.end_date >= current_date - 1
    and t.start_date <= current_date + 14
    -- A face, in the slot the app puts a face in.
    and exists (
      select 1 from public.profile_photos pp
      where pp.user_id = t.user_id
        and pp.moderation_status = 'approved'
        and pp.position = 0
    )
  order by
    (select count(*) from public.message_requests r
      where r.recipient_id = t.user_id
        and r.created_at > now() - interval '30 days') desc,
    p.verified desc,
    t.created_at desc
  limit 1
$$;

grant execute on function public.featured_traveler(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A daily cap on first messages
-- ---------------------------------------------------------------------------
--
-- Small build, big policy. A cap paces senders, protects the inboxes of the
-- travelers whose departure would kill the category, and keeps the
-- moderation queue to a size a founder can actually read. It is a SAFETY
-- limit, never a product tier: §7 rule 1 says the core is free, and this must
-- never, ever be sold back as "more hellos per day".
--
-- It sits beside the existing rate limits rather than replacing them: those
-- are anti-abuse burst controls measured in minutes; this is a daily budget
-- measured in people.

insert into public.app_config (key, value)
values ('first_messages_per_day', '8'::jsonb)
on conflict (key) do nothing;

create or replace function public.first_messages_today()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.message_requests r
  where r.sender_id = auth.uid()
    and r.created_at >= date_trunc('day', now())
$$;

revoke execute on function public.first_messages_today() from public, anon;
grant execute on function public.first_messages_today() to authenticated;

create or replace function public.first_message_budget()
returns table (used int, allowed int)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.first_messages_today(),
    coalesce((select (value #>> '{}')::int from public.app_config
              where key = 'first_messages_per_day'), 8)
$$;

revoke execute on function public.first_message_budget() from public, anon;
grant execute on function public.first_message_budget() to authenticated;

comment on function public.first_message_budget() is
  'How many hellos this user has sent today and how many they get. A safety '
  'limit, never a paid tier (hard rule 1).';

-- ---------------------------------------------------------------------------
-- 3. The cap, enforced
-- ---------------------------------------------------------------------------
--
-- Unchanged OUT type (jsonb), so create-or-replace is safe.

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
  select coalesce(
    (select (value #>> '{}')::int from public.app_config
      where key = 'first_messages_per_day'), 8)
  into v_cap;
  select count(*)::int into v_sent_today
  from public.message_requests
  where sender_id = v_sender and created_at >= date_trunc('day', now());
  if v_sent_today >= v_cap then
    return jsonb_build_object(
      'delivered', false, 'queued', false, 'blocked', false,
      'capped', true, 'allowed', v_cap);
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
-- 4. A chance to reword, before anything is sent
-- ---------------------------------------------------------------------------
--
-- The pre-filter already decides whether a first message will be delivered.
-- It just did so AFTER the person hit send, so the only thing the app could
-- ever say was no. Exposing the verdict as a read lets the composer ask
-- "this might land wrong, want to reword it?" while the sentence is still
-- being written — which is how most would-be rejections stop happening at
-- all, rather than being counted.
--
-- Deliberately returns only a boolean and a category, never the pattern that
-- matched: a caller who could see WHY would have a machine for discovering
-- exactly which words to avoid, which is the opposite of the point.

create or replace function public.preview_first_message(p_text text)
returns table (would_block boolean, category text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_verdict jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_verdict := public.screen_first_message(p_text);
  return query select
    (v_verdict ->> 'action') = 'block',
    v_verdict ->> 'category';
end;
$$;

revoke execute on function public.preview_first_message(text) from public, anon;
grant execute on function public.preview_first_message(text) to authenticated;

comment on function public.preview_first_message(text) is
  'Would this first message be blocked? Read-only, so the composer can offer '
  'a reword before anything is sent. Never returns the matching pattern.';
