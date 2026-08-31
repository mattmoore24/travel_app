-- The design brief bans em dashes in anything the app shows, and the database
-- ships copy too. Two offenders, both live:
--
-- 1. seed_launch_pins() — the daily curated-pin refresh. Sixteen of its twenty
--    venues carry a note, and every one of those notes carried an em dash.
--    Those are the pins a brand-new user taps on the hero screen before any
--    real traveler has posted anything, so they are the app's voice on day
--    one. All sixteen rewritten as plain sentences; everything else in the
--    function is byte-identical to 20260823020000_curated_pins_stay_current.sql
--    (the live definition). Same signature, same integer return, so
--    `create or replace` is correct (AGENTS.md's drop-first rule is about OUT
--    columns); the revoke is restated anyway.
--
-- 2. apply_message_verdict() — the moderation refusal push, the single most
--    sensitive notification the app sends, carried one too. Body otherwise
--    byte-identical to 20260820001000_copy_pass.sql:109-195 (the live
--    definition; 20260821120000 redefined only apply_strike_policy and
--    admin_resolve_report). Returns void, so `create or replace` is correct.
--
-- A DO block at the end sweeps any already-seeded pin whose note still holds
-- U+2014 and reruns the seeder, so the four launch cities read right
-- immediately rather than on the next daily sweep.

create or replace function public.seed_launch_pins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Yesterday's plan is not a plan. Only ever touches seeded rows.
  delete from public.pins
  where seeded and intent_date < current_date;

  with seed(city_name, country, venue, cat, lat, lng, day_offset, note) as (
    values
    ('Lisbon', 'PT', 'LX Factory night market', 'other', 38.7025, -9.1782, 0,
     'Open-air market under the bridge. Travelers meet at the main gate, 7pm.'),
    ('Lisbon', 'PT', 'Time Out Market', 'restaurant', 38.7067, -9.1459, 0,
     'Easiest food hall to find people. Grab a seat at the long tables.'),
    ('Lisbon', 'PT', 'Miradouro de Santa Catarina', 'monument', 38.7089, -9.1487, 1,
     'Classic sunset spot. Bring a drink, everyone talks to everyone.'),
    ('Lisbon', 'PT', 'Pensão Amor', 'bar', 38.7071, -9.1458, 1, null),
    ('Lisbon', 'PT', 'Carcavelos beach morning', 'beach', 38.6785, -9.3363, 2,
     'Train from Cais do Sodré. Surfers and swimmers both welcome.'),
    ('Mexico City', 'MX', 'Mercado Roma', 'restaurant', 19.4166, -99.1667, 0,
     'Food hall in Roma Norte. The upstairs terrace is the social bit.'),
    ('Mexico City', 'MX', 'Bosque de Chapultepec walk', 'hike', 19.4204, -99.1912, 1,
     'Sunday stroll to the castle viewpoint. Meet at the Niños Héroes gate.'),
    ('Mexico City', 'MX', 'Museo Frida Kahlo', 'museum', 19.3550, -99.1626, 1,
     'Book tickets ahead. Coffee in Coyoacán square after.'),
    ('Mexico City', 'MX', 'Lucha libre at Arena México', 'other', 19.4249, -99.1444, 2,
     'Tuesday and Friday fights. Cheap tickets, unbeatable atmosphere.'),
    ('Mexico City', 'MX', 'Pulquería Los Insurgentes', 'bar', 19.4114, -99.1626, 2, null),
    ('Bangkok', 'TH', 'Chatuchak weekend market', 'other', 13.7999, 100.5502, 0,
     'Meet at the clock tower, section 26 for vintage, then coconut ice cream.'),
    ('Bangkok', 'TH', 'Wat Arun at sunset', 'monument', 13.7437, 100.4889, 1,
     'Cross by ferry from Tha Tien. Golden hour on the river side.'),
    ('Bangkok', 'TH', 'Yaowarat street-food walk', 'restaurant', 13.7398, 100.5091, 1,
     'Chinatown after dark. Come hungry, leave in a food coma.'),
    ('Bangkok', 'TH', 'Lumpini Park morning run', 'hike', 13.7314, 100.5414, 2,
     '7am loop before the heat. Watch for the monitor lizards.'),
    ('Bangkok', 'TH', 'Khao San Road', 'bar', 13.7590, 100.4977, 2, null),
    ('Denpasar', 'ID', 'Canggu sunset at Batu Bolong', 'beach', -8.6478, 115.1385, 0,
     'Boards for rent, beers after. The classic Bali evening.'),
    ('Denpasar', 'ID', 'Sanur sunrise ride', 'beach', -8.6931, 115.2620, 1,
     'Flat cycle path along the water. Sunrise is 6:15, worth it.'),
    ('Denpasar', 'ID', 'Ubud Monkey Forest + rice terraces', 'hike', -8.5194, 115.2606, 1,
     'Share a driver from town. Campuhan ridge walk after.'),
    ('Denpasar', 'ID', 'Uluwatu Temple kecak dance', 'monument', -8.8291, 115.0849, 2,
     'Clifftop fire dance at sunset. Hold onto your sunglasses (monkeys).'),
    ('Denpasar', 'ID', 'La Brisa beach club', 'club', -8.6600, 115.1300, 2, null)
  )
  insert into public.pins
    (user_id, city_id, venue_name, category, lat, lng, intent_date, expires_at,
     seeded, seed_note)
  select
    null, lc.city_id, s.venue, s.cat::public.pin_category, s.lat, s.lng,
    current_date + s.day_offset, now() + interval '48 hours', true, s.note
  from seed s
  join public.cities c on c.name = s.city_name and c.country_code = s.country
  join public.launch_cities lc on lc.city_id = c.id and lc.active
  where not exists (
    select 1 from public.pins p
    where p.seeded and p.city_id = lc.city_id and p.venue_name = s.venue
      and p.expires_at > now()
      -- The date is part of what makes a live pin the RIGHT pin.
      and p.intent_date = current_date + s.day_offset
  );

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.seed_launch_pins() from public, anon, authenticated;

