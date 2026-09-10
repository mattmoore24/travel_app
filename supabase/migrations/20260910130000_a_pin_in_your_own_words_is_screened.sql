-- A PIN'S OWN WORDS GO THROUGH THE BLOCKLIST. THE NAMES ON IT DO NOT.
--
-- Founder, 2026-09-10: "Agreed we can add pin text into the moderation," then,
-- on scope, the same day: "Only screen the free prose, leave venue names
-- alone." That ruling is settled. This file builds it.
--
-- Six user-text surfaces already screen from a trigger (profiles
-- 20260817150000:210, profile_prompts 20260822160000:70, profile_priorities
-- 20260827080000:73, businesses 20260827100000:394, business_posts
-- 20260827110000:389, group photos 20260817200000:246). Pins screen nothing:
-- the six triggers on the table validate, throttle, refuse guests, refuse
-- businesses, check the owner is a traveler and stamp groups on delete, and
-- post_joinable_pin inserts all four strings verbatim (20260904120000:892-903).
--
-- WHY NOW. The 72-hour hard delete was the containment - anything nasty
-- removed itself within three days, so nobody had to read it.
-- 20260905200000_gone_when_your_plan_is_over.sql lets the traveler pick the
-- take-down date, up to a year out. That containment is going away, and this
-- replaces it. The two files ship in the same push, in that order (see DEPLOY
-- at the bottom).
--
-- ---------------------------------------------------------------------------
-- WHICH COLUMNS ARE PROSE, established from the write paths and the client,
-- not from the column names, because the split is NOT the obvious one.
-- ---------------------------------------------------------------------------
--
--   plan    SCREENED. `useState('')` at pin-form-sheet.tsx:164 - it starts
--           EMPTY and nothing ever pre-fills it. Its only writer is the
--           "What's the plan?" TextInput (testID plan-input, :651-654).
--           Column comment 20260831170000:24: "in their own words".
--
--   note    SCREENED. `useState('')` at :165, same shape. Its only writer is
--           the "Details" TextInput (testID note-input, :671-679). These two
--           are the whole of what a person composes on a pin.
--
--   venue_name   NOT SCREENED, and this is a deliberate trade rather than a
--           claim about the column. It is a name BY DEFAULT (a MapKit result,
--           a business row, or a reverse geocode) but it sits in a live,
--           editable TextInput (testID venue-name-input, :465-485) and the
--           code says why in as many words at :161-165: "editable, because
--           'Somdet Phra Pokklao Bridge' is where you are, not necessarily
--           what you would call it". At submit it is
--           `(venue.trim() || placeLabel || cityName)` (:386), so when nobody
--           named the spot the geocoded ADDRESS lands in it. It can hold typed
--           prose. The founder exempted it anyway, and FOUR of the eleven
--           patterns are why: \ysexy\y, \yhook\s*(up|ups)\y, \ynudes?\y and
--           \yone\s*night\s*stand\y. Run against the live blocklist on
--           2026-09-10, every one of "Sexy Fish", "The Hook Up", "Nude
--           Espresso", "Nude Seafood" and "One Night Stand" comes back BLOCK;
--           "Dick's Last Resort" and "Din Tai Fung" come back allow. Refusing
--           a real plan at a real bar because of the bar's name is a defect,
--           and since a block writes no audit row it is an invisible one.
--           The founder named two patterns; it is four. Nobody should
--           re-derive this exemption from two examples and find the other two
--           the hard way.
--
--   place_label  NOT SCREENED. No TextInput binds it anywhere on the pin path:
--           it is set from placeLabelFor() (:763-766), business.address or
--           initialLabel at init, and from the reverse-geocode effect
--           (:266-292) after that. `setPlaceLabel` has exactly two call sites,
--           both machine-fed. It is also the column most certain to carry a
--           business's NAME rather than a street: both geocode paths build the
--           label as `[place.name ?? place.street, ...]`
--           (pin-form-sheet.tsx:277-279, map-screen.tsx:1391-1393) and
--           expo-location documents `name` as the placemark name, "Tower
--           Bridge". "Sexy Fish, Mayfair" is the exact string that code
--           produces standing outside that restaurant.
--           NOTE FOR THE NEXT READER: pins.place_label and
--           businesses.place_label are opposite things behind one name. The
--           business one is typed by an owner (business-edit.tsx:710) and IS
--           screened (20260827100000:394). That precedent reads like an
--           argument to screen this column and is in fact the argument
--           against it. Name the table, never just the column.
--
--   seed_note    NOT SCREENED. Curated rows only - `check (seed_note is null
--           or seeded)` (20260816210000:58) - and absent from authenticated's
--           per-column INSERT grant (confirmed against production: the grant
--           is business_id, category, city_id, expires_at, intent_date,
--           intent_time, lat, lng, note, place_label, plan, user_id,
--           venue_name). No client can write it. Our words, not a person's.
--
-- ---------------------------------------------------------------------------
-- INSERT ONLY. The grants are the reason, not an assumption.
-- ---------------------------------------------------------------------------
--
-- `revoke update, truncate, references, trigger on public.pins from
-- authenticated` (20260816210000:161) has never been undone. The complete set
-- of grant/revoke statements touching public.pins in this repo is
-- 20260816210000:158,:161; 20260828150000:24,:26; 20260831170000:32;
-- 20260902190000:67 - and none of the last four mentions UPDATE. Production
-- agrees: authenticated holds INSERT and SELECT on this table and nothing
-- else. There has never been an UPDATE policy either; the only policies ever
-- created are pins_select_own, pins_select_visible, pins_insert_own and
-- pins_delete_own. Pins are immutable to the client, and the remedy for a
-- refused pin is delete and repost, which pins_delete_own already allows.
--
-- This is the opposite of profiles, whose screen is BEFORE UPDATE
-- (20260817150000:210) because a profile row is created empty and then edited.
-- Adding OR UPDATE here would buy nothing today and plant the landmine
-- 20260903060000:34-42 already paid for: a pattern added to the blocklist
-- later makes an unrelated write to an old row raise on text nobody changed.
-- 20260905200000's plan_ends_at backfill is exactly such a write, and it runs
-- as the migration role over every pin on the map.
--
-- ---------------------------------------------------------------------------
-- A TRIGGER, NOT A CHECK INSIDE post_joinable_pin.
-- ---------------------------------------------------------------------------
--
-- Three client-reachable paths end in an insert into public.pins and only one
-- of them is that function:
--   1. post_joinable_pin  (granted to authenticated, 20260904120000:942)
--   2. copy_plan_from_message (granted to authenticated, 20260902200000:196)
--   3. POST /rest/v1/pins straight at the table under pins_insert_own, whose
--      per-column grant still includes note and plan (20260828150000:26-37,
--      20260831170000:32). The app abandoned it - hooks.ts:197-236 routes both
--      pin shapes through the RPC and api.ts:128 `createPin` has no caller -
--      but the grant was never revoked and the anon key ships inside the app.
--      "The client does not do it" is not a control; the grant is
--      (20260828150000:14-18). tests/live/live-backend.mjs:778 posts through
--      that path today, with anon-key power only, to prove a business cannot.
-- A BEFORE INSERT trigger covers all three, and both seeders, for free. It is
-- why the six existing text screens are all triggers.
--
-- SECURITY DEFINER IS LOAD-BEARING. Execute on screen_first_message is revoked
-- from public, anon and authenticated (20260816200000:465). Path 3 runs as
-- `authenticated`, so an invoker-rights trigger would raise 42501 on exactly
-- the path that most needs covering.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COSTS. Measured on production, not guessed.
-- ---------------------------------------------------------------------------
--
-- screen_first_message is a pure regex prefilter over
-- public.moderation_blocklist (20260816200000:445-463). It makes no API call
-- and spends nothing against moderation_spend / claim_moderation_budget, which
-- govern the LLM worker alone. Timed on production over 2000 iterations: 55.93
-- us for an allow verdict with all eleven patterns tried, against 13.53 us for
-- one of the two count queries validate_pin and throttle_pins already run on
-- every insert. Two columns screened is about four of those counts, on a
-- statement that already takes two advisory locks, runs a haversine against
-- launch_cities and looks up a business by name. Production holds 57 pins in
-- total, capped at 10 live and 30 a day per person. There is no hot path here.

