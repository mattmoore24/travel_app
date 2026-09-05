-- `select *` keeps working on every table the app star-reads.
--
-- Column-level grants and `add column` are individually fine and jointly a
-- trap: Postgres refuses `select *` unless EVERY column is granted, so a new
-- column on a column-granted table silently revokes the whole read for the
-- app. 20260829180000 did exactly that to business_photos
-- (moderation_attempts), and the owner's photo grid answered every upload
-- with "0 of 10": the insert grant still passed, the row landed, and the
-- read-back was `permission denied` — rendered as the empty state, because a
-- failed query looks like no data to any screen that has not opted into
-- LoadError. e2e runs 90 to 92 burned five accounts photographing it.
--
-- The list below is every table src/ calls `.select('*')` on (a bare
-- `.select()` after insert is the same contract — it is `returning *`).
-- Adding a column to one of these means granting it in the same migration,
-- or switching the app to a named column list. A table deliberately hiding
-- columns (profiles, message_requests, businesses…) must NEVER be
-- star-selected from the app; keeping it out of this list is what documents
-- that.
--
-- `groups` LEFT this list on 2026-09-03 (20260903130000). It hides columns
-- now — photo_path, photo_status and moderation_attempts say what a photo's
-- verdict is, and a verdict is for its subject alone — so its select grant is
-- column-level and `fetchGroup` reads `group_detail()` instead. The refusal a
-- direct read now gets is asserted in 74_a_verdict_is_for_its_subject_alone,
-- where it is the point rather than a regression.
begin;
select plan(10);

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
  ('00000000-0000-0000-0000-0000000000c9', 'star-owner@example.com');

select pg_temp.login('00000000-0000-0000-0000-0000000000c9');

select lives_ok($$ select * from public.business_hours      limit 1 $$, 'select * works on business_hours');
select lives_ok($$ select * from public.business_links      limit 1 $$, 'select * works on business_links');
select lives_ok($$ select * from public.business_photos     limit 1 $$, 'select * works on business_photos');
select lives_ok($$ select * from public.messages            limit 1 $$, 'select * works on messages');
select lives_ok($$ select * from public.profile_photos      limit 1 $$, 'select * works on profile_photos');
select lives_ok($$ select * from public.profile_priorities  limit 1 $$, 'select * works on profile_priorities');
select lives_ok($$ select * from public.profile_prompts     limit 1 $$, 'select * works on profile_prompts');
select lives_ok($$ select * from public.social_handles      limit 1 $$, 'select * works on social_handles');
-- `returning *` rides the same grants as select *; pins is the one insert
-- that uses it outside the tables above.
select lives_ok($$ select * from public.pins                limit 1 $$, 'select * works on pins');

-- The regression itself, end to end: the owner uploads, the row lands, and
-- the READ-BACK the grid runs shows it — the half that was broken.
select public.register_business('Star Select Cafe', 'cafe',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);
insert into public.business_photos (business_id, storage_path, position)
values (
  (select id from public.businesses where name = 'Star Select Cafe'),
  '00000000-0000-0000-0000-0000000000c9/star.jpg', 0);
select is(
  (select count(*)::int from public.business_photos
    where business_id = (select id from public.businesses where name = 'Star Select Cafe')),
  1,
  'the owner''s own photo comes back from the grid''s read after the insert'
);

select * from finish();
rollback;
