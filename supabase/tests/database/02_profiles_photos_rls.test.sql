-- Profiles: owner-only writes, server-owned verification state, shadowban
-- visibility. Photos: moderation stub + audit trail, 7-photo cap, owner gating.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

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

-- Alice completes her profile.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ update public.profiles
     set display_name = 'Alice', age = 28, home_city = 'Lisbon',
         home_country = 'Portugal', languages = array['en','pt'],
         bio = 'hiking + street food', gender = 'woman',
         onboarding_completed_at = now()
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'owner can update own profile fields'
);

-- Client cannot self-verify (column privilege revoked).
select throws_ok(
  $$ update public.profiles set verified = true
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'verified column is not client-writable'
);

-- Client cannot touch own account status.
select throws_ok(
  $$ update public.users set status = 'active'
     where id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'users table is read-only for clients'
);

-- Age floor enforced in the DB.
select throws_ok(
  $$ update public.profiles set age = 17
     where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'age under 18 rejected by CHECK'
);

-- Bob can browse Alice's (active) profile but cannot modify it.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select display_name from public.profiles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  'Alice',
  'active profiles are visible to other users'
);
create function pg_temp.try_vandalize_profile() returns int language plpgsql as $$
declare n int;
begin
  update public.profiles set bio = 'vandalized'
  where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  return n;
end
$$;
select is(
  pg_temp.try_vandalize_profile(),
  0,
  'others cannot update a profile (RLS filters all rows)'
);

-- Photos: Alice uploads; the Phase-1 stub auto-approves and logs an audit row.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position)
     values ('00000000-0000-0000-0000-00000000000a',
             '00000000-0000-0000-0000-00000000000a/p0.jpg', 0) $$,
  'owner can insert own photo'
);
select is(
  (select moderation_status from public.profile_photos
   where storage_path = '00000000-0000-0000-0000-00000000000a/p0.jpg'),
  'approved',
  'moderation stub auto-approves (Phase 5 replaces with real pipeline)'
);

select throws_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position)
     values ('00000000-0000-0000-0000-00000000000b',
             '00000000-0000-0000-0000-00000000000b/fake.jpg', 0) $$,
  '42501',
  null,
  'cannot insert photos for another user'
);

-- Moderation audit trail exists but is invisible to clients.
select throws_ok(
  $$ select count(*) from public.moderation_events $$,
  '42501',
  null,
  'moderation_events is server-only'
);
reset role;
select is(
  (select count(*)::int from public.moderation_events
   where entity_type = 'profile_photo' and action = 'auto_approved'),
  1,
  'stub logged the moderation decision'
);

-- 7-photo cap.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position)
     select '00000000-0000-0000-0000-00000000000a',
            '00000000-0000-0000-0000-00000000000a/p' || i || '.jpg', i
     from generate_series(1, 6) as i $$,
  'can fill all 7 slots'
);
select throws_ok(
  $$ insert into public.profile_photos (user_id, storage_path, position)
     values ('00000000-0000-0000-0000-00000000000a',
             '00000000-0000-0000-0000-00000000000a/p8.jpg', 6) $$,
  '23514',
  null,
  '8th photo rejected'
);

-- Shadowban: Alice disappears for Bob but not for herself.
reset role;
update public.users set status = 'shadowbanned'
  where id = '00000000-0000-0000-0000-00000000000a';

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.profiles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'shadowbanned profile invisible to others (photos follow the same gate)'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.profiles
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'shadowbanned user still sees own profile'
);

select * from finish();
rollback;
