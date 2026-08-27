-- Two things the final audit found, both of which a person would have hit on
-- the first day.
--
-- 1. A place nobody has claimed still offered "Message". The four launch
--    venues are seeded with owner_user_id null and are on the map from day
--    one, and message_business raises 'nobody runs this place yet' — AFTER
--    somebody has typed up to 500 characters and pressed Send. business_detail
--    returned no way for the client to know, so the client could not have
--    hidden the button even if it wanted to.
--
-- 2. A storefront check the model was not sure about could never be resolved
--    by anybody. apply_business_verification_verdict writes status
--    'uncertain', and its own guard refuses any row that is not 'pending', so
--    the founder's hand review had no way back in. The business meanwhile sat
--    on a screen reading "someone is looking at these by hand" with the retry
--    button taken away. That is a permanent dead end reachable by an honest
--    business on its first attempt.

-- ---------------------------------------------------------------------------
-- 1. business_detail learns whether anybody runs the place
-- ---------------------------------------------------------------------------
--
-- DROP first: Postgres will not add an OUT column to an existing RETURNS TABLE
-- signature through create-or-replace, and the failure lands mid-migration
-- with the earlier statements already applied. Grants are re-stated below
-- because a drop takes them with it.

drop function if exists public.business_detail(uuid);

create function public.business_detail(p_business_id uuid)
returns table (
  id uuid,
  chat_id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  verified boolean,
  -- Whether anybody runs it here. NOT the owner's id, and not their name:
  -- the question a traveler's screen has to answer is "is there somebody on
  -- the other end of a message", and that is a boolean. Anything more would
  -- put a person on a public endpoint.
  claimed boolean,
  member_count int,
  photos jsonb,
  links jsonb,
  hours jsonb,
  posts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.chat_id,
    b.city_id,
    b.name,
    b.category,
    b.description,
    b.place_label,
    b.hours_note,
    b.website_url,
    b.lat,
    b.lng,
    b.verified,
    b.owner_user_id is not null,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now()),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'storage_path', p.storage_path)
                       order by p.position)
      from public.business_photos p
      where p.business_id = b.id and p.moderation_status = 'approved'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'label', l.label,
                                          'value', l.value) order by l.position, l.created_at)
      from public.business_links l where l.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens,
                                          'closes', h.closes) order by h.weekday, h.position)
      from public.business_hours h where h.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'title', po.title, 'body', po.body,
                                          'photo_path', po.photo_path,
                                          'happens_at', po.happens_at, 'ends_at', po.ends_at)
                       order by po.happens_at nulls last, po.created_at desc)
      from public.business_posts po
      where po.business_id = b.id and po.archived_at is null
    ), '[]'::jsonb)
  from public.businesses b
  where b.id = p_business_id
    and (public.is_visible_business(b.id) or public.owns_business(b.id))
$$;

grant execute on function public.business_detail(uuid) to anon, authenticated;

comment on function public.business_detail(uuid) is
  'One place''s page in a single call. `claimed` says whether anybody runs it '
  'here, so a traveler is not offered Message on a venue where '
  'message_business would refuse them after they had typed.';

-- ---------------------------------------------------------------------------
-- 2. An uncertain storefront check can be finished by a person
-- ---------------------------------------------------------------------------
--
-- Same signature, so create-or-replace is legal and the grants survive.
-- Two changes: the rejection now emails the business the way the approval
-- does, and the comment no longer claims the row is left pending when the
-- line beneath it plainly sets 'uncertain'.

