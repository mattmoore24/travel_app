-- A pin in a conversation, who reacted, and a group that records its churn
-- =============================================================================
--
-- Three packages, one file, because one file is what this session was given.
-- They are kept apart below and each says what it is for.
--
--   1. A PIN IN A CONVERSATION. `messages.pin_id`, so the map and the chat
--      finally touch, plus the read path that renders it. Hard rule 3 is the
--      live wire: an embedded pin has to become unreadable at expiry like
--      every other pin, so the RPC nulls it rather than trusting the client
--      to hide it.
--   2. WHO REACTED, in rooms and groups only. A one-to-one chat has exactly
--      two people in it, so naming the reactor there is a reciprocal-interest
--      reveal by another route, which is the thing §7 exists to stop. The
--      refusal is in this function, not in the screen.
--   3. A GROUP RECORDS ITS CHURN. Joined, left, removed, and the end date
--      moving. Emitted by TRIGGERS on room_members and groups rather than by
--      restating six functions: create_group, post_joinable_pin,
--      join_pin_chat, join_group_with_invite, add_to_group and
--      allow_group_rejoin all write the same two tables, and a trigger cannot
--      be forgotten by the seventh path somebody adds next month. The origin
--      line the package also asked for ("Ana started this group") is NOT in;
--      the report says why, and groups_log_arrival's own comment repeats it
--      where somebody would go looking.
--
-- ENUM VALUES AND THE ONE-TRANSACTION RULE. Part 3 adds three values to
-- public.message_kind, and `alter type ... add value` cannot be followed by a
-- USE of that value in the same transaction (20260827090000 is the migration
-- that exists solely because of this). The Supabase CLI wraps a migration in
-- one transaction, so every new value below is reached at RUN time and never
-- at CREATE time: the writer takes its kind as `text` and casts inside a
-- plpgsql body, and no statement in this file mentions 'left', 'removed' or
-- 'ends' anywhere Postgres would resolve it while the migration is still
-- open. Do not "tidy" those casts into enum literals.

-- ===========================================================================
-- 1. A pin in a conversation
-- ===========================================================================
--
-- The link points from the MESSAGE to the pin, with `on delete set null` —
-- the same direction and the same reason as groups.pin_id (20260829120000):
-- pins are hard-deleted at 72 hours, and a conversation must not go with one.

alter table public.messages
  add column pin_id uuid references public.pins (id) on delete set null;

create index messages_pin_idx on public.messages (pin_id) where pin_id is not null;

comment on column public.messages.pin_id is
  'A plan attached to this message, while that pin is alive. Goes null when '
  'the pin expires or is taken down (hard rule 3), which is also what stops '
  'a chat becoming a way to read an expired pin.';

-- `messages` carries TABLE-level grants (20260816220000:57-58 revokes from
-- anon and narrows authenticated by statement, never by column), so this
-- column rides the grant that is already there and `select *` keeps working.
-- 31_select_star_stays_readable.test.sql is the proof and stays the proof: a
-- column-level grant on this table would need this comment rewritten and
-- pin_id granted here.

-- A message can only carry its sender's OWN, LIVE pin -------------------------
--
-- A check constraint cannot ask this — it needs a subquery — so it is a
-- trigger, the same shape messages_reply_same_chat takes and for the same
-- reason. SECURITY DEFINER on purpose: the question is about the DATA ("whose
-- pin is this, and is it still alive"), not about what the writer happens to
-- be allowed to read. As an invoker query a pin hidden by RLS would look
-- identical to somebody else's pin, which is the right answer by luck.

create function public.messages_pin_is_own_and_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pin_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.pins p
     where p.id = new.pin_id
       and p.user_id = new.sender_id
       and p.expires_at > now()
  ) then
    raise exception 'You can only send a plan of your own that is still on.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke execute on function public.messages_pin_is_own_and_live() from public, anon, authenticated;

create trigger messages_pin_is_own_and_live
  before insert on public.messages
  for each row execute function public.messages_pin_is_own_and_live();