-- ---------------------------------------------------------------------------
-- 1. THE ONE WRITE A REFUSAL CANNOT ROLL BACK
-- ---------------------------------------------------------------------------
--
-- Every trigger screen in this schema raises, and 20260901140000:70-73 says
-- what that costs in its own words: "No audit row here: the raise aborts this
-- transaction, so an insert could never persist." That was tolerable while a
-- pin lived three days. It is not tolerable when the founder can add a pattern
-- in month seven and start refusing real plans with nothing written down
-- anywhere - the same invisibility the founder's own reasoning objects to.
--
-- There is no way to write a ROW and refuse in one transaction. The refusal is
-- an abort, and an abort takes every row with it, including an audit row
-- inserted one line earlier. The alternatives were considered and rejected:
--   * return a verdict instead of raising, the way send_message_request does
--     (20260816200000:541-546, the only audited screen in this schema). That
--     needs the client to read the verdict, and an installed build that does
--     not would read a 200 with no pin_id as SUCCESS - closing the sheet,
--     firing pin_created, and telling somebody their plan is on the map when
--     it is not. A build in the wild stays in the wild for weeks.
--   * an autonomous transaction over dblink. dblink is available on this
--     project but not installed, and it needs a stored credential to connect
--     to its own database. A password in the schema to count a rare event is
--     a bad trade.
--   * pg_net. Its queue is a table, so the request rolls back with everything
--     else.
--
-- A SEQUENCE is the one write Postgres never rolls back, and that is the whole
-- reason this is a sequence and not a table. It buys a number and nothing
-- else: no text, no user, no timestamp. That is also the privacy-correct
-- answer - we do not keep what we refused to publish - and the dated series
-- comes from the client instead (pin_post_failed, reason 'guidelines', with
-- the city and the pin shape but never the words, hooks.ts:284-296).
create sequence if not exists public.pin_screen_refusals as bigint start 1;

