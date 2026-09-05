-- A Sign in with Apple refresh token is readable by nobody with an API key.
--
-- Written as the attack. The row is a credential against Apple issued in
-- somebody else's name, so the interesting question is not "does the app
-- work" but "what can a signed-in stranger, or the owner, do with the anon
-- key in their hands". The answer has to be nothing at all: not select, not
-- insert, not update, not delete, and not count.
--
-- RLS with no policies would already answer select and update; the revoke is
-- what answers insert, and both are asserted because either one alone is a
-- single edit away from being undone.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'apple-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'apple-stranger@example.com');

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

-- The service role writes it. That path is the only one that exists.
insert into public.apple_refresh_tokens (user_id, refresh_token)
values ('00000000-0000-0000-0000-0000000000e1', 'rt-owner-secret');

select is(
  (select count(*)::int from public.apple_refresh_tokens),
  1,
  'the service role can keep a refresh token'
);

-- The owner is the strongest case for a leak: it is their own identity, and
-- every other table in this schema lets them read their own row.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');

select throws_ok(
  $$ select * from public.apple_refresh_tokens $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'the owner cannot read their own Apple refresh token'
);

select throws_ok(
  $$ select count(*) from public.apple_refresh_tokens $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'the owner cannot even count the rows'
);

select throws_ok(
  $$ insert into public.apple_refresh_tokens (user_id, refresh_token)
     values ('00000000-0000-0000-0000-0000000000e1', 'forged') $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'the owner cannot plant a token of their own'
);

select throws_ok(
  $$ update public.apple_refresh_tokens set refresh_token = 'forged' $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'the owner cannot overwrite the token'
);

select throws_ok(
  $$ delete from public.apple_refresh_tokens $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'the owner cannot delete the token'
);

-- A stranger, for the enumerability half: a policy-less table plus a grant
-- would have made this table readable in bulk by anyone holding the anon key.
select pg_temp.admin();
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');

select throws_ok(
  $$ select refresh_token from public.apple_refresh_tokens $$,
  '42501',
  'permission denied for table apple_refresh_tokens',
  'a stranger cannot read anybody''s Apple refresh token'
);

select pg_temp.admin();

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'apple_refresh_tokens'),
  0,
  'the table carries no policy at all, which is the point'
);

-- Deleting the account takes the token with it, so a revoke that failed can
-- never leave a live credential behind after the row it belongs to is gone.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';

select is(
  (select count(*)::int from public.apple_refresh_tokens
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'the token cascades away with the user'
);

select * from finish();
rollback;