-- Joining a plan somebody sent you ------------------------------------------
--
-- "Join this plan" on the card in the thread posts the tapper's OWN pin at the
-- same venue, on the same day. Not join_pin_chat: that door is for the map,
-- it only exists for pins posted in the "anyone can join" shape, and in a
-- group it usually leads back to the room you are already standing in. A
-- second pin is the answer that means something — it is what puts the plan
-- agreed in a chat onto the map and into the heat, which is the whole reason
-- the package exists.
--
-- SECURITY DEFINER so the source pin can be read without the caller having to
-- pass the map's discovery filter — they were handed this plan in a
-- conversation they are in, which is the gate. The four BEFORE INSERT triggers
-- on `pins` still fire, because a trigger does not care who runs the insert:
-- validate_pin (city active, inside the radius, ten live), throttle_pins (30
-- in 24 hours), guests_do_not_broadcast, and the business refusal. None of
-- them is restated here, exactly as post_joinable_pin does not restate them.
--
-- expires_at is COPIED rather than recomputed. The new pin is a second pin for
-- the same evening, so it should go dark when that evening does, and copying
-- cannot overrun rule 3's ceiling: the source is already at most 72 hours from
-- ITS creation, and the copy is created later.

create function public.copy_plan_from_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pin public.pins%rowtype;
  v_chat uuid;
  v_existing uuid;
  v_new uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('join a plan');

  select m.chat_id into v_chat from public.messages m where m.id = p_message_id;
  if v_chat is null
     or not (public.is_chat_member(v_chat)
             or public.is_room_member(v_chat)
             or public.is_room_moderator(v_chat)) then
    -- One sentence for every way this can fail. A caller cannot tell "no such
    -- message" from "not your conversation", which is the point: the
    -- alternative is an endpoint that answers "am I in this chat" for any uuid.
    raise exception 'That plan is not open to join any more.' using errcode = '42501';
  end if;

  select p.* into v_pin
    from public.messages m
    join public.pins p on p.id = m.pin_id
   where m.id = p_message_id
     and m.unsent_at is null
     and m.removed_at is null
     and p.expires_at > now();
  if not found then
    raise exception 'That plan is not open to join any more.' using errcode = '42501';
  end if;

  -- Already going. Ten taps must not make ten identical pins, and the honest
  -- answer to the second tap is the pin the first one made.
  select p.id into v_existing
    from public.pins p
   where p.user_id = v_user
     and p.venue_name = v_pin.venue_name
     and p.intent_date = v_pin.intent_date
     and p.expires_at > now()
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- intent_time and business_id come from 20260902190000, which lands just
  -- before this file. They are copied because a plan that loses its hour or
  -- its venue on the way into somebody else's map is not the same plan.
  insert into public.pins
    (user_id, city_id, business_id, venue_name, plan, note, place_label, category,
     lat, lng, intent_date, intent_time, expires_at)
  values
    (v_user, v_pin.city_id, v_pin.business_id, v_pin.venue_name, v_pin.plan, null,
     v_pin.place_label, v_pin.category, v_pin.lat, v_pin.lng, v_pin.intent_date,
     v_pin.intent_time, v_pin.expires_at)
  returning id into v_new;

  -- `note` is deliberately not copied: it is the other person's own words
  -- about their evening, and putting them under somebody else's name is
  -- exactly the borrowed-voice problem the plan/venue split was made to fix.
  return v_new;
end
$$;

revoke execute on function public.copy_plan_from_message(uuid) from public, anon;
grant execute on function public.copy_plan_from_message(uuid) to authenticated;

comment on function public.copy_plan_from_message(uuid) is
  'Post your own pin at the venue and day of a plan somebody sent into a chat '
  'you are in. Returns the pin id, or the one you already have for that venue '
  'and day. Refuses an expired plan (hard rule 3) and a chat you are not in.';