revoke all on sequence public.pin_screen_refusals from anon, authenticated;

comment on sequence public.pin_screen_refusals is
  'How many pin writes the blocklist has refused, ever. A sequence because a '
  'refusal raises and a raise rolls back every row the transaction wrote; '
  'nextval is the one write that survives it. Counts ATTEMPTS, so one person '
  'retrying four times counts four, and a crash can overshoot by up to 32 '
  'because nextval only WAL-logs every 32nd bump. It is a smoke alarm, not a '
  'ledger. Read it through public.admin_pin_screening.';

-- ---------------------------------------------------------------------------
-- 2. THE SCREEN
-- ---------------------------------------------------------------------------
--
-- The two columns are screened SEPARATELY rather than joined with concat_ws,
-- for two reasons. A join invents matches across the boundary - a plan ending
-- "the hook" beside details starting "up on the roof" is not a person writing
-- "hook up" - and it throws away which field was the problem, which is the one
-- thing the person needs to be told (see DETAIL below).
--
-- The null guards are what keep our own writes out. seed_launch_pins
-- (20260831150000:105-120) and supabase/seed/launch_pins.sql:78-84 write
-- venue_name and seed_note only, and scripts/seed-demo-travelers.mjs:223-233
-- writes venue_name only, so all three reduce to two null checks and never
-- enter the blocklist loop at all. That is structural, not luck: it holds
-- whatever the founder puts in the blocklist, and it is what stops the 04:10
-- UTC cron (20260823010000:33-41) from emptying a launch city's map over a
-- pattern that happened to match one of our own curated notes.
create function public.screen_pin_text()
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
  'Runs the blocklist over the two pin columns a person composes in their own '
  'words: plan and note. venue_name and place_label are deliberately NOT '
  'screened - they carry names a geocoder or a business row supplied, and four '
  'of the eleven patterns match real venues (Sexy Fish, The Hook Up, Nude '
  'Espresso, One Night Stand). Founder ruling, 2026-09-10. The raise carries '
  'hint = ''guidelines'' so every installed build already says the right '
  'sentence, and DETAIL = the column name so an updated one can say which box '
  'to reword.';