create or replace function public.apply_message_verdict(p_request_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.message_requests%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_req
  from public.message_requests
  where id = p_request_id and status = 'pending_moderation'
  for update;
  if not found then
    raise exception 'request is not awaiting moderation';
  end if;

  -- Re-validate the pair at release time: a block filed, the sender no longer
  -- plain-active (suspended/banned - or shadowbanned, whose requests must
  -- never surface to recipients), a recipient turned invisible, or a chat
  -- that already formed via the reverse direction must keep the message from
  -- delivering. Decline silently (sender-invisible, like any decline) - the
  -- sender did nothing wrong here.
  if p_verdict ->> 'action' = 'allow' and (
    exists (
      select 1 from public.blocks
      where (blocker_id = v_req.sender_id and blocked_id = v_req.recipient_id)
         or (blocker_id = v_req.recipient_id and blocked_id = v_req.sender_id)
    )
    or not public.is_discoverable_owner(v_req.recipient_id)
    or not exists (
      select 1 from public.users
      where id = v_req.sender_id and status = 'active'
    )
    or exists (
      select 1
      from public.chats c
      join public.chat_participants a on a.chat_id = c.id and a.user_id = v_req.sender_id
      join public.chat_participants b on b.chat_id = c.id and b.user_id = v_req.recipient_id
      where c.status = 'active'
    )
  ) then
    update public.message_requests
      set status = 'declined', moderation_verdict = p_verdict, responded_at = now()
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id, 'release_declined',
       'claude-moderator', p_verdict);
    return;
  end if;

  if p_verdict ->> 'action' = 'allow' then
    update public.message_requests
      set status = 'pending', moderation_verdict = p_verdict
      where id = p_request_id; -- fires message_requests_release_push
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id, 'llm_approved',
       'claude-moderator', p_verdict);
  else
    update public.message_requests
      set status = 'blocked_by_moderation', moderation_verdict = p_verdict
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.sender_id, 'message_request', p_request_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'blocked_failsafe'      -- not a strike
            else 'llm_blocked' end,      -- a strike (apply_strike_policy)
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
    insert into public.push_queue (user_id, title, body, data)
    values (v_req.sender_id, 'Message not delivered',
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'Your message couldn''t be checked and wasn''t delivered. Please try again.'
              else 'Your message wasn''t delivered. It came across as explicit, so reword it and try again.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

-- Sweep the copy that is already on the map, so the four launch cities read
-- right immediately rather than on the next daily run. chr(8212) is U+2014,
-- spelled so this file itself carries no em dash in a string literal. The
-- reseed only runs when something was actually swept: a fresh database (the
-- local test cluster) has no seeded pins and must stay that way at
-- migration time.
do $sweep$
declare
  v_swept integer;
begin
  delete from public.pins
  where seeded and seed_note like '%' || chr(8212) || '%';
  get diagnostics v_swept = row_count;
  if v_swept > 0 then
    perform public.seed_launch_pins();
  end if;
end
$sweep$;
