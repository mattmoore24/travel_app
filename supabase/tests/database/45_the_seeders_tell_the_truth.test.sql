-- The two launch-venue seeders, which had no test at all until a production
-- run returned 0 and nobody could say what it meant.
--
-- Written as attacks on the three defects that survived to production:
-- an archived post the seeder could never repair, a loop that would write
-- fake content onto a real business, and a counter that counted hours rows
-- rather than venues.

begin;
select plan(12);

-- The launch cities are seeded by 20260816210000 and are active there.
select is(
  (select count(*)::int from public.launch_cities lc
     join public.cities c on c.id = lc.city_id
    where lc.active and c.name in ('Lisbon', 'Denpasar')),
  2,
  'the fixture rests on Lisbon and Denpasar being active launch cities'
);

-- ── THE VENUES ─────────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.seed_launch_businesses() $$,
  'the venue seeder runs'
);
select is(
  (select count(*)::int from public.businesses b
     join public.cities ct on ct.id = b.city_id
    where b.name = 'Puri Garden Ubud' and ct.name = 'Denpasar'),
  1,
  'and Denpasar has its venue, not only Lisbon'
);
select is(
  (select public.seed_launch_businesses()),
  0,
  'running it twice adds nothing: the guard is idempotent'
);

-- ── THE CONTENT ────────────────────────────────────────────────────────────
select is(
  (select public.seed_launch_business_content()),
  4,
  'the content seeder reports VENUES it had to touch, not hours rows'
);
select is(
  (select public.seed_launch_business_content()),
  0,
  'and 0 the second time, because there was nothing left to do'
);

-- The whole point of the content: the app asks has_live_post, so ask it too.
select is(
  (select count(*)::int from public.city_businesses(
      (select c.id from public.cities c where c.name = 'Denpasar' limit 1))
    where has_live_post),
  1,
  'Denpasar reports a venue with something on, which is what draws ON TONIGHT'
);

-- ── THE ARCHIVED POST, which the old guard could never repair ──────────────
-- archive_expired_posts runs hourly and archives a post whose ends_at has
-- passed. The old guard asked whether ANY post row existed, so once one was
-- archived the venue was skipped for ever while the app showed nothing on.
update public.business_posts set archived_at = now()
 where business_id = (
   select b.id from public.businesses b join public.cities ct on ct.id = b.city_id
    where b.name = 'Puri Garden Ubud' and ct.name = 'Denpasar');

select is(
  (select count(*)::int from public.city_businesses(
      (select c.id from public.cities c where c.name = 'Denpasar' limit 1))
    where has_live_post),
  0,
  'archiving the post takes ON TONIGHT away, as it should'
);
select is(
  (select public.seed_launch_business_content()),
  1,
  'and the seeder NOTICES: an archived post is not a live one'
);
select is(
  (select count(*)::int from public.city_businesses(
      (select c.id from public.cities c where c.name = 'Denpasar' limit 1))
    where has_live_post),
  1,
  'so re-running it puts the venue back on tonight'
);

-- ── THE REAL BUSINESS IT MUST NOT TOUCH ────────────────────────────────────
-- owner_user_id is ON DELETE SET NULL, so a real listing whose owner is gone
-- becomes unclaimed. The old loop walked every unclaimed active business and
-- would have given this one an example.com website and a post it never wrote.
-- One statement, so the chat it makes is the chat it uses: picking the newest
-- row afterwards collides with a room some other fixture already claimed.
with new_chat as (
  insert into public.chats (kind) values ('room') returning id
)
insert into public.businesses (city_id, name, category, lat, lng, chat_id, state, listed_at, owner_user_id)
select c.id, 'A Real Bar Somebody Runs', 'bar', 38.71, -9.14, new_chat.id, 'listed', now(), null
  from public.cities c, new_chat
 where c.name = 'Lisbon' limit 1;

select is(
  (select public.seed_launch_business_content()),
  0,
  'an orphaned REAL listing is not a launch venue, so the seeder leaves it alone'
);
select is(
  (select count(*)::int from public.business_links
    where business_id = (select id from public.businesses where name = 'A Real Bar Somebody Runs')),
  0,
  'and it never gets a fake example.com website its owner did not write'
);

select * from finish();
rollback;
