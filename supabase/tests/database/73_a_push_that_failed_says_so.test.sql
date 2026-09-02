-- A PUSH THAT FAILED SAYS SO, and only the worker can read that it did.
--
-- 20260903120000 gives push_queue two nullable columns, `attempts` and
-- `last_error`, so a row Expo refused (InvalidCredentials with no APNs key,
-- MessageTooBig, a request answered with no tickets) is retried with a count
-- and a reason instead of being stamped sent_at as if it had gone. This file
-- pins the shape the worker depends on and the one privacy fact about it.
--
-- EVERY ASSERTION HERE WAS RUN AGAINST THE MUTATION THAT REMOVES WHAT IT
-- NAMES (2026-09-02, second pass on a rebuilt cluster), and this record
-- replaces a wrong one: three of the five lines below named the wrong
-- assertions, and two of them under-counted what a missing column does to a
-- pgTAP file. What actually happens, measured:
--
--   `add column attempts integer` deleted from the migration
--     1, 2 AND 3 fail (2 reports "Column public.push_queue.attempts does not
--     exist" rather than "should allow NULL"), 4 to 6 still run and pass,
--     and then the worker's UPDATE - assertion 7's setup, not an assertion -
--     raises 42703 and takes the whole file with it: 6 of 8 planned, so 7
--     and 8 never run. A missing column is louder than an assertion -
--     pg_prove reports "Bad plan. You planned 8 tests but ran 6" on top of
--     the three failures.
--
--   `attempts integer` made `not null default 0`
--     2 alone ("should allow NULL"). This is the only mutation of the five
--     that fails exactly one assertion and leaves the file intact.
--
--   `add column last_error text` deleted
--     4, 5 and 6 fail, and the same UPDATE kills the file, so 7 and 8 never
--     run (6 of 8 planned). Symmetrical with the first.
--
--   `text` changed to `varchar(80)`
--     6 AND 7 fail. 7 is not a second opinion about the type: results_eq
--     compares the two queries column by column and raises "cannot compare
--     dissimilar column types character varying and text at record column
--     2", so the bookkeeping assertion cannot even run against a narrowed
--     column. A ticket error is not a length-bounded thing and this is what
--     holds it open.
--
--   `grant select (attempts, last_error) on public.push_queue to
--   authenticated` appended
--     8 alone, "caught: no exception / wanted: 42501".
--
-- 7 is the worker's own bookkeeping statement, run as the role the worker
-- runs as, and it asserts the thing the round is about: sent_at is still
-- NULL on a refused row.
begin;
select plan(8);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

create function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'ana@example.com');

-- 1-3. The counter: present, nullable (NULL is zero; a default would be a new
-- state every existing row silently acquired), an integer.
select has_column('public', 'push_queue', 'attempts', 'push_queue.attempts exists');
select col_is_null('public', 'push_queue', 'attempts', 'attempts is nullable: NULL is zero');
select col_type_is('public', 'push_queue', 'attempts', 'integer', 'attempts is an integer');

-- 4-6. The reason: present, nullable (NULL once the row goes out), text.
select has_column('public', 'push_queue', 'last_error', 'push_queue.last_error exists');
select col_is_null('public', 'push_queue', 'last_error', 'last_error is nullable: NULL is "went out"');
select col_type_is('public', 'push_queue', 'last_error', 'text', 'last_error is text');

-- A queued row, the way every enqueue trigger writes one.
insert into public.push_queue (user_id, title, body)
values ('00000000-0000-0000-0000-0000000000d1', 'Ana', 'said hi');

-- 7. The worker's refusal bookkeeping, as the worker: the count moves, the
-- reason is named, and sent_at is still NULL, so the next tick finds the row.
select pg_temp.service();
update public.push_queue
   set attempts = coalesce(attempts, 0) + 1, last_error = 'InvalidCredentials'
 where user_id = '00000000-0000-0000-0000-0000000000d1' and sent_at is null;
select results_eq(
  $$ select attempts, last_error, (sent_at is null)
       from public.push_queue
      where user_id = '00000000-0000-0000-0000-0000000000d1' $$,
  $$ values (1, 'InvalidCredentials'::text, true) $$,
  'a refused row keeps sent_at NULL and records the attempt and the ticket error by name'
);
select pg_temp.admin();

-- 8. The record is as server-only as the queue it sits on. The shim mirrors
-- Supabase's default privileges (every new relation is handed to anon and
-- authenticated), and a new COLUMN on a table revoked at the table level
-- inherits nothing; this is the assertion rather than the assumption.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok(
  $$ select attempts, last_error from public.push_queue $$,
  '42501', null,
  'a signed-in traveler cannot read the refusal record, not even their own'
);

select * from finish();
rollback;