-- The message and the hint are the ones the other six screens raise
-- (20260901140000): the rulebook has ONE name, and a hint is a code that
-- survives a rewording. src/lib/failure-message.ts:110 already answers
-- 'guidelines' with "That breaks our house rules. Reword it and try again.",
-- so this refuses correctly on every phone that already has the app, with no
-- update and no deploy-order hazard.
--
-- DETAIL is new here and it is the one addition to that vocabulary. A pin form
-- has four text boxes and this screen reads two of them; "reword it" without
-- saying which is a dead end, and the two boxes a person would most likely
-- blame - the name Apple Maps filled in, and the address under it - are
-- precisely the two that can never be the cause. PostgREST passes DETAIL
-- through as `details`, so the client picks its sentence from a code rather
-- than by reading prose. It names a COLUMN, never the pattern that matched:
-- naming the pattern hands out the evasion rule (20260822140000:296-298).

-- Postgres fires same-event triggers in name order, compared byte by byte, so
-- this name puts the screen LAST of the six on pins - after pins_no_guests,
-- pins_owner_is_a_traveler, pins_refuse_business, pins_throttle and
-- pins_validate. Two reasons, both small:
--   * a person who is over a cap AND used a blocked word hears about the cap,
--     which is the thing that will still be true after they reword;
--   * the counter above then only counts pins that would otherwise have been
--     accepted, instead of also counting ones the city, the radius or the cap
--     was going to refuse anyway.
-- Nothing breaks if a later name changes that order. It decides which of two
-- true errors a person hears first, and a little noise in one number.
create trigger pins_words_are_screened
  before insert on public.pins
  for each row execute function public.screen_pin_text();

