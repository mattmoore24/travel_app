-- A WRITE THAT IS NOT AN EDIT TO A BUSINESS'S WORDS MUST NOT READ THEM AGAIN.
--
-- `businesses_screen` ran screen_business_text() on every write to the row:
-- the blocklist over five text columns, then updated_at = now(). A verdict
-- setting verified_at, a scan flagging an impersonator, an owner flipping
-- public_preview - none of them change a word, and every one of them re-read
-- the words. The blocklist is a table the founder grows, so a pattern added
-- after the words were written turned every one of those writes into 'that
-- text breaks our house rules'. 20260903060000 moves both effects inside a
-- "did one of the five change" check, and this file is the attack.
--
-- READ THIS BEFORE ADDING AN ASSERTION: `now()` is the transaction's
-- timestamp and a pgTAP file is one transaction, so a stamp compared against
-- a value captured from the same row a few statements earlier proves nothing
-- (59 passed with its own guard deleted). Every stamp assertion below parks
-- updated_at in 2020 first, with the trigger disabled so the parking write
-- cannot itself be the thing under test, and asks whether it moved. The
-- first assertion in this file did not, for a day: register_business had
-- inserted the row with default now() in the same transaction, so "stamps
-- updated_at" was now() against now() and passed with the stamp line deleted.
--
-- MEASURED against the migration with the `if v_edited then` guard removed
-- (2026-09-02, second pass), and this record replaces a wrong one. The two
-- halves named before ("a verdict does not move the edit stamp" and "a
-- verdict still lands") CANNOT both fail in one run: with the guard gone the
-- verdict UPDATE re-reads the words, hits the grown blocklist and raises
-- 23514 inside lives_ok, so the stamp never gets a chance to move and the
-- assertion about it passes. What actually fails is every lives_ok whose
-- write would re-read the words (3, 5, 7, 8) and the re-save that must not
-- stamp (12); 1, 2, 4, 6, 9, 10, 11 and 13 pass. With only the stamp line
-- (`new.updated_at := now()`) deleted, 2 and 11 fail and nothing else does -
-- and 2 is the one that passed either way before it was parked.
begin;
select plan(13);

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
  ('00000000-0000-0000-0000-0000000000e6', 'owner@example.com');

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Lumen' $$;

create function pg_temp.stamp() returns timestamptz language sql as
  $$ select updated_at from public.businesses where id = pg_temp.biz() $$;

create function pg_temp.park() returns void language plpgsql as $$
begin
  alter table public.businesses disable trigger businesses_screen;
  update public.businesses set updated_at = timestamptz '2020-01-01 00:00:00+00'
   where id = pg_temp.biz();
  alter table public.businesses enable trigger businesses_screen;
end
$$;

create function pg_temp.parked() returns timestamptz language sql immutable as
  $$ select timestamptz '2020-01-01 00:00:00+00' $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
select public.register_business('Casa Lumen', 'cafe',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);

-- Parked BEFORE the first edit, or the assertion under it is now() against
-- the insert's own default now() and proves nothing.
select pg_temp.admin();
select pg_temp.park();
select is(pg_temp.stamp(), pg_temp.parked(), 'the stamp is parked in 2020 first');

-- The owner writes a description while the word in it is still allowed.
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
update public.businesses
   set description = 'Sunny terrace, zebrafinch on the counter, good toast.'
 where id = pg_temp.biz();

select pg_temp.admin();
select is(pg_temp.stamp(), now(), 'an edit to the words stamps updated_at');

-- ---------------------------------------------------------------------------
-- THE ATTACK: the founder adds a pattern, then the row is written for reasons
-- that have nothing to do with its words
-- ---------------------------------------------------------------------------

insert into public.moderation_blocklist (pattern, category) values ('\yzebrafinch\y', 'spam');

select pg_temp.park();
select lives_ok(
  $$ update public.businesses set verified_at = now() where id = pg_temp.biz() $$,
  'a verdict still lands once the blocklist has grown past the words on the row'
);
select is(pg_temp.stamp(), pg_temp.parked(),
  'and a verdict does not move the edit stamp');

select lives_ok(
  $$ update public.businesses set state = 'flagged', verified_at = null where id = pg_temp.biz() $$,
  'a scan can still take a listing down: the write that matters most is not '
  'blocked by a bio nobody changed'
);
select is(pg_temp.stamp(), pg_temp.parked(),
  'and taking it down is not an edit either');

select lives_ok(
  $$ update public.businesses set state = 'listed', listed_at = now() where id = pg_temp.biz() $$,
  'confirming the email still lists it'
);

-- The owner's own non-text write: a switch, through the RLS grant.
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
select lives_ok(
  $$ update public.businesses set public_preview = false where id = pg_temp.biz() $$,
  'the owner can flip public_preview without being told their text breaks the rules'
);
select pg_temp.admin();
select is(pg_temp.stamp(), pg_temp.parked(),
  'and a switch does not move the edit stamp');

-- ---------------------------------------------------------------------------
-- AND THE GUARD HAS NOT GONE TOO FAR
-- ---------------------------------------------------------------------------

-- An edit to the words re-reads all of them: the hours note is clean, the
-- description is not any more, and the whole row is refused - exactly as
-- before, which is what an edit has always cost.
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
select throws_ok(
  $$ update public.businesses set hours_note = 'Closed Mondays' where id = pg_temp.biz() $$,
  '23514', null,
  'an edit to any of the five still screens all five'
);

-- Take the word out and the edit goes through, and stamps.
select pg_temp.admin();
select pg_temp.park();
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
update public.businesses
   set description = 'Sunny terrace, good toast.'
 where id = pg_temp.biz();
select pg_temp.admin();
select is(pg_temp.stamp(), now(), 'a real edit still stamps');

-- Re-saving the same words is not an edit.
select pg_temp.park();
select pg_temp.login('00000000-0000-0000-0000-0000000000e6');
update public.businesses
   set description = 'Sunny terrace, good toast.'
 where id = pg_temp.biz();
select pg_temp.admin();
select is(pg_temp.stamp(), pg_temp.parked(),
  're-saving a listing unchanged is not an edit and does not stamp');

-- A new row's words have never been read, so insert still screens.
select throws_ok(
  $$ insert into public.businesses (city_id, name, category, lat, lng, description)
     values ((select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
             'Zebrafinch Bar', 'bar', 38.7108, -9.1400, null) $$,
  '23514', null,
  'a new listing is still screened on insert'
);

select * from finish();
rollback;
