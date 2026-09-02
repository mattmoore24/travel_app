-- A PUSH THAT FAILED SAYS SO, and only the worker can read that it did.
--
-- 20260903120000 gives push_queue two nullable columns, `attempts` and
-- `last_error`, so a row Expo refused (InvalidCredentials with no APNs key,
-- MessageTooBig, a request answered with no tickets) is retried with a count
-- and a reason instead of being stamped sent_at as if it had gone. This file
-- pins the shape the worker depends on and the one privacy fact about it.
--
-- EVERY ASSERTION HERE WAS RUN AGAINST THE MUTATION THAT REMOVES WHAT IT
-- NAMES (2026-09-02). With `add column attempts integer` deleted from the
-- migration, 1 and 3 fail and 7 dies on the unknown column; with it made
-- `not null default 0`, 2 fails ("should allow NULL"); with `last_error`
-- deleted, 4 and 6 fail and 7 dies; with `text` changed to `varchar(80)`, 6
-- fails; with `grant select (attempts, last_error) on public.push_queue to
-- authenticated` appended to the migration, 8 comes back "lives" instead of
-- 42501. 7 is the worker's own bookkeeping statement, run as the role the
-- worker runs as, and it asserts the thing the round is about: sent_at is
-- still NULL on a refused row.
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
