-- A post photo is checked before a traveler sees it, and readable once it is.
--
-- `business_posts.photo_path` shipped with the table and `business_detail` has
-- always returned it, so the traveler page was ready to draw a photo no
-- composer could ever write. Adding the picker without this migration would
-- have put an unreviewed image on a page granted to `anon`.
--
-- The two failures worth a file of their own are the ones that look fine in
-- the schema:
--
--   * moderation attaches to the ROW a photo creates. `business_photos` has a
--     trigger; a post photo makes no row there, so sharing the bucket buys it
--     nothing at all.
--   * and neither does READABILITY. `can_view_business_photo` resolves an
--     object name through `business_photos`, so before the migration widened
--     it, a traveler signing a post photo's URL got a refusal on a photo that
--     had passed moderation.
--
-- The last three assertions are about `city_whats_on`, which lands in the same
-- migration; they live here for the same reason it does.
begin;
select plan(23);

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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c4', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'traveler@example.com');

-- A FUNCTION, not a temp table: `set local role authenticated` has no
-- privileges on anything in pg_temp, and the half of this suite that matters
-- is the half that runs as a real user.
create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Bar Alma' $$;

create function pg_temp.lisbon() returns int language sql as
  $$ select id from public.cities where name = 'Lisbon' and country_code = 'PT' $$;

-- One post's field, read back through the RPC every screen reads. Whatever
-- role is current is the role the RPC answers, which is the whole test.
create function pg_temp.post_field(p_title text, p_field text)
returns text language sql as $$
  select po ->> p_field
  from public.business_detail(pg_temp.biz()) d,
       lateral jsonb_array_elements(d.posts) po
  where po ->> 'title' = p_title
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select public.register_business('Bar Alma', 'bar', pg_temp.lisbon(), 38.7108, -9.1400);

select pg_temp.admin();
update public.businesses
   set state = 'listed', listed_at = now()
 where id = pg_temp.biz();

-- ---------------------------------------------------------------------------
-- The flag-off branch, which a keyless dev project and this suite run
-- ---------------------------------------------------------------------------

select is(
  (select value from public.app_config where key = 'require_photo_moderation'),
  'false',
  'the suite runs with photo moderation off'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
insert into public.business_posts (business_id, title, photo_path, happens_at)
values (pg_temp.biz(), 'Live music, no cover',
        '00000000-0000-0000-0000-0000000000c4/band.jpg', now() + interval '1 day');

select is(
  (select photo_status::text from public.business_posts
    where title = 'Live music, no cover'),
  'approved',
  'with the flag off a post photo is approved on insert, as a profile photo is'
);

-- The ledger is nobody's to read but the service role's, so this one question
-- is asked with the role reset.
select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'business_post_photo' and action = 'auto_approved'),
  1,
  'and the ledger records who approved it and why'
);

select pg_temp.guest();
select is(
  pg_temp.post_field('Live music, no cover', 'photo_path'),
  '00000000-0000-0000-0000-0000000000c4/band.jpg',
  'so a traveler is handed the path, which is what the place page draws'
);
select is(
  pg_temp.post_field('Live music, no cover', 'photo_state'),
  'ready',
  'and the state says it is a photo rather than a wait'
);

-- ---------------------------------------------------------------------------
-- The flag-on branch, which is how production runs
-- ---------------------------------------------------------------------------

select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';

select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
insert into public.business_posts (business_id, title, photo_path, happens_at)
values (pg_temp.biz(), 'Quiz night',
        '00000000-0000-0000-0000-0000000000c4/quiz.jpg', now() + interval '2 days');

select is(
  (select photo_status::text from public.business_posts where title = 'Quiz night'),
  'pending',
  'with the flag on it holds instead of going live unscreened'
);

-- The write grant on this table is table-wide, so the trigger is the only
-- thing standing between an owner and their own verdict.
update public.business_posts
   set photo_status = 'approved'
 where title = 'Quiz night';

select is(
  (select photo_status::text from public.business_posts where title = 'Quiz night'),
  'pending',
  'and an owner cannot approve it by sending the column along with an edit'
);