create or replace function public.apply_business_verification_verdict(
  p_request_id uuid,
  p_verdict jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_verifications%rowtype;
  v_action text := p_verdict ->> 'action';
begin
  perform public.assert_service_caller();

  select * into v_row from public.business_verifications
   where id = p_request_id for update;
  if not found then
    raise exception 'verification request not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'verification request is not pending';
  end if;

  if v_action = 'approve' then
    update public.business_verifications
       set status = 'approved', verdict = p_verdict, reviewed_at = now(), reason = null
     where id = p_request_id;
    update public.businesses set verified_at = now() where id = v_row.business_id;
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, 'You are verified on Samewhere',
           concat(b.name, ' now shows the verified check on its page. Nothing ',
                  'else changes, and you can put more up whenever you like.'),
           'business_verified'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  elsif v_action = 'uncertain' then
    -- Terminal for the machine, open for a person:
    -- admin_resolve_business_verification below is the way back in. The
    -- founder gets the mail; the business gets a screen that says a person is
    -- looking, and now that is true rather than a place the row goes to die.
    update public.business_verifications
       set status = 'uncertain', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(p_verdict ->> 'reason', null)
     where id = p_request_id;
    insert into public.outbound_mail (subject, text_body, kind)
    select concat('Storefront photo needs a look: ', b.name),
           concat('Business: ', b.name, E'\n',
                  'Request: ', p_request_id::text, E'\n',
                  'Model said: ', coalesce(p_verdict ->> 'reason', '(no reason given)'), E'\n\n',
                  'To finish it: select public.admin_resolve_business_verification(''',
                  p_request_id::text, ''', true);  -- or false, with a reason')
      from public.businesses b where b.id = v_row.business_id;
  else
    update public.business_verifications
       set status = 'rejected', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(
             p_verdict ->> 'reason',
             'We could not match those photos to the business. Try again in daylight, with the sign in frame.'
           )
     where id = p_request_id;
    -- The screen shows the reason too, but somebody who sent their photos and
    -- put the phone away has no reason to open the app again. The approval
    -- mails; so should this.
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, concat('That storefront photo did not pass: ', b.name),
           concat('We could not match those photos to ', b.name, '.', E'\n\n',
                  coalesce(p_verdict ->> 'reason', ''), E'\n\n',
                  'Open Samewhere and have another go. Same two shots: one from ',
                  'across the street with the whole front in, one near enough to ',
                  'read the sign.'),
           'business_verification_rejected'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  end if;

  insert into public.moderation_events
    (subject_business_id, entity_type, entity_id, action, source, metadata)
  values (v_row.business_id, 'business_verification', p_request_id,
          concat('business_verification_', coalesce(v_action, 'reject')),
          'automated', p_verdict);
end
$$;

/**
 * Finish a storefront check the machine would not call.
 *
 * Service role only, like every other admin path here. It is the only way an
 * 'uncertain' row ever reaches a terminal state, and without it a business
 * whose sign is hand-painted in a script the model could not read would sit
 * on "someone is looking at these by hand" forever.
 *
 * Rejecting hands back a retry: the client only takes the retry button away
 * while a check is pending or uncertain.
 */
create or replace function public.admin_resolve_business_verification(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_verifications%rowtype;
begin
  perform public.assert_service_caller();

  select * into v_row from public.business_verifications
   where id = p_request_id for update;
  if not found then
    raise exception 'verification request not found';
  end if;
  if v_row.status not in ('pending', 'uncertain') then
    raise exception 'that one is already settled';
  end if;

  if p_approve then
    update public.business_verifications
       set status = 'approved', reviewed_at = now(), reason = null
     where id = p_request_id;
    update public.businesses set verified_at = now() where id = v_row.business_id;
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, 'You are verified on Samewhere',
           concat(b.name, ' now shows the verified check on its page. Nothing ',
                  'else changes, and you can put more up whenever you like.'),
           'business_verified'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  else
    update public.business_verifications
       set status = 'rejected', reviewed_at = now(),
           reason = coalesce(
             p_reason,
             'We could not match those photos to the business. Have another go, with the sign in frame.'
           )
     where id = p_request_id;
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, concat('That storefront photo did not pass: ', b.name),
           concat('We could not match those photos to ', b.name, '.', E'\n\n',
                  coalesce(p_reason, ''), E'\n\n',
                  'Open Samewhere and have another go.'),
           'business_verification_rejected'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  end if;

  insert into public.moderation_events
    (subject_business_id, entity_type, entity_id, action, source, metadata)
  values (v_row.business_id, 'business_verification', p_request_id,
          case when p_approve then 'business_verification_approve'
               else 'business_verification_reject' end,
          'human', jsonb_build_object('reason', p_reason));
end
$$;

revoke execute on function public.admin_resolve_business_verification(uuid, boolean, text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A place has a name in its own chat
-- ---------------------------------------------------------------------------
--
-- docs/BUSINESS_ACCOUNTS.md §3.1 says display_name is set to the business
-- name "so chat headers and message authorship render with zero query
-- changes". It never was. A business forks out of onboarding at step 3,
-- before the name field is saved, so profiles.display_name stayed NULL, and
-- room_messages and enqueue_message_push both read that column: every message
-- the place posted into its own room was authored by nobody, and every push
-- it sent went out with no sender.

create or replace function public.register_business(
  p_name text,
  p_category public.business_category,
  p_city_id int,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.businesses where owner_user_id = v_user) then
    raise exception 'this account already runs a business';
  end if;
  -- A traveler who has finished onboarding is a person, and a person is not
  -- a business. Catching it here keeps the two account kinds from ever
  -- overlapping on one auth row, which is what makes every guard above a
  -- simple question with one answer.
  if exists (
    select 1 from public.profiles
    where user_id = v_user and onboarding_completed_at is not null
  ) then
    raise exception 'this account is already a traveler';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  insert into public.businesses
    (city_id, name, category, lat, lng, chat_id, owner_user_id, state, claimed_at)
  values
    (p_city_id, p_name, p_category, p_lat, p_lng, v_chat, v_user, 'unconfirmed', now())
  returning id into v_id;

  -- The place's name IS its display name. Nothing else ever gets typed into
  -- this account's profile, and every author line in every room reads it.
  update public.profiles set display_name = p_name where user_id = v_user;

  return v_id;
end
$$;

revoke execute on function
  public.register_business(text, public.business_category, int, double precision, double precision)
from public, anon;

-- A rename has to carry through to the same column, or the place is renamed
-- everywhere except on the messages it has already sent and every one it
-- sends next.
create or replace function public.business_rename_resets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.profiles set display_name = new.name
     where user_id = new.owner_user_id and new.owner_user_id is not null;
  end if;
  if new.name is distinct from old.name
     or new.city_id is distinct from old.city_id
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    new.verified_at := null;
    if old.state = 'listed' then
      new.state := 'unconfirmed';
      new.listed_at := null;
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. The owner can speak in their own chat
-- ---------------------------------------------------------------------------
--
-- register_business writes no business_staff row and room_members_refuse_business
-- stops the owner ever joining, so is_room_moderator answered false for the one
-- person who runs the place: they could read their own room and not post in it.

create or replace function public.is_room_moderator(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    -- The owner. First, because it is the common case and the one that was
    -- missing: a claimed place has an owner long before it has any staff.
    select 1 from public.businesses b
    where b.chat_id = p_chat_id and b.owner_user_id = auth.uid()
  ) or exists (
    select 1
    from public.businesses b
    join public.business_staff s on s.business_id = b.id
    where b.chat_id = p_chat_id and s.user_id = auth.uid()
  ) or exists (
    select 1 from public.room_members rm
    where rm.chat_id = p_chat_id
      and rm.user_id = auth.uid()
      and rm.role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. A business cannot report a rival
-- ---------------------------------------------------------------------------
--
-- rate_business and message_business both refuse a business caller;
-- report_business did not, and a report is the expensive one: it emails
-- support and queues a Claude impersonation scan on the FIRST report, one
-- verdict away from darkening a competitor's listing. The client guard alone
-- is not a guard — the anon key ships in the app.

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
    raise exception 'place not found';
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

revoke execute on function public.report_business(uuid, public.business_report_reason, text)
from public, anon;

-- ---------------------------------------------------------------------------
-- 6. is_business_account stops answering questions about other people
-- ---------------------------------------------------------------------------
--
-- The one helper in this set with no revoke, so Supabase's default grant
-- stood and PostgREST exposed it. Any user id lifted off a profile page could
-- be posted to it, and the answer is exactly what the column-scoped grant
-- hiding businesses.owner_user_id exists to withhold. Every caller inside the
-- database is SECURITY DEFINER and unaffected.

revoke execute on function public.is_business_account(uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. website_url goes through the same gate as every other link
-- ---------------------------------------------------------------------------
--
-- business_links funnels every row through validate_business_link: https
-- only, no IP literals. websites_url is separately client-writable and was
-- only ever screened for offensive TEXT, so the identical string refused as a
-- link row was accepted here and rendered as a tappable button on the public
-- page. One chokepoint or none.

create or replace function public.screen_business_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(
        concat_ws(' ', new.name, new.description, new.place_label, new.hours_note)
      ) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;

  new.website_url := nullif(btrim(coalesce(new.website_url, '')), '');
  if new.website_url is not null then
    if new.website_url !~* '^https://' then
      raise exception 'your website has to start with https://'
        using errcode = 'check_violation';
    end if;
    if new.website_url ~* '^https://[0-9]{1,3}(\.[0-9]{1,3}){3}' then
      raise exception 'that link needs a real domain' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. A code that was already used says so
-- ---------------------------------------------------------------------------
--
-- The early return fired before the relist, so a business that renamed itself
-- (which drops the state back to unconfirmed) could retype the code still in
-- its inbox, get a success haptic, land on the tabs, and still be off the
-- map with nothing saying why. The relist now runs on both paths, and the
-- answer says which one it took.

create or replace function public.confirm_business_email(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_email_confirmations%rowtype;
  v_state public.business_state;
  v_fresh boolean;
begin
  select c.* into v_row
    from public.business_email_confirmations c
    join public.businesses b on b.id = c.business_id
   where b.owner_user_id = auth.uid()
   for update;
  if not found then
    raise exception 'ask for a code first';
  end if;

  v_fresh := v_row.confirmed_at is null;

  if v_fresh then
    if v_row.expires_at <= now() then
      raise exception 'that code has expired. Ask for a new one';
    end if;
    if v_row.attempts >= 10 then
      raise exception 'too many tries. Ask for a new code';
    end if;
    if encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex') <> v_row.code_hash then
      update public.business_email_confirmations
         set attempts = attempts + 1 where business_id = v_row.business_id;
      raise exception 'that code is not right';
    end if;
    update public.business_email_confirmations
       set confirmed_at = now() where business_id = v_row.business_id;
  end if;

  -- Both paths. A rename sends a confirmed place back to 'unconfirmed', and
  -- the address on file is still theirs, so re-confirming it is the whole
  -- job — there is nothing to check again.
  select state into v_state from public.businesses where id = v_row.business_id;
  if v_state = 'unconfirmed' then
    update public.businesses
       set state = 'listed', listed_at = now()
     where id = v_row.business_id;
  end if;

  return jsonb_build_object('confirmed', true, 'first_time', v_fresh);
end
$$;

revoke execute on function public.confirm_business_email(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 9. Writing to a place you have already written to actually sends
-- ---------------------------------------------------------------------------
--
-- The existing-chat branch returned the chat id and threw the message away.
-- The client cannot tell that apart from a send, so it fired the success
-- haptic and dropped the traveler into a thread containing only what they
-- had said days earlier. The place never got the question.

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
    raise exception 'place not found';
  end if;

  select owner_user_id into v_owner from public.businesses where id = p_business_id;
  if v_owner is null then
    -- A seeded venue nobody has claimed. It has a room anybody can join, but
    -- there is no one on the other end of a message, and saying so is better
    -- than opening a chat into the void. The client no longer offers Message
    -- here at all (business_detail carries `claimed`), so reaching this is a
    -- race with somebody unclaiming, not the ordinary path.
    raise exception 'nobody runs this place yet. Try its chat instead';
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
    raise exception 'that is as many places as you can write to today';
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

revoke execute on function public.message_business(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 10. The standing post on an unclaimed venue stops speaking as "us"
-- ---------------------------------------------------------------------------
--
-- seed_launch_business_content() is idempotent, so it will not rewrite a post
-- it already placed. The four launch venues have owner_user_id null: there is
-- nobody to "ask us anything", and the traveler-facing screens now say so
-- plainly. This is one row per venue, done here rather than by hand.

update public.business_posts po
   set body = 'The chat here is open to anyone passing through. Swap plans with whoever is around.'
  from public.businesses b
 where b.id = po.business_id
   and b.owner_user_id is null
   and po.archived_at is null
   and po.body = 'The chat is open to anyone passing through. Ask us anything about the city.';