-- ===========================================================================
-- 2. Who reacted — rooms and groups only
-- ===========================================================================
--
-- `c.kind = 'room'` is the whole rule, and it is here rather than in the
-- client because a client-side rule is a suggestion. Both a direct chat
-- ('direct') and a traveler-to-business chat ('business') have exactly two
-- people in them, so "who reacted" there names the only other person present:
-- a reciprocal-interest reveal, arrived at from the side. Rooms and groups are
-- both chats.kind = 'room', which is why one comparison covers both surfaces.
--
-- Membership or moderation is the second gate, and is_public_room is
-- deliberately NOT a third: a signed-out visitor reading a hostel's public
-- preview must not be able to enumerate who is in it. `anon` gets no execute
-- grant at all, which says the same thing twice on purpose.

create function public.message_reactors(p_message_id uuid)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  emoji text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.user_id,
    p.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = r.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.emoji
  from public.message_reactions r
  join public.messages m on m.id = r.message_id
  join public.chats c on c.id = m.chat_id
  left join public.profiles p on p.user_id = r.user_id
  where r.message_id = p_message_id
    and c.kind = 'room'
    and (public.is_room_member(m.chat_id) or public.is_room_moderator(m.chat_id))
  order by r.created_at
$$;

revoke execute on function public.message_reactors(uuid) from public, anon;
grant execute on function public.message_reactors(uuid) to authenticated;

comment on function public.message_reactors(uuid) is
  'Who reacted to one message, with the emoji each of them used. Rooms and '
  'groups only: a direct or business chat has two people in it, so naming the '
  'reactor there would be a reciprocal-interest reveal. Members and '
  'moderators only, and never anon.';

