-- Choosing a cover is a client write. Everything else about a business photo
-- is not.
--
-- The cover used to be whichever photo survived at the lowest position, so an
-- owner replaced it by deleting every photo ordered before the one they
-- wanted. The grid can now move photos between slots instead, and it does it
-- the only way a client can: `update business_photos set position = ...`.
-- That write is legal because 20260827110000:79-81 grants exactly one column —
-- `grant insert (business_id, storage_path, position), delete, update
-- (position)` — and nothing else. This is written as an ATTACK because the
-- grant is the whole mechanism: a client that hides the control proves
-- nothing, and PostgREST will happily send any column an attacker names.
--
-- The other half is the owner check. A promotion is a plain UPDATE with an id
-- filter, so if `business_photos_write_own` did not scope it, one bar could
-- rearrange another bar's photos — including deciding which one of theirs is
-- the face on the map.
--
-- The profile side of the same argument is 43_photo_positions_only; this is
-- the business one, and it is its own file for the reason 27 is: the suites
-- that test impersonation deliberately darken their listing, and there has to
-- be a live one left to hang a cover on.
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
  ('00000000-0000-0000-0000-0000000000c1', 'cover-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'cover-rival@example.com');

-- Fixture FUNCTIONS, not temp tables: `set local role authenticated` has no
-- privileges on anything in pg_temp, and every assertion that matters runs
-- after that switch. `security definer` so the reads answer about the ROW
-- rather than about who is allowed to see it.
create function pg_temp.biz(owner uuid) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.businesses where owner_user_id = owner $$;

create function pg_temp.photo(owner uuid, slot int) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.business_photos
     where business_id = pg_temp.biz(owner) and position = slot $$;

create function pg_temp.slot_of(path text) returns int language sql
security definer set search_path = public as
  $$ select position from public.business_photos where storage_path = path $$;

-- Two businesses in the same city, so the rival is a real neighbour rather
-- than a row RLS would have refused for some other reason.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.register_business('Casa Verde', 'cafe',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select public.register_business('Bar Rosa', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7120, -9.1380);

select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now();

-- Three photos, in the order the grid uploaded them.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
insert into public.business_photos (business_id, storage_path, position) values
  (pg_temp.biz('00000000-0000-0000-0000-0000000000c1'), 'c1/first.jpg', 0),
  (pg_temp.biz('00000000-0000-0000-0000-0000000000c1'), 'c1/second.jpg', 1),
  (pg_temp.biz('00000000-0000-0000-0000-0000000000c1'), 'c1/third.jpg', 2);

-- THE WRITE THE PROMOTION IS MADE OF, and there are several of them: a
-- promotion renumbers the gallery, one statement per row, and the plan parks a
-- photo in a free slot first so no two ever share one (see
-- features/profile/photo-order.ts, which this reuses).
select lives_ok(
  $$ update public.business_photos set position = 3 where storage_path = 'c1/first.jpg' $$,
  'owner can move their own photo into a free slot'
);
select lives_ok(
  $$ update public.business_photos set position = 0 where storage_path = 'c1/third.jpg' $$,
  'and into the slot that was freed for it'
);
select is((select pg_temp.slot_of('c1/third.jpg')), 0, 'the promoted photo landed at slot 0');
select is(
  (select cover_path from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Casa Verde'),
  'c1/third.jpg',
  'so the map card draws the cover the owner chose'
);

-- Everything the one-column grant deliberately leaves out. A promotion is a
-- position write and must never become anything else.
select throws_ok(
  $$ update public.business_photos set moderation_status = 'approved'
     where storage_path = 'c1/first.jpg' $$,
  '42501',
  null,
  'a business cannot approve its own photo'
);
select throws_ok(
  $$ update public.business_photos set storage_path = 'c2/stolen.jpg'
     where storage_path = 'c1/first.jpg' $$,
  '42501',
  null,
  'nor repoint a photo row at another object'
);
select throws_ok(
  $$ update public.business_photos set position = 1, moderation_status = 'approved'
     where storage_path = 'c1/first.jpg' $$,
  '42501',
  null,
  'and a legal column does not smuggle an illegal one through with it'
);

-- The slot range stays the database's to police, whatever a client sends.
select throws_ok(
  $$ update public.business_photos set position = 12 where storage_path = 'c1/first.jpg' $$,
  '23514',
  null,
  'a slot outside 0..9 is refused'
);

-- AND THE ATTACK: the neighbour deciding which photo is Casa Verde's face.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select lives_ok(
  $$ update public.business_photos set position = 0 where storage_path = 'c1/second.jpg' $$,
  'another business''s update is not an error, it simply matches nothing'
);
-- Read back through the definer helper rather than as c2: asking directly
-- would answer NULL for RLS reasons and read as a regression in the thing
-- under test rather than in the fixture. The claim is "the row did not move".
select is((select pg_temp.slot_of('c1/second.jpg')), 1, 'and the photo has not moved');

select * from finish();
rollback;
