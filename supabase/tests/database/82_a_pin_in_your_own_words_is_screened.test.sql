-- A PIN IN YOUR OWN WORDS IS SCREENED, AND ONLY THOSE WORDS.
--
-- Founder, 2026-09-10: "Agreed we can add pin text into the moderation."
-- Then, on scope: "Only screen the free prose, leave venue names alone."
--
-- Both halves are asserted here, and the second half is the one with no
-- precedent anywhere else in the suite: every other text surface in this
-- schema screens everything it stores, so a screen written from the
-- businesses trigger by analogy would quietly add venue_name and
-- place_label. Assertions 4 and 5 are what stop that.
begin;
select plan(12);

-- A canary pattern for THIS run only: the shipped blocklist is slurs, and a
-- test that typed one would spread it across the suite. Rolled back with
-- everything else.
insert into public.moderation_blocklist (pattern, category)
values ('\ykanaryslurxq\y', 'slur');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000082a1', 'screened@example.com');

update public.profiles set
  display_name = 'Screened', age = 30, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000082a1';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select city_id from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
     where c.name = 'Lisbon' $$;

select pg_temp.login('00000000-0000-0000-0000-0000000082a1');

-- 1. THE HALF THAT MATTERS MOST: ordinary words are not refused.
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, note, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'Pensão Amor', 'Sunset drinks, morning surf',
             'By the door at 7, red cap', 'bar', 38.7071, -9.1458, current_date) $$,
  'a pin whose plan and details are clean is posted'
);

-- 2 and 3. Both branches, separately. One alone passes while the other is
-- missing, which is exactly the defect a single combined assertion hides.
select throws_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'Pensão Amor', 'kanaryslurxq later?', 'bar', 38.7072, -9.1459, current_date) $$,
  'that text breaks our house rules',
  'the plan box is screened'
);

select throws_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, note, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'Pensão Amor', 'Coffee then the market', 'kanaryslurxq, hit me up',
             'bar', 38.7073, -9.1460, current_date) $$,
  'that text breaks our house rules',
  'the details box is screened too'
);

-- 4. THE RULING ITSELF. A real London restaurant is called Sexy Fish, and
-- \ysexy\y is one of the eleven live patterns. The founder exempted the
-- venue name; this is the assertion that holds them to it.
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'Sexy Fish', 'Dinner then the river', 'restaurant',
             38.7074, -9.1461, current_date) $$,
  'a venue name the blocklist would refuse is left alone'
);

-- 5. And the label with it, separately: pins.place_label is machine-fed by
-- reverse geocoding, and both geocode paths build [place.name, ...], so
-- "Sexy Fish, Mayfair" is exactly what that code produces. A screen written
-- from the businesses precedent would add this column, because on THAT table
-- the same name is typed by an owner and is screened.
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, place_label, plan, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'The place', 'Sexy Fish, Mayfair', 'Dinner then the river',
             'restaurant', 38.7075, -9.1462, current_date) $$,
  'a geocoded label the blocklist would refuse is left alone'
);

-- 6. NEVER ONE CONCATENATION. Each column allows on its own; joined with a
-- space they read as \yone\s*night\s*stand\y, and the Details placeholder
-- this app ships is "By the door at 7, I'm in a red cap" - one word away.
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, plan, note, category, lat, lng, intent_date)
     values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
             'Pensão Amor', 'Bangkok for one night',
             'Stand by the door at 7, red cap', 'bar',
             38.7076, -9.1463, current_date) $$,
  'the two boxes are screened apart, never joined'
);

-- 7. THE COUNTER. A refusal aborts, and an abort takes any audit row with
-- it, so a sequence is the only trace a block can leave.
create function pg_temp.refusals() returns bigint language sql as
  $$ select coalesce(pg_sequence_last_value('public.pin_screen_refusals'::regclass), 0) $$;

-- Read as the OWNER, both times: the sequence is revoked from authenticated
-- on purpose, and reading it from the role under test would assert the
-- opposite of what the migration wants.
reset role;
do $$
declare
  v_before bigint := pg_temp.refusals();
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-0000000082a1',
                        'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pins
      (user_id, city_id, venue_name, plan, category, lat, lng, intent_date)
    values ('00000000-0000-0000-0000-0000000082a1', pg_temp.lisbon(),
            'Pensão Amor', 'kanaryslurxq later?', 'bar', 38.7077, -9.1464, current_date);
  exception when others then
    null;
  end;
  reset role;
  perform set_config('pg_temp.delta', (pg_temp.refusals() - v_before)::text, true);
end
$$;

select is(
  current_setting('pg_temp.delta')::int,
  1,
  'a refusal is counted even though its transaction is gone'
);

-- 8. OUR OWN WORDS ARE NOT A PERSON'S. seed_note is curated-only and no
-- client can write it, so the founder's reasoning puts it outside the screen.
select lives_ok(
  $$ insert into public.pins
       (user_id, city_id, venue_name, category, lat, lng, intent_date, seeded, seed_note)
     values (null, pg_temp.lisbon(), 'A curated spot', 'bar', 38.7078, -9.1465,
             current_date, true, 'Nude Espresso pours the best flat white in the city.') $$,
  'a curated seed note is left alone'
);

-- 9. The trigger is a definer, and it has to be: execute on
-- screen_first_message is revoked from authenticated, so an invoker-rights
-- trigger would raise 42501 on the direct-table path, which is the one path
-- that most needs covering.
select is(
  (select p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'screen_pin_text'),
  true,
  'the screen runs as its owner'
);

select ok(
  (select p.proconfig::text like '%search_path=public%' from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'screen_pin_text'),
  'and pins its search_path'
);

-- 10. THE FIXTURES THE SIMULATOR SUITE TYPES MUST NOT BE REFUSED. A pattern
-- added later that happens to match one of them turns every Maestro run red
-- for a reason nobody would look for here.
select is(
  (select count(*)::int from public.moderation_blocklist b
    where 'Rooftop hello from Maestro' ~* b.pattern
       or 'Meeting by the door around 7' ~* b.pattern),
  0,
  'no live pattern refuses what the simulator suite types'
);

-- 11. The drill-in shows other people's words, so it is service-role only.
select pg_temp.login('00000000-0000-0000-0000-0000000082a1');
select ok(
  not has_table_privilege('authenticated', 'public.admin_pin_screening_hits', 'select'),
  'a traveler cannot read what other people were refused for'
);

select * from finish();
rollback;
