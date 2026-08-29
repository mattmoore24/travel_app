-- A photo of a business that somebody other than its owner can see.
--
-- `business_photos.moderation_status` defaulted to 'pending' and NOTHING ever
-- moved it. `profile_photos` gets `moderate_photo_stub` on insert; business
-- photos were given the same column, the same enum, and the same
-- `= 'approved'` filter on every read, and no trigger at all. Two consequences,
-- and the second is the one that reached the founder:
--
--   * no photo of a business had ever been visible to a traveler — not the
--     cover on the map, not the place sheet, not the chat list;
--   * business signup's photo step could not be passed, because the count it
--     gates on comes from `business_detail`, which filters on 'approved', so
--     it was pinned at zero however many photos went in, and Continue just
--     reopened the editor.
--
-- Its own file rather than an addition to 22, because that suite deliberately
-- renames its business and then darkens it for the impersonation checks, so
-- there is no live listing left at the end to hang a photo on.
begin;
select plan(8);

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

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b7', 'traveler@example.com');

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Verde' $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select public.register_business('Casa Verde', 'cafe',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);

-- Listed, so the traveler-facing reads are looking at it at all.
select pg_temp.admin();
update public.businesses
   set state = 'listed', listed_at = now()
 where id = pg_temp.biz();

-- THE FLAG-OFF BRANCH, which is what a keyless dev project and this suite run.
select is(
  (select value from public.app_config where key = 'require_photo_moderation'),
  'false',
  'the suite runs with photo moderation off'
);

insert into public.business_photos (business_id, storage_path, position)
values (pg_temp.biz(), 'biz/casa-verde/cover.jpg', 0);

select is(
  (select moderation_status::text from public.business_photos
    where storage_path = 'biz/casa-verde/cover.jpg'),
  'approved',
  'a business photo is approved on insert, exactly as a profile photo is'
);

select is(
  (select count(*)::int from public.moderation_events
    where entity_type = 'business_photo' and action = 'auto_approved'),
  1,
  'and the ledger records who approved it and why'
);

-- The read that matters: the map's cover, which had never once been non-null.
select pg_temp.guest();
select is(
  (select cover_path from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Casa Verde'),
  'biz/casa-verde/cover.jpg',
  'so a traveler sees the cover on the map'
);

-- And the count business signup's photo step gates on.
select is(
  (select jsonb_array_length(photos) from public.business_detail(pg_temp.biz())),
  1,
  'and business_detail counts it, which is what lets the photo step be passed'
);

-- THE FLAG-ON BRANCH, which is how production runs (LAUNCH_RUNBOOK step 1).
-- Fail closed: the photo holds, and only the worker can move it.
select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';
insert into public.business_photos (business_id, storage_path, position)
values (pg_temp.biz(), 'biz/casa-verde/second.jpg', 1);

select is(
  (select moderation_status::text from public.business_photos
    where storage_path = 'biz/casa-verde/second.jpg'),
  'pending',
  'with the flag on it holds at pending instead of going live unscreened'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.apply_business_photo_verdict(
       (select id from public.business_photos
         where storage_path = 'biz/casa-verde/second.jpg'),
       '{"action":"allow"}'::jsonb) $$,
  NULL,
  'and an owner cannot approve their own photo: the verdict is the worker''s door'
);

select pg_temp.admin();
select public.apply_business_photo_verdict(
  (select id from public.business_photos where storage_path = 'biz/casa-verde/second.jpg'),
  '{"action":"allow","engine":"claude-moderator"}'::jsonb
);
select is(
  (select moderation_status::text from public.business_photos
    where storage_path = 'biz/casa-verde/second.jpg'),
  'approved',
  'the worker can, which is the half that makes the flag-on path work at all'
);

select * from finish();
rollback;