-- ===========================================================================
-- 3. A group records its churn
-- ===========================================================================
--
-- A hostel room's defining property is churn: people land, people fly out.
-- With no membership events the header count goes from nine to six and nobody
-- can tell who went, and a group with no origin line reads as one somebody
-- dropped you into rather than one you were invited to.
--
-- SCOPED TO TRAVELER GROUPS, never to a business's room. A join/leave log is a
-- record of who was where and when, and a business room is READABLE
-- SIGNED-OUT wherever the business left its public preview on
-- (room_messages' is_public_room arm) — so the same rows that make a group
-- legible would publish a hostel's guest list to anybody who can see the
-- hostel. Every trigger below returns early unless the chat has a `groups`
-- row. Part 1's rewrite of room_messages closes the other half: a
-- public-preview reader gets no system lines at all, whatever kind of room
-- it is.
--
-- NULL SENDER, NOT TAKEN. The package asked for these rows to carry a null
-- sender. The shipped convention (20260831130000) is the opposite and it is
-- followed here: `messages.sender_id` is NOT NULL, the existing 'joined' line
-- carries the arriving person, and messages_kind_is_earned already refuses a
-- non-'said' kind from `authenticated` or `anon`, so the system voice cannot
-- be forged without it. Rule 5 is satisfied the same way it already is for
-- 'joined': the row is written by a SECURITY DEFINER path with
-- moderation_status = 'approved', because a line the room wrote has no author
-- to moderate.

alter type public.message_kind add value if not exists 'left';
alter type public.message_kind add value if not exists 'removed';
alter type public.message_kind add value if not exists 'ends';

-- The one writer. Its kind is TEXT and the cast happens when it runs, which
-- is what keeps the three values above out of this transaction (see the
-- header).
create function public.log_membership_line(
  p_chat_id uuid,
  p_user_id uuid,
  p_kind text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.messages (chat_id, sender_id, body, kind, moderation_status)
  values (p_chat_id, p_user_id, p_body, p_kind::public.message_kind, 'approved');
end
$$;

revoke execute on function public.log_membership_line(uuid, uuid, text, text)
  from public, anon, authenticated;

-- Arrivals -------------------------------------------------------------------
--
-- AFTER insert, and that ordering is load-bearing: join_pin_chat writes its
-- own "X is in" line guarded by `if not exists (… kind = 'joined')`, so by
-- firing first this trigger makes that insert a no-op instead of a duplicate.
-- Its sentence is matched exactly for a pin-born group for the same reason
-- (32_a_join_is_felt asserts the words).
--
-- Once per person per chat, which means a leave-and-rejoin stays silent. That
-- is the shipped rule, in join_pin_chat's own words — "a leave-and-rejoin is
-- the same arrival, and announcing it twice would read as a glitch" — and
-- 32_a_join_is_felt pins it.
--
-- Two silences worth stating, because both look like omissions:
--
--   * auth.uid() null is a seeder, a console or a sweep. A membership row
--     with no actor behind it is not an arrival anybody made, and announcing
--     one would put a sentence in a thread with nobody's name on it.
--   * THE FOUNDING MEMBERSHIP. create_group and post_joinable_pin both write
--     the creator's own room_members row, and "Ana joined" in the group Ana
--     has just made is nonsense. The package asked for an origin line here
--     ("Ana started this group"); see the report — it is the one part of this
--     package that is not in, because it puts a row in every brand-new group
--     and two pgTAP files this session does not own count the messages in a
--     brand-new group.

create function public.groups_log_arrival()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by uuid;
  v_from_pin boolean;
  v_name text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select g.created_by, g.pin_id is not null
    into v_created_by, v_from_pin
    from public.groups g
   where g.chat_id = new.chat_id;
  -- No groups row: a business's room. Not logged, on purpose — see the
  -- section header.
  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.messages m
     where m.chat_id = new.chat_id
       and m.sender_id = new.user_id
       and m.kind::text = 'joined'
  ) then
    return new;
  end if;

  -- The founding membership, in a thread with nothing in it yet.
  if new.user_id = v_created_by
     and not exists (select 1 from public.messages m where m.chat_id = new.chat_id) then
    return new;
  end if;

  select coalesce(p.display_name, 'Somebody') into v_name
    from public.profiles p where p.user_id = new.user_id;
  v_name := coalesce(v_name, 'Somebody');

  perform public.log_membership_line(
    new.chat_id,
    new.user_id,
    'joined',
    case when v_from_pin then v_name || ' is in' else v_name || ' joined' end
  );
  return new;
end
$$;

revoke execute on function public.groups_log_arrival() from public, anon, authenticated;

create trigger room_members_log_arrival
  after insert on public.room_members
  for each row execute function public.groups_log_arrival();

-- Departures -----------------------------------------------------------------
--
-- Who ran the DELETE is the whole difference between "left" and "was removed",
-- and auth.uid() answers it: SECURITY DEFINER changes the role, never the JWT,
-- so leave_room reports the leaver and room_remove_member reports the
-- moderator. auth.uid() null is the expiry sweep (expire_room_members) or a
-- console, and a membership running out is not something anybody did.
--
-- THE TWO GUARDS ARE NOT DECORATION. room_members cascades from both `chats`
-- and `users`, and in a cascade the parent row is already gone — so writing a
-- message row here would fail the foreign key and take the whole delete with
-- it. Deleting an account or unmatching a chat would start raising.

create function public.groups_log_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
begin
  if v_actor is null then
    return old;
  end if;
  if not exists (select 1 from public.groups g where g.chat_id = old.chat_id) then
    return old;
  end if;
  -- Mid-cascade: the chat or the person is already gone, so there is nothing
  -- to hang a message on and nothing worth saying.
  if not exists (select 1 from public.chats c where c.id = old.chat_id)
     or not exists (select 1 from public.users u where u.id = old.user_id) then
    return old;
  end if;

  select coalesce(p.display_name, 'Somebody') into v_name
    from public.profiles p where p.user_id = old.user_id;
  v_name := coalesce(v_name, 'Somebody');

  if v_actor = old.user_id then
    perform public.log_membership_line(old.chat_id, old.user_id, 'left', v_name || ' left');
  else
    perform public.log_membership_line(
      old.chat_id, old.user_id, 'removed', v_name || ' was removed');
  end if;
  return old;
end
$$;

revoke execute on function public.groups_log_departure() from public, anon, authenticated;

create trigger room_members_log_departure
  after delete on public.room_members
  for each row execute function public.groups_log_departure();

-- The end date moving --------------------------------------------------------
--
-- A trigger rather than a restatement of update_group, for the reason at the
-- top of part 3 and one more: update_group is the function most likely to grow
-- another field, and a line emitted from the column itself cannot be dropped
-- by whoever grows it.
--
-- to_char with an explicit pattern, not a locale-dependent cast. This prints a
-- DAY and never an hour, so it is outside the one-clock rule (lib/locale's
-- clocks() owns anything with a time in it); the shape matches what
-- features/trips/dates formatDate renders on the same screen.

create function public.groups_log_end_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return new;
  end if;
  if new.max_stay_until is not distinct from old.max_stay_until then
    return new;
  end if;
  perform public.log_membership_line(
    new.chat_id,
    v_actor,
    'ends',
    case
      when new.max_stay_until is null then 'This group no longer has an end date.'
      else 'This group is now active until ' || to_char(new.max_stay_until, 'FMMon FMDD') || '.'
    end
  );
  return new;
end
$$;

revoke execute on function public.groups_log_end_date() from public, anon, authenticated;

create trigger groups_log_end_date
  after update on public.groups
  for each row execute function public.groups_log_end_date();

-- No push for a line nobody wrote --------------------------------------------
--
-- Body restated whole from 20260831130000_a_join_is_felt.sql, which is the
-- live version; the only change is the second guard, which returns before the
-- fan-out for every kind that is not somebody talking. Without it every
-- departure line would ring the whole group's phones.
--
-- `new.kind::text <> 'said'` rather than a list of the new values: comparing
-- as text keeps this statement free of enum labels this transaction has only
-- just added (see the header), and it also covers whatever kind is added next.
--
-- create-or-replace ONLY, never a drop: the messages_push trigger depends on
-- this function and a drop would take the trigger with it.

create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_room text;
  v_text text;
  v_going int;
begin
  -- An arrival rings the host and nobody else. One row, addressed to
  -- groups.created_by, titled with the plan, only while this is among the
  -- first five joins — past that a popular plan would machine-gun the
  -- host's phone, which is why the cap lives on this side and not in
  -- join_pin_chat. The count includes the row that fired this trigger, so
  -- joins one to five push and the sixth is the first that does not.
  --
  -- A PLAN ONLY (`g.pin_id is not null`, below). This branch was written for
  -- the map's hero payoff — somebody tapping "Join this plan" for tonight —
  -- and the arrival line now covers every kind of group, so without that test
  -- adding two people to an ordinary group would ring its admin twice for a
  -- room they are already looking at. 11_groups_support asserts the admin is
  -- never pushed, and it is right to.
  if new.kind = 'joined' then
    select count(*) into v_going
      from public.room_members rm
     where rm.chat_id = new.chat_id
       and rm.archived_at is null
       and rm.expires_at > now();

    insert into public.push_queue (user_id, title, body, data)
    select g.created_by,
           coalesce(p.venue_name, g.name),
           new.body || case when v_going > 1
             then '. That makes ' || v_going || '.'
             else '.' end,
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'room')
      from public.groups g
      left join public.pins p on p.id = g.pin_id
      join public.room_members rm
        on rm.chat_id = new.chat_id and rm.user_id = g.created_by
      left join public.chat_prefs pref
        on pref.chat_id = new.chat_id and pref.user_id = g.created_by
     where g.chat_id = new.chat_id
       and g.pin_id is not null
       and g.created_by is not null
       and g.created_by <> new.sender_id
       -- The same mute tests the fan-out below applies to every member.
       and not rm.muted
       and coalesce(pref.muted, false) = false
       and rm.archived_at is null
       and rm.expires_at > now()
       and (select count(*) from public.messages m
             where m.chat_id = new.chat_id and m.kind = 'joined') <= 5;

    return new;
  end if;

  -- Every other line the ROOM wrote — started, left, removed, end date moved.
  -- The thread shows them; nobody's phone rings for them. A group of nine
  -- turning over would otherwise push nine times a day about nothing anybody
  -- typed.
  if new.kind::text <> 'said' then
    return new;
  end if;

  select display_name into v_name from public.profiles where user_id = new.sender_id;
  v_text := coalesce(
    nullif(left(new.body, 140), ''),
    case when new.image_path is not null then 'Photo' else 'New message' end
  );

  -- Direct chats: the sender is the title.
  insert into public.push_queue (user_id, title, body, data)
  select cp.user_id,
         coalesce(v_name, 'New message'),
         v_text,
         jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'direct')
  from public.chat_participants cp
  left join public.chat_prefs pref
    on pref.chat_id = new.chat_id and pref.user_id = cp.user_id
  where cp.chat_id = new.chat_id
    and cp.user_id <> new.sender_id
    -- The bell the person actually pressed. This arm had no mute test at all,
    -- so muting a conversation struck the bell through, hid the badge, and
    -- kept ringing the phone.
    and coalesce(pref.muted, false) = false;

  -- Rooms and groups: the room is the title, the sender opens the body.
  select coalesce(b.name, g.name) into v_room
    from public.chats c
    left join public.businesses b on b.chat_id = c.id
    left join public.groups g on g.chat_id = c.id
   where c.id = new.chat_id and c.kind = 'room';

  if v_room is not null then
    insert into public.push_queue (user_id, title, body, data)
    select rm.user_id,
           v_room,
           case when v_name is null then v_text else v_name || ': ' || v_text end,
           jsonb_build_object('type', 'message', 'chat_id', new.chat_id, 'kind', 'room')
    from public.room_members rm
    left join public.chat_prefs pref
      on pref.chat_id = new.chat_id and pref.user_id = rm.user_id
    where rm.chat_id = new.chat_id
      and rm.user_id <> new.sender_id
      -- Both, because `room_members.muted` predates chat_prefs and older paths
      -- still set it, while `authenticated` has no grant to write it — so the
      -- mute a person can actually perform lives in chat_prefs.
      and not rm.muted
      and coalesce(pref.muted, false) = false
      and rm.archived_at is null
      and rm.expires_at > now();
  end if;

  return new;
