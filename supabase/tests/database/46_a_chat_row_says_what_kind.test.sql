-- A chat row says what kind of thing it is.
--
-- my_chats grew two OUT columns so the inbox can tell a private crew from a
-- plan strangers can walk into from a hostel room a signed-out visitor can
-- read. The rules worth pinning are the ones a client cannot enforce for
-- itself:
--
--   1. a group post_joinable_pin made carries the pin's own intent_date, so
--      the day stops disappearing the moment somebody writes in the room;
--   2. HARD RULE 3, written as the attack: an EXPIRED pin is unreadable
--      through this row too, in the window before expire_pins sweeps it, and
--      still unreadable after the sweep — while the group itself survives
--      both, because the conversation was never on the pin's timer;
--   3. a group made by create_group has no plan date at all;
--   4. a business room reports its own public_preview, both values, and a
--      traveler group reports null, which is the whole distinction the row
--      draws its privacy tail from.
--
-- The signature change is the deploy hazard AGENTS.md warns about, so the
-- last assertion is that the grants survived the drop: anon must still be
-- refused, or the drop would have quietly opened the caller's whole inbox.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'IE',
  languages = array['en'], onboarding_completed_at = now();

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- Read by NAME, never by joining through the pin: groups.pin_id is
-- ON DELETE SET NULL, so a helper that walks the pin goes null exactly when
-- the interesting half of this test starts.
create function pg_temp.the_plan_room() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Rooftop drinks' $$;

create function pg_temp.the_crew() returns uuid language sql
security definer set search_path = public as
  $$ select chat_id from public.groups where name = 'Maestro crew' $$;

-- Definer for the same reason: groups_select_member means a stranger reading
-- groups.pin_id gets null, and join_pin_chat(null) fails with the sentence
-- that covers every refusal, which would make this fixture look like the
-- feature refusing rather than the fixture failing to name the pin.
create function pg_temp.the_pin() returns uuid language sql
security definer set search_path = public as
  $$ select id from public.pins where venue_name = 'Park Bar' $$;

-- ── A PLAN CARRIES ITS DAY ────────────────────────────────────────────────

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.post_joinable_pin(
       pg_temp.lisbon(), 'Park Bar', null, 'Calçada do Combro 58', 'bar',
       38.7118, -9.1490, current_date + 1, now() + interval '30 hours',
       'Rooftop drinks') $$,
  'a plan anybody can join'
);

select is(
  (select plan_date from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  current_date + 1,
  'the host''s row carries the day the plan is for'
);
select is(
  (select public_preview from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  null,
  'and no readability flag, because a traveler group is not a business room'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.join_pin_chat(pg_temp.the_pin()) $$,
  'a stranger who can see the pin walks in'
);
select is(
  (select plan_date from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  current_date + 1,
  'and reads the same day on their own row'
);

-- Writing in the room is what used to destroy the date: the preview falls
-- through to the last message, and the day had nowhere else to live.
select lives_ok(
  $$ insert into public.messages (chat_id, sender_id, body)
     values (pg_temp.the_plan_room(),
             '00000000-0000-0000-0000-00000000000b', 'on my way') $$,
  'somebody writes in the room'
);
select is(
  (select plan_date from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  current_date + 1,
  'the day survives the first message, which is the whole point of the column'
);

-- ── HARD RULE 3, AS THE ATTACK ────────────────────────────────────────────
--
-- expire_pins runs every fifteen minutes, so there is always a window in
-- which a pin is expired and its row still exists. Nothing about it may be
-- readable in that window, this row included.

select pg_temp.admin();
update public.pins set expires_at = now() - interval '1 second'
  where venue_name = 'Park Bar';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select plan_date from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  null,
  'an expired pin''s day is unreadable before the sweep runs (hard rule 3)'
);
select is(
  (select count(*)::int from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  1,
  'and the group is still on the list: the conversation is not on the pin''s timer'
);

select pg_temp.admin();
delete from public.pins where venue_name = 'Park Bar';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select plan_date from public.my_chats()
    where chat_id = pg_temp.the_plan_room()),
  null,
  'and after the sweep it is an ordinary group with no day'
);

-- ── A CREW HAS NO PLAN ────────────────────────────────────────────────────

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.create_group('Maestro crew', (current_date + 20)::date) $$,
  'a group made by hand'
);
select is(
  (select plan_date from public.my_chats() where chat_id = pg_temp.the_crew()),
  null,
  'has no plan date, so the row says nothing about a day nobody picked'
);

-- ── A BUSINESS ROOM REPORTS ITS OWN READABILITY ───────────────────────────

select pg_temp.admin();
insert into public.chats (id, kind) values
  ('bbbbbbbb-0000-4000-8000-000000000009', 'room');
insert into public.businesses
  (id, city_id, name, category, lat, lng, chat_id, state, listed_at)
values ('cccccccc-0000-4000-8000-000000000009', pg_temp.lisbon(),
        'Once Again Hostel', 'hostel', 38.7100, -9.1400,
        'bbbbbbbb-0000-4000-8000-000000000009', 'listed', now());

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select public.join_room('bbbbbbbb-0000-4000-8000-000000000009',
                             current_date + 3) $$,
  'a traveler joins the hostel room'
);
select is(
  (select public_preview from public.my_chats()
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  true,
  'the row says the room is readable by anyone, which is what it is'
);

select pg_temp.admin();
update public.businesses set public_preview = false
  where id = 'cccccccc-0000-4000-8000-000000000009';
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select public_preview from public.my_chats()
    where chat_id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  false,
  'and false rather than null once the business closes its preview'
);

-- ── THE GRANTS SURVIVED THE DROP ──────────────────────────────────────────
--
-- `drop function` takes the grants with it. Re-stating them is a line in a
-- migration and lines get lost; this is the assertion that notices.

select pg_temp.guest();
select throws_ok(
  $$ select * from public.my_chats() $$,
  '42501',
  null,
  'anon is still refused: the drop did not open the inbox to the world'
);

select * from finish();
rollback;
