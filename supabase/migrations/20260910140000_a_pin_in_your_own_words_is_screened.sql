-- A pin in your own words is screened.
--
-- Founder, 2026-09-10: "Agreed we can add pin text into the moderation."
-- And, the same day, on scope: "Only screen the free prose, leave venue
-- names alone."
--
-- ONE TRANSACTION. AGENTS.md records that this deploy path "fails after the
-- migration's earlier statements have already applied". Every statement here
-- is transactional DDL, so a halfway state is designed out rather than
-- tested for.

begin;

-- 1. THE COUNTER. A refusal is an abort and an abort takes any audit row
-- with it (20260901140000:70-73 says so in its own words). A sequence is the
-- one thing Postgres never rolls back, so this is the only trace a block can
-- leave in this database.
create sequence if not exists public.pin_screen_refusals as bigint start 1;
revoke all on sequence public.pin_screen_refusals from public, anon, authenticated;

comment on sequence public.pin_screen_refusals is
  'Bumped once per refused pin write, before the raise, because the raise '
  'rolls back everything else. It counts attempts and never resets, so read a '
  'DIFFERENCE, not a level. nextval WAL-logs every 32nd bump, so a crash can '
  'leave it up to 32 ahead: a smoke alarm, not a ledger.';

-- 2. THE SCREEN. Two calls, never one concat_ws: joining the fields invents
-- matches across a boundary that does not exist (a plan ending "the hook"
-- beside details starting "up on the roof"; a plan "Bangkok for one night"
-- beside a note "Stand by the door at 7"), and it throws away the one thing
-- the person needs told, which box to fix.
--
-- The null guards are what keep OUR OWN writes out, structurally rather than
-- by luck: seed_launch_pins, supabase/seed/launch_pins.sql and
-- scripts/seed-demo-travelers.mjs write neither column, so all three reduce
-- to two null tests and never enter the blocklist loop, whatever the founder
-- later adds to the table.
--
-- SECURITY DEFINER is load-bearing, not habit: execute on
-- screen_first_message is revoked from public, anon and authenticated
-- (20260816200000:465), and the direct-table path runs as `authenticated`,
-- so an invoker-rights trigger would raise 42501 on the path that most needs
-- covering.
create or replace function public.screen_pin_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan is not null
     and (public.screen_first_message(new.plan) ->> 'action') = 'block' then
    perform nextval('public.pin_screen_refusals');
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines', detail = 'plan';
  end if;

  if new.note is not null
     and (public.screen_first_message(new.note) ->> 'action') = 'block' then
    perform nextval('public.pin_screen_refusals');
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines', detail = 'note';
  end if;

  return new;
end
$$;

revoke execute on function public.screen_pin_text() from public, anon, authenticated;

comment on function public.screen_pin_text() is
  'Screens the two pin columns a person composes in their own words, plan and '
  'note, against public.moderation_blocklist. venue_name, place_label and '
  'seed_note are deliberately NOT screened (founder, 2026-09-10): they are '
  'names a geocoder or a business row supplied, or words we wrote, and four '
  'of the eleven patterns match real venues. DETAIL is the column name, from '
  'a closed vocabulary of two, so the app can say which box to reword. It '
  'never names the pattern: that would hand out the evasion rule '
  '(20260822140000:296-298).';

-- 3. THE TRIGGER. The name puts it LAST of the six BEFORE INSERT triggers on
-- pins (no_guests, owner_is_a_traveler, refuse_business, throttle, validate,
-- words_are_screened), because Postgres fires same-timing triggers in name
-- order and 'w' sorts after 'v'. Two reasons. A person who is over a cap, or
-- outside the city radius, or dated in the past, hears about THAT, which is
-- the refusal they can act on and the thing still true after they reword.
-- And the counter then only counts pins that would otherwise have been
-- accepted.
drop trigger if exists pins_words_are_screened on public.pins;
create trigger pins_words_are_screened
  before insert on public.pins
  for each row execute function public.screen_pin_text();

-- 4. THE BORROWED WORDS. copy_plan_from_message re-inserts ANOTHER traveler's
-- plan verbatim under the caller's user_id, so the trigger fires on words the
-- caller never wrote. Without this the copier is accused, and because a block
-- writes no row the accusation is invisible to them and to us.
--
-- The pre-check sits AFTER the already-joined short-circuit and before the
-- insert. Above it, the idempotent second tap - which inserts nothing at all
-- and therefore has nothing to screen - would be refused while the person's
-- own copy of the pin sits on their map.
--
-- It does NOT reuse 'That plan is not open to join any more.' The plan IS
-- open: city_pins still returns it, the map still labels it, and
-- join_pin_chat still lets the same person into the same room from the card.
-- A sentence the map contradicts on the next screen is worse than no
-- sentence. This one is true and it says what to do instead.
--
-- Same signature, no OUT columns, so create or replace is legal and no drop
-- is owed. Grants restated below anyway.
create or replace function public.copy_plan_from_message(p_message_id uuid)
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
  -- answer to the second tap is the pin the first one made. This stays ABOVE
  -- the screen: it writes nothing, so there is nothing to screen.
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

  -- The borrowed-words check. Only reachable for a source pin whose plan
  -- predates this trigger, or one caught by a pattern added later.
  if v_pin.plan is not null
     and (public.screen_first_message(v_pin.plan) ->> 'action') = 'block' then
    perform nextval('public.pin_screen_refusals');
    raise exception 'We cannot add that plan to your map. Put your own pin on the spot and write it in your own words.'
      using errcode = '42501';
  end if;

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