end
$$;

revoke execute on function public.enqueue_message_push() from public, anon, authenticated;

-- ===========================================================================
-- room_messages: the pin, and who may read a line the room wrote
-- ===========================================================================
--
-- DROP FIRST. `create or replace` cannot add an OUT column to a RETURNS TABLE
-- signature: Postgres refuses, and the deploy fails AFTER the statements above
-- have already applied. Both live signatures are dropped, and the grant is
-- restated, because the drop takes it with it.
--
-- Body restated from the LIVE version (20260901220000_reply_to_a_message.sql)
-- with two changes:
--
--   * the pin the message carries, joined and gated on `p.expires_at > now()`
--     — hard rule 3 says an expired pin is unreadable, and a chat must not
--     become the way around that. The nulling is here rather than in the app
--     because a client-side hide is not an enforcement.
--   * a reader who is only previewing a public room gets no pin fields and no
--     system lines. The pin half stops a traveler's plan (venue, day, their
--     own words) leaking to a signed-out visitor who happens to be able to see
--     the business. The system half stops a membership log ever becoming a
--     published guest list, whatever kind of room it is written in.
--
-- SECURITY DEFINER means the pins policies do not run here, which is
-- deliberate and is the same call pin_for_group made: somebody in the chat is
-- already in the room with these people, so the pin owner's discovery filter
-- must not hide the plan they were handed. Membership is the gate.

