-- THE 18+ RULE WAS HALF IN THE CLIENT.
--
-- `profiles.age` has carried `check (age is null or age between 18 and 120)`
-- since 20260816190000, so no one can ever RECORD an age under eighteen. That
-- half was always real. The other half was not: the column is nullable,
-- `authenticated` holds an update grant on both `age` and
-- `onboarding_completed_at`, and `is_discoverable_owner` asks only whether the
-- stamp is present. Talking to the API directly, an account could finish
-- onboarding with no age at all - or finish with one and then clear it - and be
-- discoverable either way.
--
-- The app itself never does this. Its basics step will not advance until name,
-- age and gender validate. That is precisely the complaint: the gate lived in
-- a React component, on a rule the product brief and the App Store listing
-- both state as a fact about the service.
--
-- These four assertions are the rule as the SERVER sees it. Two of them would
-- pass before 20260906120000 and two would not, which is what makes the file
-- worth its plan.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ada@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'biz@example.com');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end
$$;

-- The row starts as onboarding created it: no age, not finished.
select is(
  (select age from public.profiles where user_id = '00000000-0000-0000-0000-0000000000e1'),
  null,
  'a fresh profile has no age yet'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');

-- 1. THE DIRECT-API PATH, which is the whole finding.
select throws_ok(
  $$ update public.profiles set onboarding_completed_at = now()
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514',
  null,
  'a profile cannot be stamped finished with no age'
);

-- 2. The ordinary path still works, in the order the app writes it: age on an
--    earlier step, the stamp on the last one.
select lives_ok(
  $$ update public.profiles set age = 28
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'an age can be set on an unfinished profile'
);
select lives_ok(
  $$ update public.profiles set onboarding_completed_at = now()
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'and then the profile can be finished'
);

-- 3. The other direction. Finishing and then clearing the age would leave a
--    discoverable profile with no age on record just as surely.
select throws_ok(
  $$ update public.profiles set age = null
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514',
  null,
  'and the age cannot be taken back off a finished profile'
);

-- 4. THE COUNTERPART THAT MUST NOT BREAK. A business account is defined as one
--    whose onboarding_completed_at stays NULL (20260827100000), and a business
--    has no age. A blanket NOT NULL on the column would have broken every one
--    of them, which is why this is a trigger conditioned on the stamp.
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select lives_ok(
  $$ update public.profiles set display_name = 'Cafe Central', age = null
     where user_id = '00000000-0000-0000-0000-0000000000e2' $$,
  'a business profile, which never carries the stamp, keeps its null age'
);

rollback;