-- ---------------------------------------------------------------------------
-- 3. NOBODY IS REFUSED FOR WORDS THEY DID NOT WRITE
-- ---------------------------------------------------------------------------
--
-- copy_plan_from_message (20260902200000:122-193) inserts a pin for the CALLER
-- carrying another traveler's venue_name, plan and place_label. `note` is
-- deliberately not copied, and :187-190 gives the reason: "it is the other
-- person's own words ... exactly the borrowed-voice problem". `plan` is
-- copied, so `plan` is where this bites.
--
-- With the trigger above and nothing else, that copy is screened at insert
-- time. Two ways it goes wrong, and both get likelier the longer a pin lives:
-- a pin posted before this file existed, and a pin whose text passed and then
-- a pattern was added. Either way the person who tapped "add this plan to my
-- map" is told THEIR text breaks the house rules, about a sentence they never
-- wrote, and because the refusal writes no row we would never hear about it.
--
-- So the borrowed text is checked here, first, and answered with the sentence
-- this function already gives for every other way that button fails. That is
-- its own stated design (:145-148: "One sentence for every way this can fail
-- ... the alternative is an endpoint that answers 'am I in this chat' for any
-- uuid"), and it holds twice over here: it does not accuse the copier, and it
-- does not turn other people's pins into an oracle for what is in the
-- blocklist. The plan stops spreading; whether the original should still be on
-- the map is a question for admin_pin_screening_hits below, and for a person.
--
-- create or replace, not drop: same argument list, same return type, no OUT
-- columns. The grants are restated because that is the habit here.
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

  -- The borrowed words, checked before they are borrowed. Same sentence as the
  -- two above on purpose (see the note over this function). The counter is
  -- bumped because this IS the blocklist refusing a pin write, and a refusal
  -- that did not count would make the number lie in the direction that hides a
  -- problem.
  if v_pin.plan is not null
     and (public.screen_first_message(v_pin.plan) ->> 'action') = 'block' then
    perform nextval('public.pin_screen_refusals');
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
  'and day. The borrowed plan text goes through the blocklist first, and a '
  'refusal answers with the same one sentence every other failure here gives: '
  'the copier is never told that somebody else''s words break the rules.';

-- ---------------------------------------------------------------------------
-- 4. WHAT A PERSON CAN FIND A YEAR FROM NOW
-- ---------------------------------------------------------------------------
--
-- Two views, because they answer two questions and one of them is read when
-- the other is empty. Both are service-role only, like every other admin_ view
-- here.
--
-- The screen is INSERT-only and has to be (see the grants above), so a pin
-- already on the map is never read again by anything. That is fine for three
-- days and not fine for a year - and the blocklist is a table the founder
-- grows without a migration, so "what would today's rules say about what is
-- already up?" gets a new answer every time a pattern is added. These views
-- are the only place that question has an answer at all.
create view public.admin_pin_screening as
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

revoke all on public.admin_pin_screening from anon, authenticated;

comment on view public.admin_pin_screening is
  'The pin screen in one row. refused_all_time is the sequence the trigger '
  'bumps before it raises, which is the only trace a refusal leaves in this '
  'database - a raise rolls back any row written beside it. It never resets '
  'and it counts attempts, so read a DIFFERENCE, not a level, and read it '
  'beside the pin_post_failed analytics event (reason ''guidelines''), which '
  'carries the date and the city. live_pins_the_rules_would_refuse is the '
  'other half: what is on the map right now that today''s blocklist would turn '
  'away. It is not zero by construction, because a pin is screened once, when '
  'it is posted, and can now stay up for a year. Check it after adding a '
  'pattern.';

-- The drill-in. It deliberately shows the text: a false positive cannot be
-- judged from a category, and this is the same footing as admin_report_queue,
-- a human reading what was written, behind the service role. It scans every
-- live pin against every pattern, so it costs roughly 52 us a pin and is a
-- query somebody runs by hand, never one anything joins to.
create view public.admin_pin_screening_hits as
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

revoke all on public.admin_pin_screening_hits from anon, authenticated;

comment on view public.admin_pin_screening_hits is
  'The pins behind admin_pin_screening.live_pins_the_rules_would_refuse, with '
  'the words, so a person can tell a real problem from a bar with an awkward '
  'name. A pin here was legal when it was posted: either it predates the '
  'screen or the pattern was added afterwards. Nothing here is removed '
  'automatically - taking a pin down is a decision, and pins_delete_own means '
  'the traveler can make it too. Service role only.';

-- ---------------------------------------------------------------------------
-- 5. WHERE THIS STARTED, WRITTEN DOWN
-- ---------------------------------------------------------------------------
--
-- One dated row in the audit spine saying what the map looked like the day the
-- screen went on, so the first number anybody compares against is not a guess.
-- subject_user_id is null and the action is not a strike action, so
-- apply_strike_policy (20260817090000:161) returns on its first line.
do $$
declare
  v_live int;
  v_hits int;
begin
  select count(*),
         count(*) filter (
           where exists (select 1 from public.moderation_blocklist b
                          where coalesce(p.plan, '') ~* b.pattern
                             or coalesce(p.note, '') ~* b.pattern))
    into v_live, v_hits
    from public.pins p
   where p.expires_at > now();

  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values (null, 'pin', null, 'screen_installed', 'prefilter-v1',
          jsonb_build_object(
            'live_pins', v_live,
            'would_refuse', v_hits,
            'patterns', (select count(*) from public.moderation_blocklist),
            'columns', jsonb_build_array('plan', 'note')));
end
$$;

-- ---------------------------------------------------------------------------
-- DEPLOY
-- ---------------------------------------------------------------------------
--
-- This file sorts after production's head (20260908205714). The blocker is a
-- different file: 20260905200000_gone_when_your_plan_is_over.sql is still
-- pending and sorts BEFORE that head, so `supabase db push` with no flag
-- (.github/workflows/supabase-deploy.yml:133) refuses the whole push as an
-- out-of-order insert - this file included. It has applied nowhere:
-- production's history goes ... 20260905170000, 20260906090000 ...
--
-- The push runs ONCE, with --include-all, and applies both in version order:
-- 20260905200000 first, then this one. They touch disjoint objects (that file
-- adds pins.plan_ends_at and replaces validate_pin and expire_pins; this one
-- adds a sequence, a function, a trigger, two views and replaces
-- copy_plan_from_message), and they belong in the same push anyway: that file
-- is the one that removes the 72-hour containment this file replaces.
--
-- The alternative, renumbering 20260905200000 to sort after the head, is legal
-- - it has applied nowhere - but it belongs to the pin-lifetime workstream and
-- is the founder's call, not this file's.

notify pgrst, 'reload schema';