drop function if exists public.room_messages(uuid, int);
drop function if exists public.room_messages(uuid, int, timestamptz);

create function public.room_messages(
  p_chat_id uuid,
  p_limit int default 60,
  p_before timestamptz default null
)
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  photo_path text,
  body text,
  image_path text,
  removed boolean,
  unsent_at timestamptz,
  created_at timestamptz,
  -- 'none'     — no photo on this message
  -- 'ready'    — cleared, and image_path above is real
  -- 'checking' — with the worker now; the app draws the review tile
  -- 'blocked'  — refused. Rare on this path: apply_chat_photo_verdict also
  --              sets removed_at, so the thread usually shows it as removed
  --              before this is ever read.
  photo_state text,
  -- 'said' is a person talking; everything else is the room recording a fact
  -- about itself. The thread renders the rest as centred lines, never as
  -- bubbles somebody appears to have typed.
  kind public.message_kind,
  -- What this message answers. The id is what the app scrolls to one day; the
  -- name and the line are what it draws now.
  reply_to_message_id uuid,
  -- The parent sender's DISPLAY NAME and never a handle. Hard rule 4: a handle
  -- is invisible until an accepted one-to-one chat, and a room is neither.
  reply_to_name text,
  -- Null once the parent is unsent or taken down, rather than a preserved copy
  -- of something the reader is no longer allowed to see. The id survives, so
  -- the strip still says the message was an answer.
  reply_to_body text,
  -- The plan attached to this message, while it is still on. All four go null
  -- together at expiry, so the card simply stops being drawn rather than
  -- becoming a stale clock.
  pin_id uuid,
  pin_venue_name text,
  pin_plan text,
  pin_category public.pin_category,
  pin_intent_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.sender_id,
    p.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = m.sender_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    m.body,
    -- The sender sees their own picture while it is being checked; everybody
    -- else waits for the verdict. This gives away nothing: the storage read
    -- policy `chat_photos_select_own` already lets somebody read their own
    -- upload, so a path they cannot use is the only thing that was being
    -- withheld — and withholding it meant the person who took the photo got a
    -- blank tile telling them their own picture was under review.
    case
      when m.moderation_status = 'approved' or m.sender_id = auth.uid() then m.image_path
      else null
    end,
    m.removed_at is not null,
    m.unsent_at,
    m.created_at,
    case
      when m.image_path is null then 'none'
      when m.moderation_status = 'approved' then 'ready'
      when m.moderation_status = 'rejected' then 'blocked'
      else 'checking'
    end,
    m.kind,
    m.reply_to_message_id,
    (select rp.display_name
       from public.messages r
       left join public.profiles rp on rp.user_id = r.sender_id
      where r.id = m.reply_to_message_id),
    (select case
              when r.unsent_at is not null or r.removed_at is not null then null
              else r.body
            end
       from public.messages r
      where r.id = m.reply_to_message_id),
    pin.id,
    pin.venue_name,
    pin.plan,
    pin.category,
    pin.intent_date
  from public.messages m
  left join public.profiles p on p.user_id = m.sender_id
  -- Members and moderators only. A public-preview reader gets the message and
  -- no plan: a pin is a traveler's own future intent, gated on the map by
  -- audience and blocks, and a room somebody left open to the world is not a
  -- way around that gate.
  left join public.pins pin
    on pin.id = m.pin_id
   and pin.expires_at > now()
   and (public.is_room_member(p_chat_id) or public.is_room_moderator(p_chat_id))
  where m.chat_id = p_chat_id
    and (p_before is null or m.created_at < p_before)
    -- Unchanged, and it governs the quoted columns too: a non-member gets no
    -- rows at all, so there is nothing for the reply fields to leak out of.
    and (
      public.is_room_member(p_chat_id)
      or public.is_room_moderator(p_chat_id)
      or public.is_public_room(p_chat_id)
    )
    -- A line the room wrote about its own membership is only for the people
    -- in it. Written as `= 'said'` with an OR rather than `<> 'said'` so a
    -- kind added later is hidden from a visitor by default rather than
    -- published by default.
    and (
      m.kind = 'said'
      or public.is_room_member(p_chat_id)
      or public.is_room_moderator(p_chat_id)
    )
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200))
$$;

grant execute on function public.room_messages(uuid, int, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
