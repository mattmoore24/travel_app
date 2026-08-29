-- A pin anyone can join
-- =============================================================================
--
-- Until now a pin had exactly one door: read it, tap "Say hi", write a first
-- message, wait for it to be accepted. That is the right door for meeting one
-- person. It is the wrong door for "I'm at this bar at 9, come along", where
-- the poster does not want to vet four separate hellos and the four people do
-- not want to audition.
--
-- So a pin now has TWO shapes, chosen when it is posted:
--
--   * message me first  — exactly what exists today. Nothing here changes it.
--   * anyone can join   — the pin carries a group chat. One tap puts you in
--                         it and you can talk immediately.
--
-- The join shape is a `groups` row with a `pin_id`. That is the whole of it:
-- a joinable pin is a pin that has a group, and the group is an ordinary
-- traveler group in every other respect — same messages, same reactions, same
-- admin tools, same invite link, same moderation.
--
-- Four decisions worth writing down, because each of them could have gone the
-- other way:
--
-- 1. THE LINK POINTS FROM THE GROUP TO THE PIN, not the other way round.
--    Pins are hard-deleted — by expire_pins on its 15-minute cron, by the
--    poster taking one down, by a 72-hour ceiling that is §7 hard rule 3. A
--    chat_id column on `pins` would take the conversation with it. On
--    `groups`, with `on delete set null`, the pin burns out and the chat is
--    still there. That is the founder's call, in their words: the chat lives
--    on, the pin disappears. From that moment it is an ordinary group with no
--    end date, reachable from the Chat tab and by invite, and no longer
--    joinable from the map, because there is no longer a map pin to tap.
--
-- 2. THE OWNER KEEPS THE PIN. Joiners are members of the group; the pinner is
--    its admin and the pin's user_id never moves. This matters for who may
--    SEE the pin: pins_select_visible and city_pins key discovery to
--    p.user_id, and that is deliberately untouched here. A pin posted by a
--    verified man is on the map of everyone whose audience admits a verified
--    man, no matter who has since joined the group. Also the founder's call,
--    and the one thing in this file most likely to be broken by a later
--    "improvement" — hence the test that asserts it.
--
-- 3. JOINING BORROWS THE PIN'S OWN VISIBILITY, not the group's. There is no
--    token. The gate is: the pin is live, and you are somebody the pin's
--    owner is discoverable to (audience both ways, no block in either
--    direction). If you can see it on the map you can join it; if you cannot
--    see it, the id tells you nothing.
--
-- 4. ITS OWN DAILY BUDGET. create_group refuses a sixth group in 24 hours,
--    and that ceiling exists because a group row is durable and carries an
--    invite link. An open pin makes a durable group too, so it is counted —
--    but in its own bucket, with its own sentence, because "You have started
--    a few groups today already" is a baffling thing to be told by a map.
--    Five open pins a day, on top of five groups. The pin ceilings (10 live,
--    30 created per 24h) still apply on top of it.

-- ---------------------------------------------------------------------------
-- 1. The link
-- ---------------------------------------------------------------------------

alter table public.groups
  add column pin_id uuid references public.pins (id) on delete set null;

-- Partial, because every group made any other way has a null here and NULLs
-- are not equal to each other in a plain unique index anyway — stating it as
-- partial says what is meant and keeps the index to the rows that matter. It
-- is also the index the ON DELETE SET NULL needs when expire_pins sweeps.
create unique index groups_pin_idx on public.groups (pin_id) where pin_id is not null;

comment on column public.groups.pin_id is
  'The pin this group opened from, while that pin is alive. Goes null when '
  'the pin expires or is taken down; the group survives that as an ordinary '
  'no-end-date group. Never the other way round: a chat_id on pins would be '
  'deleted with the pin.';

-- ---------------------------------------------------------------------------
-- 2. Posting one
-- ---------------------------------------------------------------------------
--
-- One call, not two. The client could insert the pin (it has the per-column
-- grant) and then ask for a group, but a failure between the two leaves a pin
-- whose poster ticked "anyone can join" and which nobody can join — the one
-- outcome with no honest thing to say to anybody. In one transaction the pin
-- and its group arrive together or neither does.
--
-- SECURITY DEFINER bypasses the pins RLS policies, so user_id and seeded are
-- set here rather than trusted: `pins_insert_own` would have checked them.
-- The four BEFORE INSERT triggers still fire — validate_pin (city, radius,
-- 10 live), throttle_pins (30 per 24h), guests_do_not_broadcast, and the
-- business refusal — because a trigger does not care who is running the
-- insert. That is why none of them is restated here.