-- 5. THE TWO VIEWS. The screen is INSERT-only and has to be, so a pin already
-- on the map is never read again by anything. That was fine for three days
-- and is not fine for a year, and the blocklist is a table the founder grows
-- without a migration, so "what would today's rules say about what is already
-- up?" gets a new answer every time a pattern is added. These are the only
-- place that question has an answer at all. Service role only, like every
-- other admin_ view here. Added to docs/DASHBOARD.md in the same change.
create or replace view public.admin_pin_screening as
select
  coalesce(pg_sequence_last_value('public.pin_screen_refusals'::regclass), 0)
    as refused_all_time,
  (select count(*) from public.moderation_blocklist) as patterns_live,
  (select count(*) from public.pins where expires_at > now()) as live_pins,
  (select count(*) from public.pins p
    where p.expires_at > now()
      and exists (select 1 from public.moderation_blocklist b
                   where coalesce(p.plan, '') ~* b.pattern
                      or coalesce(p.note, '') ~* b.pattern))
    as live_pins_the_rules_would_refuse;

revoke all on public.admin_pin_screening from public, anon, authenticated;

comment on view public.admin_pin_screening is
  'The pin screen in one row. refused_all_time is the sequence the trigger '
  'bumps before it raises, the only trace a refusal leaves. Read a difference, '
  'not a level. live_pins_the_rules_would_refuse is the other half: what is on '
  'the map right now that today''s blocklist would turn away. It is not zero '
  'by construction, because a pin is screened once and can now stay up for a '
  'year. Check it after adding a pattern.';

create or replace view public.admin_pin_screening_hits as
select
  p.id as pin_id,
  p.user_id,
  p.seeded,
  c.name as city,
  p.created_at,
  p.expires_at,
  b.category as would_refuse_for,
  case when coalesce(p.plan, '') ~* b.pattern then 'plan' else 'note' end as column_name,
  case when coalesce(p.plan, '') ~* b.pattern then p.plan else p.note end as text
from public.pins p
join public.moderation_blocklist b
  on coalesce(p.plan, '') ~* b.pattern or coalesce(p.note, '') ~* b.pattern
left join public.cities c on c.id = p.city_id
where p.expires_at > now()
order by p.created_at desc;

revoke all on public.admin_pin_screening_hits from public, anon, authenticated;

comment on view public.admin_pin_screening_hits is
  'The pins behind live_pins_the_rules_would_refuse, with the words, so a '
  'person can tell a real problem from a bar with an awkward name. A pin here '
  'was legal when it was posted. Nothing is removed automatically. Service '
  'role only.';

-- 6. THE BASELINE. One dated row so the first number anybody compares
-- against is not a guess. Guarded, so a hand re-run cannot double it.
-- subject_user_id is null and the action is not a strike action, so
-- apply_strike_policy returns on its first line.
do $$
begin
  if not exists (
    select 1 from public.moderation_events
     where entity_type = 'pin' and action = 'screen_installed'
  ) then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (null, 'pin', null, 'screen_installed', 'prefilter-v1',
       jsonb_build_object(
         'live_pins', (select count(*) from public.pins where expires_at > now()),
         'would_refuse', (select count(*) from public.pins p
                           where p.expires_at > now()
                             and exists (select 1 from public.moderation_blocklist b
                                          where coalesce(p.plan, '') ~* b.pattern
                                             or coalesce(p.note, '') ~* b.pattern)),
         'patterns', (select count(*) from public.moderation_blocklist),
         'columns', jsonb_build_array('plan', 'note')));
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

-- WHAT HAPPENS TO THE ROWS THAT ALREADY EXIST: nothing. No backfill, no
-- re-screening, no write to any existing row. The trigger governs new rows
-- only. Production holds 57 pins today, 45 of them curated seeds, and zero
-- have a non-null plan or note, so the screen ships onto a surface with no
-- rows in it at all: admin_pin_screening_hits returns empty and the baseline
-- row records would_refuse = 0. It stays clean only by luck after that,
-- which is what the two views are for.