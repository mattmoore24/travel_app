-- A business account is served no travelers, and it runs the room it owns.
--
-- 20260829190000 closed every traveler WRITE a business could reach. It left
-- the READS open, and `city_pins` is the biggest one in the schema: every open
-- plan in a city with the name, age, face, verified badge and intended date of
-- whoever posted it. A business account got the lot, which is the exact
-- opposite of the founder's "the map page as a business isn't used for that
-- purpose". `traveler_trips` was the same read one uuid at a time.
--
-- The other half of the file is the room a business RUNS. `business_for_chat`
-- only ever matched `kind = 'business'`, which is the DM a traveler opens from
-- a listing, so it answered NULL for the public room whose id is sitting in
-- `businesses.chat_id` — and `my_chats` left `my_role` NULL there too, because
-- it was read off a `groups` row that a business room does not have. The owner
-- of the chat was the one person in it with no moderation controls.
begin;
select plan(16);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b9', 'pinner@example.com'),
  ('00000000-0000-0000-0000-0000000000c9', 'reader@example.com');

-- Two finished travelers: one who posts the plan, one who reads the map. The
-- reader is the control on every assertion below — each refusal has to cost
-- her nothing.
update public.profiles set
  display_name = 'Bea', age = 29, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000b9';

update public.profiles set
  display_name = 'Cat', age = 31, home_country = 'ES',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000000c9';

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- The plan, its trip and its face. featured_traveler wants all three: an
-- active trip starting inside a fortnight, and an approved photo at position 0.
select pg_temp.login('00000000-0000-0000-0000-0000000000b9');
select public.post_joinable_pin(
  pg_temp.lisbon(), 'The rooftop', 'Rooftop at 9', 'By the door',
  'bar'::public.pin_category, 38.7108, -9.1400, current_date, now() + interval '6 hours'
);
insert into public.trips (user_id, city_id, start_date, end_date)
values ('00000000-0000-0000-0000-0000000000b9', pg_temp.lisbon(),
        current_date, current_date + 5);
insert into public.profile_photos (user_id, storage_path, position)
values ('00000000-0000-0000-0000-0000000000b9',
        '00000000-0000-0000-0000-0000000000b9/p0.jpg', 0);

-- The business.
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select public.register_business('Casa Verde', 'cafe', pg_temp.lisbon(), 38.7108, -9.1400);
select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now()
 where owner_user_id = '00000000-0000-0000-0000-0000000000a9';

-- SECURITY DEFINER, all three, and defined here rather than up with the rows
-- they read: a definer function runs as whoever CREATED it, so one created a
-- few lines earlier under `set local role authenticated` is denied
-- `businesses` and takes the assertion down with it.
--
-- Definer at all because `businesses.owner_user_id` is withheld from the
-- client on purpose and `groups` carries no select policy for a non-member. A
-- plain subquery returns NULL the moment the suite becomes `authenticated`,
-- and every assertion after it passes for the wrong reason.
create function pg_temp.plan_chat() returns uuid
  language sql security definer as
  $$ select g.chat_id from public.groups g
     join public.pins p on p.id = g.pin_id where p.note = 'Rooftop at 9' $$;

create function pg_temp.room_of(p_owner uuid) returns uuid
  language sql security definer as
  $$ select chat_id from public.businesses where owner_user_id = p_owner $$;

create function pg_temp.biz() returns uuid
  language sql security definer as
  $$ select id from public.businesses where name = 'Casa Verde' $$;

-- ---------------------------------------------------------------------------
-- What a traveler sees, first, so the refusals below mean something
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000c9');

select is(
  (select count(*) from public.city_pins(pg_temp.lisbon()) where note = 'Rooftop at 9'),
  1::bigint,
  'a traveler sees the plan, and the name behind it, on the map'
);

select is(
  (select count(*) from public.traveler_trips('00000000-0000-0000-0000-0000000000b9')),
  1::bigint,
  'and can read another traveler''s dates'
);

select is(
  (select count(*) from public.pin_crew((select id from public.pins where note = 'Rooftop at 9'))),
  1::bigint,
  'and who is already going'
);

select is(
  (select count(*) from public.featured_traveler(pg_temp.lisbon())),
  1::bigint,
  'and the featured traveler card'
);

select ok(
  not public.viewer_is_business(),
  'a traveler is not a business, and asks about nobody but herself'
);

-- ---------------------------------------------------------------------------
-- What a business sees: none of it
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000a9');

select ok(
  public.viewer_is_business(),
  'a business account knows itself'
);

-- Every pin in the city, seeded ones included: this is the whole feed the
-- founder said the business map is not for.
select is(
  (select count(*) from public.city_pins(pg_temp.lisbon())),
  0::bigint,
  'a business is served no pins at all, not one name and not one face'
);

select is(
  (select count(*) from public.traveler_trips('00000000-0000-0000-0000-0000000000b9')),
  0::bigint,
  'and cannot ask where a traveler is going, holding her id'
);

select is(
  (select count(*) from public.pin_crew((select id from public.pins where note = 'Rooftop at 9'))),
  0::bigint,
  'and cannot read the roster of a plan it can never join'
);

select is(
  (select count(*) from public.featured_traveler(pg_temp.lisbon())),
  0::bigint,
  'and is handed no featured traveler'
);

-- The map a business DOES get keeps working. Same city, no people in it.
select ok(
  (select count(*) from public.public_city_pins(pg_temp.lisbon())) > 0,
  'the faceless feed still answers, so the business map is not an empty screen'
);

-- §7 rule 8: travelers write in, the business replies.
select throws_ok(
  $$ select public.open_direct_chat('00000000-0000-0000-0000-0000000000b9', 'come by tonight') $$,
  '42501',
  'a business account cannot message a traveler first',
  'and never writes to a traveler first'
);

-- ---------------------------------------------------------------------------
-- The room a business runs
-- ---------------------------------------------------------------------------

select is(
  public.business_for_chat(pg_temp.room_of('00000000-0000-0000-0000-0000000000a9')),
  pg_temp.biz(),
  'the owner''s own room knows which business it belongs to'
);

select is(
  (select my_role from public.my_chats() where chat_id = pg_temp.room_of('00000000-0000-0000-0000-0000000000a9')),
  'admin',
  'and the person who runs it has a role in it'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c9');

select is(
  public.business_for_chat(pg_temp.room_of('00000000-0000-0000-0000-0000000000a9')),
  pg_temp.biz(),
  'a traveler in that room gets the same answer, which is her way back to the listing'
);

-- The traveler group is still a traveler group: null there is what tells the
-- room screen the two apart.
select pg_temp.login('00000000-0000-0000-0000-0000000000b9');

select is(
  (select my_role from public.my_chats() where chat_id = pg_temp.plan_chat()),
  'admin',
  'and a traveler still runs the plan she posted'
);

select * from finish();
rollback;