create function public.post_joinable_pin(
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

revoke execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date, timestamptz
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reading a pin's group from a function that must stay SECURITY INVOKER
-- ---------------------------------------------------------------------------
--
-- city_pins is invoker on purpose: the pins RLS policies are what decide
-- which rows it may return, and making it a definer would hand that job to a
-- WHERE clause somebody has to remember to keep in step. But `groups` is only
-- readable by its own members (groups_select_member), so an invoker join to
-- it would show a joinable pin as unjoinable to exactly the people who have
-- not joined yet. These two tiny definers are the seam.

create function public.pin_chat(p_pin_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select chat_id from public.groups where pin_id = p_pin_id
$$;

create function public.pin_chat_size(p_pin_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.groups g
    join public.room_members rm on rm.chat_id = g.chat_id and rm.expires_at > now()
   where g.pin_id = p_pin_id
$$;

revoke execute on function public.pin_chat(uuid) from public, anon;
revoke execute on function public.pin_chat_size(uuid) from public, anon;
grant execute on function public.pin_chat(uuid) to authenticated;
grant execute on function public.pin_chat_size(uuid) to authenticated;

comment on function public.pin_chat_size(uuid) is
  'How many people are in a pin''s group, counting the pinner. Answers for '
  'any pin id, which is safe because a pin id is only ever handed to '
  'somebody the pin is already visible to.';

-- ---------------------------------------------------------------------------
-- 4. Joining, with no token and no hello
-- ---------------------------------------------------------------------------

create function public.join_pin_chat(p_pin_id uuid)
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

revoke execute on function public.join_pin_chat(uuid) from public, anon;
grant execute on function public.join_pin_chat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Who is already in
-- ---------------------------------------------------------------------------
--
-- The pin sheet shows faces, so "three people are going" is a thing you can
-- see before you decide. group_members would not do: it is gated on being a
-- member, and the whole point is to show this to somebody who is not one yet.
--
-- No audience test per joiner, and that is the founder's rule stated as code:
-- the filter applies to the pin's OWNER. Somebody outside your audience who
-- joined a plan posted by somebody inside it is at that plan, and pretending
-- otherwise would mean showing you a group of four with two faces in it.
-- Blocks are different from audiences and are still honoured: a person you
-- blocked is not drawn, in either direction.

create function public.pin_crew(p_pin_id uuid)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rm.user_id,
    pr.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = rm.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    rm.role = 'admin',
    rm.joined_at
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.room_members rm on rm.chat_id = g.chat_id and rm.expires_at > now()
  left join public.profiles pr on pr.user_id = rm.user_id
  where p.id = p_pin_id
    and p.expires_at > now()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
    and not public.is_blocked_pair(rm.user_id)
  order by (rm.role = 'admin') desc, rm.joined_at
  limit 20
$$;

revoke execute on function public.pin_crew(uuid) from public, anon;
grant execute on function public.pin_crew(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The map says which pins are open
-- ---------------------------------------------------------------------------
--
-- DROP FIRST, both of them. Postgres will not add an OUT column to an
-- existing RETURNS TABLE through create or replace, and finding that out
-- during a deploy means finding it out after the statements above have
-- already applied. Grants go with the drop, so they are restated.

drop function if exists public.city_pins(int);

create function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  note text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
as $$
  select
    p.id,
    p.user_id,
    pr.display_name,
    pr.age,
    pr.verified,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = p.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    p.venue_name,
    p.note,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    p.seed_note,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.created_at
$$;

revoke execute on function public.city_pins(int) from public, anon;
grant execute on function public.city_pins(int) to authenticated;

drop function if exists public.public_city_pins(int);

create function public.public_city_pins(p_city_id int)
returns table (
  id uuid,
  venue_name text,
  note text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.note,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (
      p.seeded
      or (
        public.is_discoverable_owner(p.user_id)
        and public.discovery_pair_ok(auth.uid(), p.user_id)
      )
    )
  order by p.intent_date, p.created_at
$$;

revoke execute on function public.public_city_pins(int) from public;
grant execute on function public.public_city_pins(int) to anon, authenticated;

comment on function public.public_city_pins(int) is
  'Pins with no person attached, for guests. Honours the owner''s audience: '
  'somebody who narrowed to verified is not on a signed-out visitor''s map '
  'either, which is the half of "who can see you" this used to miss. Now '
  'also says whether a pin is open to join, and how many are in.';
