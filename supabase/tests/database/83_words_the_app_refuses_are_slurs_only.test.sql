-- THE WORDS THE APP REFUSES ARE SLURS, AND ONLY SLURS.
--
-- Founder, 2026-09-10: "I don't think we should be trying to police speech
-- rather than a few explicit curse words that are almost always used in a
-- derogatory fashion (think the n word and other words similar to that) and
-- can rely on users to report/block each other."
--
-- This is the one file that probes the SHIPPED list rather than a canary, so
-- it is the one file that has to type a slur. It types exactly one, the one
-- the founder named, and nothing else in the suite does.
begin;
select plan(10);

-- 1. The eleven flirtation and sex patterns are gone. Named by the sentences
--    they used to refuse, which are ordinary travel English.
select is(
  (public.screen_first_message('you look so sexy in that photo')) ->> 'action',
  'allow', 'a compliment is not refused'
);
select is(
  (public.screen_first_message('Beach club, then hook up with the others at 10')) ->> 'action',
  'allow', '"hook up" meaning "meet up" is not refused'
);
select is(
  (public.screen_first_message('Dinner at Sexy Fish then the river')) ->> 'action',
  'allow', 'a restaurant called Sexy Fish is not refused'
);
select is(
  (public.screen_first_message('Nude beach at Meco, then lunch')) ->> 'action',
  'allow', 'a nude beach is not refused'
);

-- 2. A slur is. The n-word, since the founder named it as the exemplar.
select is(
  (public.screen_first_message('you are a nigger')) ->> 'action',
  'block', 'the word the founder named is refused'
);
select is(
  (public.screen_first_message('you are a nigger')) ->> 'category',
  'slur', 'and it is refused as a slur, not as flirtation'
);

-- 3. Nothing in the table is anything but a slur any more.
select is(
  (select count(*)::int from public.moderation_blocklist where category <> 'slur'),
  0, 'the table holds slurs and nothing else'
);

-- 4. A group's name is typed by a person, so it is screened like one — and
--    the five-a-day cap it sits beside is still there, because a rewrite of
--    this function is exactly where that cap would quietly go missing.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000083a1', 'grouper@example.com');
update public.profiles set
  display_name = 'Grouper', age = 30, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id = '00000000-0000-0000-0000-0000000083a1';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;
select pg_temp.login('00000000-0000-0000-0000-0000000083a1');

select throws_ok(
  $$ select public.create_group('niggers only', null) $$,
  'that text breaks our house rules',
  'a group cannot be named with a slur'
);

-- Five ordinary groups land; the sixth is the cap, not the screen.
select lives_ok(
  $$ select public.create_group('Rooftop crew', null),
            public.create_group('Surf mornings', null),
            public.create_group('Night market', null),
            public.create_group('Day trip', null),
            public.create_group('Hostel bar', null) $$,
  'five plainly named groups are started'
);
select throws_ok(
  $$ select public.create_group('One more', null) $$,
  'You have started a few groups today already.',
  'and the daily cap is still standing behind the screen'
);

select * from finish();
rollback;
