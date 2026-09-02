-- A VERDICT THE FOUNDER CAN READ, and nobody else can.
--
-- 20260903040000 adds two service-role views over the two verification
-- tables, each carrying `reason` (what the person was shown, in their own
-- language) beside `reason_en` (what it says). This file is the attack, not
-- the happy path: a view over verification_requests is a list of everybody
-- whose selfie was refused, and a view created without its `revoke` passes
-- a happy-path test perfectly - Supabase's default privileges hand every new
-- relation in `public` to anon and authenticated, and the local shim mirrors
-- that (local_supabase_shim.sql:98), which is what lets the two refusals
-- below FAIL when the revoke is deleted from the migration rather than pass
-- by accident. Measured: with either `revoke all on ...` line removed, the
-- two assertions about that view come back "lives" instead of 42501.
--
-- The last two assertions are the reason the views exist: reason_en is
-- really there, in English, beside a reason that is not. Remove the
-- `v.verdict ->> 'reason_en'` expression and they fail on a missing column;
-- write a verdict without reason_en and they fail on NULL.
begin;
select plan(11);

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
  ('00000000-0000-0000-0000-0000000000f1', 'nok@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'owner@example.com');

-- Two settled verdicts and one still pending, written the way the worker
-- writes them: `reason` in the subject's language, `reason_en` in English.
insert into public.verification_requests (user_id, storage_path, status, reason, verdict, reviewed_at)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1/selfie.jpg',
   'rejected', 'เซลฟี่มืดเกินไปที่จะเปรียบเทียบ',
   '{"action":"reject","engine":"claude-verifier",
     "reason":"เซลฟี่มืดเกินไปที่จะเปรียบเทียบ",
     "reason_en":"The selfie is too dark to compare. Try one in daylight."}'::jsonb,
   now()),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1/again.jpg',
   'pending', null, null, null);

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select public.register_business('Bar Sombra', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);

select pg_temp.admin();
insert into public.business_verifications (business_id, wide_path, close_path, status, reason, verdict, reviewed_at)
values (
  (select id from public.businesses where name = 'Bar Sombra'),
  'wide.jpg', 'close.jpg', 'rejected',
  'A placa não está legível na foto de perto.',
  '{"action":"reject","engine":"claude-storefront",
    "reason":"A placa não está legível na foto de perto.",
    "reason_en":"The sign is not readable in the close shot. Get nearer."}'::jsonb,
  now()
);

-- ---------------------------------------------------------------------------
-- THE ATTACK: a traveler, then a visitor, asks for the queue
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select throws_ok(
  $$ select * from public.admin_verification_queue $$,
  '42501', null,
  'a signed-in traveler cannot read the selfie queue, not even their own row'
);
select throws_ok(
  $$ select * from public.admin_business_verification_queue $$,
  '42501', null,
  'nor the storefront queue'
);

select pg_temp.guest();
select throws_ok(
  $$ select * from public.admin_verification_queue $$,
  '42501', null,
  'a visitor with the anon key cannot read the selfie queue'
);
select throws_ok(
  $$ select * from public.admin_business_verification_queue $$,
  '42501', null,
  'nor the storefront queue'
);

-- ---------------------------------------------------------------------------
-- THE READER: the service role, which is the SQL editor
-- ---------------------------------------------------------------------------

select pg_temp.service();
select lives_ok(
  $$ select * from public.admin_verification_queue $$,
  'the service role can read the selfie queue'
);
select lives_ok(
  $$ select * from public.admin_business_verification_queue $$,
  'and the storefront queue'
);

select is(
  (select reason_en from public.admin_verification_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  'The selfie is too dark to compare. Try one in daylight.',
  'the selfie row carries the English sentence, not a silent null'
);
select is(
  (select reason from public.admin_verification_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  'เซลฟี่มืดเกินไปที่จะเปรียบเทียบ',
  'beside the sentence the person was actually shown'
);
select is(
  (select count(*)::int from public.admin_verification_queue
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1,
  'and the one still pending is not in the queue: it has no verdict to read'
);

select is(
  (select reason_en from public.admin_business_verification_queue
    where business_name = 'Bar Sombra'),
  'The sign is not readable in the close shot. Get nearer.',
  'the storefront row carries its English, joined to the business by name'
);
select is(
  (select reason from public.admin_business_verification_queue
    where business_name = 'Bar Sombra'),
  'A placa não está legível na foto de perto.',
  'beside the owner''s own'
);

select * from finish();
rollback;
