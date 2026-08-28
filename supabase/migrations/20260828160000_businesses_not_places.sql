-- The database says "place" out loud, and the app no longer does.
--
-- Founder, 2026-08-28: "I don't think we should refer to businesses as
-- 'places', we should always call them businesses to keep it consistent and
-- also less confusing." That is a copy change everywhere except here, where
-- these five sentences are not internal at all: `saveFailureMessage` in
-- src/lib/failure-message.ts returns `error.message` unchanged by design, so a
-- Postgres exception raised in one of these functions is printed to a person
-- verbatim. Tapping Message on a listing nobody has claimed shows "nobody runs
-- this place yet. Try its chat instead" in the alert, word for word.
--
-- Three functions, restated whole because a PL/pgSQL body cannot be patched in
-- place. No OUT columns change, so `create or replace` is allowed and the
-- grants survive (see the traps skill: it is a signature change Postgres
-- refuses, not a body change). Restated below anyway, so a reader of this file
-- can see who may call them without going back two migrations.
--
-- The client half of this change ships over the air; these five do not reach a
-- phone until this migration deploys. Landing them apart leaves the app saying
-- business and the alert saying place.

create or replace function public.report_business(
  p_business_id uuid,
  p_reason public.business_report_reason,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_business_account(v_user) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'business not found';
  end if;
  if public.owns_business(p_business_id) then
    raise exception 'that is your own listing';
  end if;

  insert into public.business_reports (business_id, reporter_user_id, reason, note)
  values (p_business_id, v_user, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (business_id, reporter_user_id) where reporter_user_id is not null
  do nothing;
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
      return jsonb_build_object('chat_id', v_chat, 'blocked', true, 'existing', true);
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
    return jsonb_build_object('blocked', true);
  end if;

  insert into public.chats (kind) values ('business') returning id into v_chat;
  insert into public.chat_participants (chat_id, user_id) values (v_chat, v_sender), (v_chat, v_owner);
  insert into public.messages (chat_id, sender_id, body, moderation_status)
  values (v_chat, v_sender, p_first_message, 'approved');

  return jsonb_build_object('chat_id', v_chat, 'blocked', false, 'existing', false);
end
$$;

create or replace function public.rate_business(
  p_business_id uuid,
  p_bucket public.rating_bucket,
  p_rank double precision,
  p_tags public.rating_tag[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_category public.business_category;
  v_score numeric;
  v_today int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_guest_account(v_user) then
    raise exception 'make an account first' using errcode = '42501';
  end if;
  -- Rule 8, and the specific thing it stops here: a bar ranking a rival down.
  if public.is_business_account(v_user) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'business not found';
  end if;
  if p_rank < 0 or p_rank > 1 then
    raise exception 'that is not a position in the list';
  end if;
  if array_length(p_tags, 1) > 3 then
    raise exception 'three tags is plenty';
  end if;

  select count(*) into v_today from public.business_ratings
   where user_id = v_user and updated_at > now() - interval '24 hours';
  if v_today >= 20 then
    raise exception 'that is as many businesses as you can rate today';
  end if;

  select category into v_category from public.businesses where id = p_business_id;
  v_score := public.rating_score(p_bucket, p_rank);

  insert into public.business_ratings
    (user_id, business_id, category, bucket, rank, score, tags)
  values (v_user, p_business_id, v_category, p_bucket, p_rank, v_score, coalesce(p_tags, '{}'))
  on conflict (user_id, business_id) do update
    set category = excluded.category,
        bucket = excluded.bucket,
        rank = excluded.rank,
        score = excluded.score,
        tags = excluded.tags,
        updated_at = now();

  return jsonb_build_object('score', v_score);
end
$$;
revoke execute on function public.report_business(uuid, public.business_report_reason, text)
  from public, anon;
grant execute on function public.report_business(uuid, public.business_report_reason, text)
  to authenticated;

revoke execute on function public.message_business(uuid, text) from public, anon;
grant execute on function public.message_business(uuid, text) to authenticated;

revoke execute on function public.rate_business(
  uuid, public.rating_bucket, double precision, public.rating_tag[]
) from public, anon;
grant execute on function public.rate_business(
  uuid, public.rating_bucket, double precision, public.rating_tag[]
) to authenticated;

notify pgrst, 'reload schema';
