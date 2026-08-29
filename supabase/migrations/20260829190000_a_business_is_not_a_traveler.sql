-- A business account cannot do traveler things. In the database, not the app.
--
-- Founder, after testing as a business: "under no circumstances should a
-- business account ever have the option to join a chat of any other business
-- or other pin of any kind... It also doesn't make any sense for a business
-- account to ever be able to join its own chat, and it also doesn't make
-- sense for the business account to ever have to set a date for when it is
-- leaving."
--
-- "Under no circumstances" is a database rule. The client already hides some
-- of this — the Travelers tab is swapped out, dropping a pin is hidden — but
-- every one of the functions below would have accepted the call:
--
--   join_room          join ANY listed business's room, including your own
--   join_pin_chat      join any traveler's open plan
--   create_group       start a traveler group, with an expiry date
--   post_joinable_pin  put a plan on the map
--   set_visibility     a discovery setting for an account nothing discovers
--   pins insert        the pins table's own trigger asked nothing about it
--
-- A rule enforced only in the client is not enforced: these are RPCs on a
-- public schema and the anon key is in the app bundle.
--
-- The departure date disappears as a consequence rather than as a separate
-- fix. It is join_room's second argument, and a business never reaches
-- join_room, so nothing ever asks a business when it is leaving.

/**
 * The one place that says no, so every refusal reads the same.
 *
 * Deliberately not a §7 rule 8 message about discovery: an owner who somehow
 * reaches one of these has not done anything wrong, they have found a control
 * that should not have been offered. The client's job is that it never is.
 */
