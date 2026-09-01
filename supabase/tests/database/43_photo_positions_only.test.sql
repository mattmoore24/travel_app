-- Reordering photos is a client write. Everything else about a photo is not.
--
-- The app can now move photos between slots, and it does it the only way a
-- client can: `update profile_photos set position = ...`. That write is legal
-- because 20260816190000:359-362 grants exactly one column and revokes the
-- rest — 'moderation_status is server-owned; clients may only move
-- positions'. This is written as an attack because the grant is the whole
-- mechanism: a client that hides the button proves nothing, and PostgREST
-- will happily send any column an attacker names.
--
-- The other half is the owner check. A reorder is a plain UPDATE with an id
-- filter, so if RLS did not scope it, one traveler could rearrange another
-- traveler's profile — including deciding which photo of theirs leads.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'pos-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'pos-bob@example.com');

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

-- A fixture FUNCTION, not a temp table: `set local role authenticated` has no
-- privileges on anything in pg_temp, and the assertions that matter all run
-- after that switch.
create function pg_temp.photo(slot int) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.profile_photos
     where user_id = '00000000-0000-0000-0000-0000000000f1' and position = slot $$;

-- Its position, read as the owner regardless of who is logged in: the
-- assertion below is about the ROW, not about who may see it.
create function pg_temp.photo_position(n int) returns int language sql
security definer set search_path = public as
  $$ select position from public.profile_photos where id = pg_temp.photo(n) $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

insert into public.profile_photos (user_id, storage_path, position) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1/a.jpg', 0),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1/b.jpg', 1);

-- The write the reorder is made of.
select lives_ok(
  $$ update public.profile_photos set position = 7
     where id = (select pg_temp.photo(1)) $$,
  'owner can move their own photo to another slot'
);
select is(
  (select position from public.profile_photos where id = (select pg_temp.photo(7))),
  7,
  'and the move actually landed'
);

-- Everything the grant deliberately leaves out.
select throws_ok(
  $$ update public.profile_photos set moderation_status = 'approved'
     where id = (select pg_temp.photo(0)) $$,
  '42501',
  null,
  'a client cannot approve its own photo'
);
select throws_ok(
  $$ update public.profile_photos set storage_path = 'someone-else/stolen.jpg'
     where id = (select pg_temp.photo(0)) $$,
  '42501',
  null,
  'a client cannot repoint a photo row at another object'
);
select throws_ok(
  $$ update public.profile_photos set user_id = '00000000-0000-0000-0000-0000000000f2'
     where id = (select pg_temp.photo(0)) $$,
  '42501',
  null,
  'a client cannot hand its photo to somebody else'
);
select throws_ok(
  $$ update public.profile_photos set position = 3, moderation_status = 'approved'
     where id = (select pg_temp.photo(0)) $$,
  '42501',
  null,
  'a legal column does not smuggle an illegal one through with it'
);

-- The slot range is still the database's to police, whatever the client sends.
select throws_ok(
  $$ update public.profile_photos set position = 12
     where id = (select pg_temp.photo(0)) $$,
  '23514',
  null,
  'a slot outside 0..8 is refused'
);

-- And a reorder is scoped to your own photos.
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select lives_ok(
  $$ update public.profile_photos set position = 5
     where id = (select pg_temp.photo(0)) $$,
  'another traveler''s update is not an error, it simply matches nothing'
);
-- Read back through the definer helper, not as f2. Reading it directly happens
-- to work only because the fixture photo is approved and f1 is discoverable;
-- change either and this would fail with "have NULL want 0", which reads as a
-- regression in the thing being tested rather than in the fixture. The claim
-- is "the row did not move", so ask the question in a way that cannot be
-- answered by RLS instead.
select is(
  (select pg_temp.photo_position(0)),
  0,
  'and the photo has not moved'
);

select * from finish();
rollback;
