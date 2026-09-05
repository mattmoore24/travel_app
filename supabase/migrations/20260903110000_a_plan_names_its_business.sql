-- A plan names its business
-- ===========================================================================
--
-- map-pins-link-to-a-business (docs/UX_PACKAGES.md) shipped pins.business_id
-- and the server-side link by name and proximity (20260902190000, section 3),
-- and NOT the traveler's entry point: there has been no 'Plan to go' on a
-- business page, and the only record of that deviation was a comment inside
-- validate_pin explaining that the write path "takes a fixed column list".
-- This is the other half. The page (src/app/place/[id].tsx) now opens the
-- existing pin form pre-filled with the business's name, category and
-- coordinates, and the form submits the business's id EXPLICITLY through
-- this function rather than hoping the name-and-sixty-metres fallback finds
-- the same row.
--
-- Explicit beats inferred, and the two coexist on purpose. A traveler who
-- came from a business page and renames the spot ("the bench outside") is
-- still planning to go to that business; validate_pin's fallback stays for
-- the pin that was dropped from search under the venue's real name, and it
-- only runs when business_id arrives null. validate_pin also still refuses a
-- business in another city (20260902190000:131), which is not repeated here.
-- What IS checked here is that an explicitly named business is on the map at
-- all: a page can be open on a listing that was removed a minute ago, and a
-- pin that deep-links to "That business is not on the map any more" is worse
-- than one with no link.
--
-- A NEW TRAILING PARAMETER, so the signature changes. `create or replace`
-- would create a second overload rather than replace the first, and
-- PostgREST would then refuse the ambiguous call outright. So the previous
-- signature is dropped first and every grant and the comment are restated
-- (AGENTS.md; the traps skill). p_business_id defaults to null, which keeps
-- the twelve-argument call a phone on the previous bundle makes working
-- against this schema (56_a_pin_carries_an_hour.test.sql already pins the
-- ten-argument one). The client sends the argument only when it has a value
-- (src/features/pins/hooks.ts), so a phone on the NEXT bundle keeps posting
-- ordinary pins against the PREVIOUS schema too; only 'Plan to go' waits on
-- this deploy.
--
-- Body from 20260902190000_a_pin_carries_an_hour.sql, section 7, with the
-- guard and the column added and nothing else moved.
-- 72_a_plan_names_its_business.test.sql is the attack.

drop function if exists public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean
);

create function public.post_joinable_pin(
  p_city_id int,
  p_venue_name text,
  p_note text,
  p_place_label text,
  p_category public.pin_category,
  p_lat double precision,
  p_lng double precision,
  p_intent_date date,
  p_expires_at timestamptz,
  p_plan text default null,
  p_intent_time time default null,
  p_joinable boolean default true,
  p_business_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pin uuid;
  v_chat uuid;
  v_recent int;
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('post a plan');

  -- A business named on purpose has to be one a traveler can open. The
  -- city check stays in validate_pin, which every write path shares.
  if p_business_id is not null and not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.active and b.state = 'listed'
  ) then
    raise exception 'That business is not on the map any more.'
      using errcode = 'check_violation';
  end if;

  -- The cap is on GROUPS, so it only applies when one is about to be opened.
  -- A message-me-first pin opens no room and answers to the ten-live-pins
  -- limit in validate_pin instead.
  if p_joinable then
    perform pg_advisory_xact_lock(hashtext('joinable_pin:' || v_user::text));
    select count(*) into v_recent
      from public.groups
     where created_by = v_user
       and pin_id is not null
       and created_at > now() - interval '24 hours';
    if v_recent >= 5 then
      raise exception 'You have opened a few plans to join today already. Post this one as message-me-first, or try again tomorrow.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.pins (
    user_id, city_id, venue_name, note, place_label, plan,
    category, lat, lng, intent_date, intent_time, expires_at, seeded, business_id
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    nullif(btrim(coalesce(p_plan, '')), ''),
    p_category, p_lat, p_lng, p_intent_date, p_intent_time, p_expires_at, false,
    p_business_id
  )
  returning id into v_pin;

  if not p_joinable then
    return jsonb_build_object('pin_id', v_pin, 'chat_id', null);
  end if;

  -- The group is called what the plan is called - the plan text first, the
  -- venue as fallback. groups.name allows 2 to 60 characters and both
  -- sources allow 1 to 80, so both ends need saying: a long name is cut,
  -- and a one-character one - which would fail the CHECK and roll the pin
  -- back with it - gets a name instead.
  v_name := left(btrim(coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p_venue_name)), 60);
  if char_length(v_name) < 2 then
    v_name := 'Meet up';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  -- No end date, deliberately. The pin's 72 hours are the pin's; the
  -- conversation that came out of it is not on a timer.
  insert into public.groups (chat_id, created_by, name, speaking, max_stay_until, pin_id)
  values (v_chat, v_user, v_name, 'everyone', null, v_pin);

  -- 'infinity' rather than a date, for the same reason create_group does it:
  -- room_members.expires_at is NOT NULL and `null::date + 7` is null, which
  -- would fail at 23502 and take the whole pin down with it.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, null, 'infinity', 'admin');

  return jsonb_build_object('pin_id', v_pin, 'chat_id', v_chat);
end
$$;

revoke execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid
) to authenticated;

comment on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text, time, boolean, uuid
) is
  'Posts a plan, in either of the two shapes the form offers. p_joinable '
  'opens the group chat that makes it joinable; false posts the same pin '
  'with nobody able to walk in. Both shapes come through here because pins '
  'are immutable, so the optional hour has to arrive with the insert - and '
  'so does the business the plan names, when it was opened from that '
  'business''s page (p_business_id; null lets validate_pin infer one by name '
  'and distance).';

notify pgrst, 'reload schema';