select pg_temp.guest();
select is(
  pg_temp.post_field('Quiz night', 'photo_path'),
  NULL,
  'a traveler gets no path at all while it is being checked'
);
select is(
  pg_temp.post_field('Quiz night', 'photo_state'),
  'checking',
  'and is told that is why, rather than shown an empty frame'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(
  pg_temp.post_field('Quiz night', 'photo_path'),
  '00000000-0000-0000-0000-0000000000c4/quiz.jpg',
  'the owner sees their own picture while it waits, as a photo sender does'
);

select throws_ok(
  $$ select public.apply_business_post_photo_verdict(
       (select id from public.business_posts where title = 'Quiz night'),
       '{"action":"allow"}'::jsonb) $$,
  NULL,
  'and cannot hand down the verdict: that door is the worker''s'
);

select pg_temp.admin();
select public.apply_business_post_photo_verdict(
  (select id from public.business_posts where title = 'Quiz night'),
  '{"action":"block","category":"not_a_business","engine":"claude-moderator"}'::jsonb
);

select is(
  (select photo_status::text from public.business_posts where title = 'Quiz night'),
  'rejected',
  'the worker can, which is the half that makes the flag-on path work'
);

select pg_temp.guest();
select is(
  pg_temp.post_field('Quiz night', 'photo_path'),
  NULL,
  'a refused photo is never handed out'
);
select is(
  pg_temp.post_field('Quiz night', 'photo_state'),
  'blocked',
  'and says so, so the owner is not left guessing at an empty card'
);

-- ---------------------------------------------------------------------------
-- The storage read, which is the half sharing a bucket does not give you
-- ---------------------------------------------------------------------------
--
-- `can_view_business_photo` is revoked from anon, so this is the authenticated
-- traveler's question: the one the storage SELECT policy asks on their behalf.

select pg_temp.login('00000000-0000-0000-0000-0000000000d4');
select is(
  public.can_view_business_photo('00000000-0000-0000-0000-0000000000c4/band.jpg'),
  true,
  'an approved post photo can actually be signed by a traveler'
);
select is(
  public.can_view_business_photo('00000000-0000-0000-0000-0000000000c4/quiz.jpg'),
  false,
  'a refused one cannot, whatever the path looks like'
);

-- ---------------------------------------------------------------------------
-- A post with no photo is not a post waiting for one
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
insert into public.business_posts (business_id, title)
values (pg_temp.biz(), 'Open all week');

select is(
  (select photo_status::text from public.business_posts where title = 'Open all week'),
  'approved',
  'a post with no photo is settled, not pending forever on a photo it lacks'
);

select pg_temp.guest();
select is(
  pg_temp.post_field('Open all week', 'photo_state'),
  'none',
  'and says none, which is what tells the card to draw no frame'
);

select pg_temp.admin();
select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'business_post_photo'
      and action in ('auto_approved', 'queued_for_llm')),
  2,
  'and queues nothing: two photos went in, so the trigger opened two checks'
);

-- Taken down takes its picture with it, exactly as it takes its words.
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
update public.business_posts
   set archived_at = now()
 where title = 'Live music, no cover';

select pg_temp.login('00000000-0000-0000-0000-0000000000d4');
select is(
  public.can_view_business_photo('00000000-0000-0000-0000-0000000000c4/band.jpg'),
  false,
  'an archived post''s photo stops being readable the moment it comes down'
);

-- ---------------------------------------------------------------------------
-- What is on, which is the same rows said out loud
-- ---------------------------------------------------------------------------

select pg_temp.guest();
select is(
  (select title from public.city_whats_on(pg_temp.lisbon())
    where business_id = pg_temp.biz()),
  'Quiz night',
  'the soonest live post is what the city''s what-is-on list carries'
);
select is(
  (select count(*)::int from public.city_whats_on(pg_temp.lisbon())
    where business_id = pg_temp.biz()),
  1,
  'one row per business, because the list shows one row per business'
);

select pg_temp.admin();
update public.businesses set state = 'unconfirmed' where id = pg_temp.biz();

select pg_temp.guest();
select is(
  (select count(*)::int from public.city_whats_on(pg_temp.lisbon())
    where business_id = pg_temp.biz()),
  0,
  'a listing off the map takes its what-is-on row with it'
);

select * from finish();
rollback;
