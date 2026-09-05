-- A per-account muted-word list, written as the attack.
--
-- The list is only worth anything if the DATABASE keeps it. A client that
-- hides a screen proves nothing: user_muted_words is a PostgREST table like
-- any other, so the two questions that matter are whether one traveler can
-- read another's list, and whether anybody can write a row under somebody
-- else's name. Both are asked here as a stranger, not as the owner.
--
-- The third question is quieter and it is the one the feature's whole
-- credibility rests on: the words are stored folded (lower case, trimmed,
-- single-spaced), because a list that shows 'Ass' and 'ass ' as two separate
-- entries reads as broken, and a primary key that treats them as different
-- rows is what makes that happen.
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'nina@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'omar@example.com');

update public.profiles set
  display_name = 'traveler', age = 27, home_country = 'US',
  languages = array['en'], onboarding_completed_at = now();

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

-- YOUR OWN LIST ----------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

select lives_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', 'hook up') $$,
  'a traveler can put a word on their own list'
);
select lives_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', 'ass') $$,
  'and a second one'
);
select is(
  (select count(*)::int from public.user_muted_words),
  2,
  'and reads back exactly the two they wrote'
);

-- ...AND NOBODY ELSE'S ---------------------------------------------------------
--
-- The select half. RLS filters rather than throwing, so the assertion has to
-- be about the COUNT: a leak here does not raise, it simply answers.

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(
  (select count(*)::int from public.user_muted_words),
  0,
  'another traveler selecting the whole table gets nothing at all'
);
select is(
  (select count(*)::int from public.user_muted_words
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'and naming the owner explicitly does not help'
);

-- The write half. `with check` is what refuses this: without it the policy
-- would filter reads and let an insert under somebody else's id straight
-- through, which is how a "personal" list becomes a way to write on a
-- stranger's account.
select throws_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', 'planted') $$,
  '42501',
  null,
  'an insert naming another user_id is refused outright'
);

select lives_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f2', 'planted') $$,
  'while the same word under their own name is fine'
);

-- Moving your own row onto somebody else is the same attack wearing an
-- UPDATE, and it is refused one step earlier than it used to be: nothing in
-- this app ever updates a row here, so nothing may. The whole row IS the key
-- (user_id, word), the editor diffs the list into inserts and deletes
-- (src/features/profile/muted-words.ts), and src/lib/database.types.ts
-- declares this table's `Update` as `never`. The verb is revoked rather than
-- merely left out of the grant list, because Supabase's default privileges had
-- already handed it to authenticated - a grant list that simply omits it takes
-- nothing back.
select throws_ok(
  $$ update public.user_muted_words
        set user_id = '00000000-0000-0000-0000-0000000000f1'
      where word = 'planted' $$,
  '42501',
  null,
  'and an update cannot hand a row to another account either'
);

-- The same refusal for the harmless-looking version: their own row, their own
-- word.
--
-- BOTH of these measure the revoke, and it is worth saying why rather than
-- leaving it to be rediscovered. There is no UPDATE policy on this table at
-- all now, and RLS with no applicable policy does not RAISE - it matches no
-- rows, so the statement reports success and changes nothing. Grant UPDATE
-- back and the assertion above stops throwing without the row moving:
-- measured, `caught: no exception`. A silent zero-row update is not a refusal
-- anybody can see, so the privilege itself is what has to be gone, and the
-- assertion after these two says so from the catalog.
select throws_ok(
  $$ update public.user_muted_words set word = 'hookup'
      where user_id = '00000000-0000-0000-0000-0000000000f2'
        and word = 'planted' $$,
  '42501',
  null,
  'and an owner cannot rewrite their own row either: this list takes adds and removals'
);

-- A delete does not throw: RLS makes the row invisible, so the statement
-- succeeds and removes nothing. The assertion has to be that the owner's list
-- survived it.
select lives_ok(
  $$ delete from public.user_muted_words
      where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  'deleting another traveler''s list appears to succeed'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.user_muted_words
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  2,
  'and removes nothing whatsoever'
);

-- The catalog, not just the behaviour: three verbs granted and the fourth
-- gone. Read as the superuser because information_schema shows a role only
-- what it is a member of.
select is(
  (select array_agg(privilege_type::text order by privilege_type::text collate "C")
     from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'user_muted_words'
      and grantee = 'authenticated'),
  array['DELETE', 'INSERT', 'SELECT']::text[],
  'and authenticated holds exactly select, insert and delete on the list'
);

-- STORED FOLDED ----------------------------------------------------------------
--
-- Not a privacy question, a credibility one: two rows that do the same thing
-- make the screen look broken, and the primary key can only dedupe what is
-- already in one shape.

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select throws_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', 'Ass') $$,
  '23514',
  null,
  'an unfolded word is refused rather than stored beside its own twin'
);
select throws_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', ' hook  up ') $$,
  '23514',
  null,
  'and so is one padded or double-spaced'
);

-- The key itself, not just the checks that feed it. The checks make every
-- spelling of one word arrive in the same shape; this is the thing that then
-- refuses the second copy of it.
select throws_ok(
  $$ insert into public.user_muted_words (user_id, word)
     values ('00000000-0000-0000-0000-0000000000f1', 'ass') $$,
  '23505',
  null,
  'and a word already on the list cannot be added to it twice'
);

-- TAKING ONE OFF -----------------------------------------------------------
--
-- The other half of the editor, and the half the client had never actually
-- exercised: useSetMutedWords read the list it was diffing against out of a
-- cache its own optimistic write had already overwritten, so the delete below
-- was computed as empty and never sent. The screen looked right for the whole
-- session and the row stayed. Written here in the exact shape the client
-- sends (`where user_id = ... and word = any (...)`), so the policy that has
-- to permit it is asserted rather than assumed.
select lives_ok(
  $$ delete from public.user_muted_words
      where user_id = '00000000-0000-0000-0000-0000000000f1'
        and word = any (array['ass']) $$,
  'a traveler can take a word back off their own list'
);
select is(
  (select count(*)::int from public.user_muted_words),
  1,
  'and it is actually gone, not merely invisible to them'
);

-- SIGNED OUT ---------------------------------------------------------------
--
-- The policy is scoped `to authenticated`, so for anon it is not that the
-- rows are filtered - there is no policy for anon at all, and a table left
-- with Supabase's default grant would answer an anon client with an empty
-- result rather than a refusal. The revoke is what makes this throw, and this
-- is the assertion that fails the moment somebody drops it.
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.user_muted_words $$,
  '42501',
  null,
  'a signed-out client has no privilege on the table at all'
);

select * from finish();
rollback;
