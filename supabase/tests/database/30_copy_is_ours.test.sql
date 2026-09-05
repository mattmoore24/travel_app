-- The database ships user-facing copy: the curated pin notes are the app's
-- voice on day one, before any real traveler has posted anything, and the
-- moderation pushes are the app's voice at its worst moment. The design brief
-- bans em dashes in anything the app shows, so the live seeder must write
-- none and the live push bodies must carry none. chr(8212) is U+2014, spelled
-- out so this file itself carries no em dash inside a literal.
--
-- PART TWO, the refusal push (20260903100000). DSA Art. 17(3)(c) asks a
-- statement of reasons to say whether the decision was automated. The
-- llm_blocked body says so; the failsafe body must NOT, because a failsafe
-- hold is the check not running rather than a decision. And the push is the
-- sender's, about the sender's own message: the recipient is told nothing.
-- Measured (2026-09-02) against the migration with the disclosure sentence
-- deleted: assertion 7 here and 08_trust_safety's body assertion (its #30)
-- fail, nothing else does. With the sentence copied onto the failsafe body
-- as well: 8 alone.
begin;
select plan(11);

-- Wipe and reseed from the live function (service path; suite runs as owner).
delete from public.pins where seeded;
select ok(
  public.seed_launch_pins() > 0,
  'the seeder puts curated pins on the map'
);
select is(
  (select count(*)::int from public.pins where seeded),
  27,
  'all twenty-seven curated pins land across the nine districts'
);
select is(
  (select count(*)::int from public.pins where seeded and seed_note is not null),
  23,
  'twenty-three of them carry a note'
);
select is(
  (select count(*)::int from public.pins
   where seeded and seed_note like '%' || chr(8212) || '%'),
  0,
  'no curated pin note contains an em dash'
);

-- The list is clustered by district on purpose (three pins per nightlife
-- district inside one 0.005-degree cell). Curated pins do not count toward
-- the heat k-threshold (D7), so this asserts the SEED DATA directly — the
-- regression that would otherwise let a later edit silently un-cluster it.
select is(
  (select count(distinct city_id)::int from (
     select city_id
     from public.pins
     where seeded
     group by city_id, floor(lat / 0.005), floor(lng / 0.005)
     having count(*) >= 3
   ) clustered),
  (select count(*)::int from public.launch_cities where active),
  'every active launch city keeps at least one district-clustered cell of curated pins'
);

-- ---------------------------------------------------------------------------
-- PART TWO: the refusal push says a machine decided
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d5a1', 'copy-sender@example.com'),
  ('00000000-0000-0000-0000-00000000d5b1', 'copy-recipient@example.com'),
  ('00000000-0000-0000-0000-00000000d5b2', 'copy-failsafe@example.com');

update public.profiles set
  display_name = 'traveler', age = 28, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id in ('00000000-0000-0000-0000-00000000d5a1',
                  '00000000-0000-0000-0000-00000000d5b1',
                  '00000000-0000-0000-0000-00000000d5b2');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

-- Back to postgres AND clear the claims: apply_message_verdict runtime-guards
-- on auth.role() and would otherwise still read the last login.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

create function pg_temp.held(p_recipient uuid) returns uuid language sql as
  $$ select id from public.message_requests
      where sender_id = '00000000-0000-0000-0000-00000000d5a1'
        and recipient_id = p_recipient $$;

-- Everyone overlaps, so both hellos below are legitimately sendable.
insert into public.trips (user_id, city_id, start_date, end_date)
select u, pg_temp.lisbon(), current_date + 5, current_date + 15
from unnest(array[
  '00000000-0000-0000-0000-00000000d5a1',
  '00000000-0000-0000-0000-00000000d5b1',
  '00000000-0000-0000-0000-00000000d5b2']::uuid[]) as u;

update public.app_config set value = 'true'::jsonb where key = 'require_llm_moderation';

select pg_temp.login('00000000-0000-0000-0000-00000000d5a1');
select is(
  (public.send_message_request(
     '00000000-0000-0000-0000-00000000d5b1', 'trip_match',
     'Which miradouro wins at sunset?', 'bio')) ->> 'queued',
  'true',
  'a clean message is held for classification'
);
select public.send_message_request(
  '00000000-0000-0000-0000-00000000d5b2', 'trip_match',
  'Any coworking cafe tips while our dates overlap?', 'bio');

select pg_temp.admin();
select public.apply_message_verdict(
  pg_temp.held('00000000-0000-0000-0000-00000000d5b1'),
  '{"action":"block","category":"flirtation","engine":"claude-moderator"}'::jsonb);
select public.apply_message_verdict(
  pg_temp.held('00000000-0000-0000-0000-00000000d5b2'),
  '{"action":"block","category":"moderation_unavailable","engine":"failsafe"}'::jsonb);

select is(
  (select body from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000d5a1'
      and title = 'Message not delivered'
      and data ->> 'type' = 'moderation'
    order by id limit 1),
  'Your message wasn''t delivered. It came across as explicit, so reword it and try again. '
  'An automatic check made that call, and a person will look again if you write to us from '
  'House rules and help.',
  'a classifier block tells the sender a machine decided and where a person can be asked'
);
select is(
  (select body from public.push_queue
    where user_id = '00000000-0000-0000-0000-00000000d5a1'
      and title = 'Message not delivered'
    order by id desc limit 1),
  'Your message couldn''t be checked and wasn''t delivered. Please try again.',
  'a failsafe hold claims no decision, because none was taken'
);
select is(
  (select count(*)::int from public.push_queue
    where user_id in ('00000000-0000-0000-0000-00000000d5a1')
      and body like '%' || chr(8212) || '%'),
  0,
  'and neither body carries an em dash'
);

-- The recipient hears nothing, from either branch.
select is(
  (select count(*)::int from public.push_queue
    where user_id in ('00000000-0000-0000-0000-00000000d5b1',
                      '00000000-0000-0000-0000-00000000d5b2')),
  0,
  'no push of any kind reaches a recipient about a message that was stopped'
);
select pg_temp.login('00000000-0000-0000-0000-00000000d5b1');
select is(
  (select count(*)::int from public.incoming_requests()),
  0,
  'and the stopped message is not in their inbox'
);

select * from finish();
rollback;