create or replace function public.assert_not_business(p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_business_account(auth.uid()) then
    raise exception 'a business account cannot %', p_what
      using errcode = '42501';
  end if;
end
$$;

grant execute on function public.assert_not_business(text) to authenticated;

-- 1. Rooms. Any business's, including its own.
create or replace function public.join_room(p_chat_id uuid, p_departure_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  -- Ahead of everything else: an owner is not a guest in a room, not even
  -- their own, and a room membership carries a departure date, which is not a
  -- thing a business has.
  perform public.assert_not_business('join a room');
  if not exists (
    select 1 from public.businesses b
    join public.chats c on c.id = b.chat_id
    where b.chat_id = p_chat_id
      and b.active
      and b.state = 'listed'
      and c.status = 'active'
  ) then
    raise exception 'room unavailable';
  end if;
  if p_departure_date is not null and p_departure_date < current_date then
    raise exception 'departure date is in the past';
  end if;

  v_expires := case
    when p_departure_date is null then now() + interval '90 days'
    else least((p_departure_date + 3)::timestamptz, now() + interval '90 days')
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (p_chat_id, v_user, p_departure_date, v_expires)
  on conflict (chat_id, user_id) do update
    set departure_date = excluded.departure_date,
        expires_at = excluded.expires_at,
        archived_at = null;

  return jsonb_build_object('joined', true, 'expires_at', v_expires);
end
$$;

revoke execute on function public.join_room(uuid, date) from public, anon;
grant execute on function public.join_room(uuid, date) to authenticated;

-- 2. The pins table itself. The trigger is the chokepoint every insert passes,
-- whether it came through an RPC or straight at the table with the anon key.
create or replace function public.pin_owner_is_a_traveler()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_business_account(new.user_id) then
    raise exception 'a business account cannot drop a pin'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists pins_owner_is_a_traveler on public.pins;
create trigger pins_owner_is_a_traveler
  before insert on public.pins
  for each row execute function public.pin_owner_is_a_traveler();

-- 3. The four remaining traveler actions, re-stated whole with the guard.
--
-- Re-stated rather than patched: these are plpgsql bodies, there is no way to
-- add a line to one in place, and CREATE OR REPLACE keeps the signature so
-- nothing downstream has to change. Each guard sits directly after the
-- standing check, which is where every other precondition in this schema goes.

create or replace function public.join_pin_chat(p_pin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_chat uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('join a plan');

  select p.user_id, g.chat_id into v_owner, v_chat
    from public.pins p
    join public.groups g on g.pin_id = p.id
   where p.id = p_pin_id
     and p.expires_at > now();

  -- One sentence for every way this can fail, on purpose. "Not open any more"
  -- covers expired, taken down, never joinable, and a person who cannot see
  -- you — and a caller cannot tell those apart, which is the point. The
  -- alternative is an endpoint that answers "does this person's audience
  -- admit me" for any uuid you feed it.
  if v_chat is null then
    raise exception 'That plan is not open to join any more.' using errcode = '42501';
  end if;

  if v_owner is distinct from v_user then
    if not public.is_discoverable_owner(v_owner)
       or public.is_blocked_pair(v_owner)
       or not public.discovery_pair_ok(v_user, v_owner) then
      raise exception 'That plan is not open to join any more.' using errcode = '42501';
    end if;
  end if;

  if (select c.status from public.chats c where c.id = v_chat) <> 'active'
     or public.group_chat_closed(v_chat) then
    raise exception 'This chat has ended.' using errcode = '42501';
  end if;

  -- Removed by an admin means removed. Tapping the pin again is not a way
  -- back in — the same tombstone join_group_with_invite reads.
  if (
    select coalesce(max(created_at) filter (where action = 'removed_by_moderator'),
                    '-infinity'::timestamptz)
         > coalesce(max(created_at) filter (where action = 'readmitted_by_moderator'),
                    '-infinity'::timestamptz)
      from public.moderation_events
     where subject_user_id = v_user
       and entity_type = 'room_member'
       and entity_id = v_chat
  ) then
    raise exception 'You were removed from this group. Ask an admin to let you back in.'
      using errcode = '42501';
  end if;

  -- No departure date to ask for: this group has no end, so a joiner has no
  -- horizon to be clamped to. Rejoining after leaving is just this insert
  -- again, and it must not demote an admin who left and came back.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (v_chat, v_user, null, 'infinity')
  on conflict (chat_id, user_id) do update
    set expires_at = 'infinity',
        archived_at = null;

  return jsonb_build_object('chat_id', v_chat);
end
$$;

create or replace function public.post_joinable_pin(
  p_city_id int,
  p_venue_name text,
  p_note text,
  p_place_label text,
  p_category public.pin_category,
  p_lat double precision,
  p_lng double precision,
  p_intent_date date,
  p_expires_at timestamptz
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

  insert into public.pins (
    user_id, city_id, venue_name, note, place_label,
    category, lat, lng, intent_date, expires_at, seeded
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    p_category, p_lat, p_lng, p_intent_date, p_expires_at, false
  )
  returning id into v_pin;

  -- The group is called what the plan is called. groups.name allows 2 to 60
  -- characters and venue_name allows 1 to 80, so both ends need saying: a
  -- long venue is cut, and the one-character venue that would otherwise fail
  -- the CHECK — and roll the pin back with it — gets a name instead.
  v_name := left(btrim(p_venue_name), 60);
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

create or replace function public.create_group(
  p_name text,
  p_max_stay_until date,
  p_speaking public.group_speaking default 'everyone',
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_recent int;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('start a group');

  -- NULL is a real answer now: no end date.
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  -- The ceiling that used to be a table constraint, said in words.
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
  end if;

  -- Anyone can make a group; nobody can make forty. Serialised per person so
  -- two taps cannot both see a stale count.
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_user::text));
  select count(*) into v_recent
    from public.groups
   where created_by = v_user and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'You have started a few groups today already.'
      using errcode = 'check_violation';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;
  insert into public.groups (chat_id, created_by, name, photo_path, speaking, max_stay_until)
  values (v_chat, v_user, btrim(p_name), p_photo_path, p_speaking, p_max_stay_until);

  -- The creator runs it, and their own membership runs to the group's own
  -- horizon rather than a week from now.
  --
  -- `'infinity'` when there is no end date. room_members.expires_at is NOT
  -- NULL, and `null::date + 7` is NULL, so without this branch every
  -- no-end-date group failed at birth with a 23502 that rolled the whole
  -- creation back — the chats row, the groups row, all of it.
  v_expires := case
    when p_max_stay_until is null then 'infinity'::timestamptz
    else (p_max_stay_until + 7)::timestamptz
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, p_max_stay_until, v_expires, 'admin');

  return v_chat;
end
$$;

create or replace function public.set_visibility(p_audience public.profile_audience)
returns public.profile_audience
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
  perform public.assert_not_business('set who sees it');
  -- Narrowing your audience to verified people costs a verified badge.
  if p_audience <> 'everyone'
     and not exists (select 1 from public.profiles where user_id = v_user and verified) then
    raise exception 'get verified before choosing who can see you'
      using errcode = 'check_violation';
  end if;
  update public.profiles set visible_to = p_audience where user_id = v_user;
  return p_audience;
end
$$;
