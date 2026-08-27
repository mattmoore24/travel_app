-- Business content, listing, verification and reports.
--
-- Written as attacks on the two things this half of the feature promises: a
-- listing that is dark shows NOTHING, and the verified badge cannot be
-- obtained by any route except two photos of a real storefront.
begin;
select plan(47);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'ana@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'hostel@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'carl@example.com');

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
  perform set_config('request.jwt.claims', null, true);
  reset role;
end
$$;

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Azul' $$;

update public.profiles set
  display_name = 'Ana', age = 27, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now()
where user_id in ('00000000-0000-0000-0000-0000000000a2',
                  '00000000-0000-0000-0000-0000000000c2');

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select public.register_business('Casa Azul', 'bar',
  (select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
  38.7108, -9.1400);

-- CONTENT IS AS DARK AS THE LISTING ----------------------------------------

select pg_temp.admin();
insert into public.business_photos (business_id, storage_path, position, moderation_status)
values (pg_temp.biz(), '00000000-0000-0000-0000-0000000000b2/cover.jpg', 0, 'approved');
insert into public.business_links (business_id, kind, label, value)
values (pg_temp.biz(), 'reservations', 'Book a table', 'https://casaazul.example/book');
insert into public.business_hours (business_id, weekday, opens, closes)
values (pg_temp.biz(), 4, '18:00', '02:00');
insert into public.business_posts (business_id, title, body)
values (pg_temp.biz(), 'Live music tonight', 'From ten, no cover.');

-- The listing is still `unconfirmed`, so every one of those is invisible.
-- This is the invariant is_visible_business exists to hold in one place
-- instead of four tables each having their own opinion.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(
  (select count(*)::int from public.business_photos where business_id = pg_temp.biz()),
  0,
  'a dark listing shows no photos'
);
select is(
  (select count(*)::int from public.business_links where business_id = pg_temp.biz()),
  0,
  'no links'
);
select is(
  (select count(*)::int from public.business_hours where business_id = pg_temp.biz()),
  0,
  'no hours'
);
select is(
  (select count(*)::int from public.business_posts where business_id = pg_temp.biz()),
  0,
  'and no posts'
);
select is(
  (select count(*)::int from public.business_detail(pg_temp.biz())),
  0,
  'business_detail says nothing about it'
);
select is(
  (select count(*)::int from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Casa Azul'),
  0,
  'and it is not on the map'
);

-- The owner sees their own, because that is the preview they build against.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*)::int from public.business_detail(pg_temp.biz())),
  1,
  'but the owner previews their own listing while it is dark'
);

-- THE CODE THAT PUTS IT ON THE MAP -----------------------------------------

select lives_ok(
  $$ select public.request_business_email_confirmation('hello@casaazul.example') $$,
  'a business can ask for its code'
);
-- Read as admin: outbound_mail has RLS on and no policies at all, which is
-- the point of it. A client that could read the queue could read the code.
select pg_temp.admin();
select is(
  (select count(*)::int from public.outbound_mail where kind = 'business_email_code'),
  1,
  'and the code goes out as queued mail, not as a direct send'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
-- The code is hashed and never returned, so holding this row is not holding
-- the code. Everything below has to go through the compare.
select throws_ok(
  $$ select public.confirm_business_email('000000') $$,
  'that code is not right',
  'a wrong code is refused'
);

select pg_temp.admin();
-- Stand in for reading the inbox.
update public.business_email_confirmations
   set code_hash = encode(sha256(convert_to('123456', 'UTF8')), 'hex');

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is(
  (public.confirm_business_email('123456')) ->> 'confirmed',
  'true',
  'and the right one confirms'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(
  (select count(*)::int from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Casa Azul'),
  1,
  'which is what puts the place on the map'
);
select is(
  (select count(*)::int from public.business_photos where business_id = pg_temp.biz()),
  1,
  'and brings its content with it'
);
-- The badge is a separate thing entirely, and this is the assertion that
-- says so: an email click buys a listing, never a check mark.
select is(
  (select verified from public.businesses where id = pg_temp.biz()),
  false,
  'but confirming an email buys no badge'
);

-- LINKS ARE THE ONE CHOKEPOINT ---------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     select id, 'website', 'Us', 'javascript:alert(1)' from public.businesses
      where name = 'Casa Azul' $$,
  'links have to start with https://',
  'a javascript: href never becomes a button somebody taps'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     select id, 'website', 'Us', 'http://casaazul.example' from public.businesses
      where name = 'Casa Azul' $$,
  'links have to start with https://',
  'and neither does plain http'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     select id, 'website', 'Us', 'https://203.0.113.9/x' from public.businesses
      where name = 'Casa Azul' $$,
  'that link needs a real domain',
  'an IP literal is never a real business website'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     select id, 'website', 'you are so sexy', 'https://casaazul.example' from public.businesses
      where name = 'Casa Azul' $$,
  'that text breaks our community guidelines',
  'and a link label is screened like any other broadcast text'
);

-- POSTS ---------------------------------------------------------------------

-- An unverified business gets a smaller ceiling. Not a paywall: it is a
-- reason to finish the storefront check, and nothing core is withheld.
select lives_ok(
  $$ insert into public.business_posts (business_id, title)
     select id, 'Second' from public.businesses where name = 'Casa Azul' $$,
  'a second post is fine'
);
select lives_ok(
  $$ insert into public.business_posts (business_id, title)
     select id, 'Third' from public.businesses where name = 'Casa Azul' $$,
  'and a third'
);
select throws_ok(
  $$ insert into public.business_posts (business_id, title)
     select id, 'Fourth' from public.businesses where name = 'Casa Azul' $$,
  'you have as many posts up as you can have at once',
  'but an unverified business stops at three live posts'
);

-- The founder's rule: expiry is the business's choice, including never.
select pg_temp.admin();
update public.business_posts set happens_at = now() - interval '2 days'
  where title = 'Live music tonight';
select is(
  public.archive_expired_posts(),
  1,
  'a dated event takes itself down the morning after'
);
select is(
  (select count(*)::int from public.business_posts
    where business_id = pg_temp.biz() and archived_at is null),
  2,
  'and a post with no end date stays up, which is the whole founder decision'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');

-- THE BADGE ------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$ select public.submit_business_verification(
       '00000000-0000-0000-0000-0000000000b2/a.jpg',
       '00000000-0000-0000-0000-0000000000b2/a.jpg') $$,
  'we need two different photos',
  'one photo twice is not two photos'
);
select throws_ok(
  $$ select public.submit_business_verification(
       '00000000-0000-0000-0000-0000000000c2/a.jpg',
       '00000000-0000-0000-0000-0000000000b2/b.jpg') $$,
  'those photos must live in your own storage folder',
  'and they have to be yours'
);
select throws_ok(
  $$ select public.submit_business_verification(
       '00000000-0000-0000-0000-0000000000b2/a.jpg',
       '00000000-0000-0000-0000-0000000000b2/b.jpg') $$,
  'photo upload not found',
  'and they have to actually exist'
);

select pg_temp.admin();
insert into storage.objects (bucket_id, name, owner)
values ('business-verification', '00000000-0000-0000-0000-0000000000b2/a.jpg',
        '00000000-0000-0000-0000-0000000000b2'),
       ('business-verification', '00000000-0000-0000-0000-0000000000b2/b.jpg',
        '00000000-0000-0000-0000-0000000000b2');

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is(
  (public.submit_business_verification(
     '00000000-0000-0000-0000-0000000000b2/a.jpg',
     '00000000-0000-0000-0000-0000000000b2/b.jpg')) ->> 'status',
  'pending',
  'two real photos go into the queue'
);
select throws_ok(
  $$ select public.submit_business_verification(
       '00000000-0000-0000-0000-0000000000b2/a.jpg',
       '00000000-0000-0000-0000-0000000000b2/b.jpg') $$,
  'your photos are already being checked',
  'one at a time'
);

-- The owner reads the outcome and the sentence, never the evidence.
select lives_ok(
  $$ select id, status, reason from public.business_verifications $$,
  'the owner sees the status of their own check'
);
select throws_ok(
  $$ select verdict from public.business_verifications $$,
  '42501',
  null,
  'but never the model verdict'
);
select throws_ok(
  $$ select wide_path from public.business_verifications $$,
  '42501',
  null,
  'nor the paths to the evidence'
);

-- The badge is service-role only, by two independent mechanisms: the EXECUTE
-- revoke, and assert_service_caller inside the function in case a future
-- grant regression undoes the first.
select throws_ok(
  $$ select public.apply_business_verification_verdict(
       (select id from public.business_verifications limit 1),
       '{"action":"approve"}'::jsonb) $$,
  '42501',
  null,
  'and a business cannot award itself the badge'
);

select pg_temp.admin();
select public.apply_business_verification_verdict(
  (select id from public.business_verifications limit 1),
  '{"action":"approve","confidence":0.9,"reason":"sign matches"}'::jsonb
);
select is(
  (select verified from public.businesses where id = pg_temp.biz()),
  true,
  'two photos of a real storefront are what earn the check'
);
-- The one thing a confirmation step genuinely stops.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  $$ update public.businesses set name = 'Marriott Lisbon' where name = 'Casa Azul' $$,
  'a business can rename itself'
);
select is(
  (select verified from public.businesses where name = 'Marriott Lisbon'),
  false,
  'but renaming costs the badge, which closes verify-a-shack-become-the-Marriott'
);
select pg_temp.guest();
select is(
  (select count(*)::int from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Marriott Lisbon'),
  0,
  'and takes it off the map until the email is confirmed again'
);

-- REPORTS --------------------------------------------------------------------

select pg_temp.admin();
update public.businesses set state = 'listed', listed_at = now() where name = 'Marriott Lisbon';

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
-- The business-account guard fires ahead of the self-report one, which is
-- the right order: a report emails support and queues an impersonation scan
-- on the FIRST one, so a business account may not file any report, on a
-- rival or on itself. The owns_business check underneath still earns its
-- place — a STAFF member is a traveler account and reaches it.
select throws_ok(
  $$ select public.report_business(
       (select id from public.businesses where name = 'Marriott Lisbon'),
       'not_this_business') $$,
  'a business account cannot do that',
  'nobody reports themselves, and no place reports anybody'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.report_business(
       (select id from public.businesses where name = 'Marriott Lisbon'),
       'not_this_business', 'this is a bar') $$,
  'a traveler reports a place'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.outbound_mail where kind = 'business_reported'),
  1,
  'which emails the support inbox straight away'
);
-- **[founder]** the FIRST report, not the third.
select is(
  (select count(*)::int from public.business_scans),
  1,
  'and queues a machine read of the whole listing on the FIRST report'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');

-- One account is one voice, or "the first report triggers a scan" would mean
-- "one account can trigger a scan as often as it likes".
select lives_ok(
  $$ select public.report_business(
       (select id from public.businesses where name = 'Marriott Lisbon'),
       'spam_or_offensive') $$,
  'the same account reporting twice is quietly a no-op'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.business_reports),
  1,
  'and leaves one report'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select lives_ok(
  $$ select public.report_business(
       (select id from public.businesses where name = 'Marriott Lisbon'),
       'not_a_real_place') $$,
  'a second person can report the same place'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.business_scans),
  1,
  'but two reports in a day are one question, so one scan'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');

-- Nobody but the founder ever sees who reported what, which is what makes
-- reporting a business safe to do.
select throws_ok(
  $$ select * from public.business_reports $$,
  '42501',
  null,
  'and nobody can read who reported whom'
);

select pg_temp.admin();
select public.apply_business_scan_verdict(
  (select id from public.business_scans limit 1),
  '{"impersonation_plausible":true,"reason":"a bar calling itself a Marriott"}'::jsonb
);
select pg_temp.guest();
select is(
  (select count(*)::int from public.city_businesses(
    (select id from public.cities where name = 'Lisbon' and country_code = 'PT'))
    where name = 'Marriott Lisbon'),
  0,
  'a plausible impersonation verdict darkens the listing immediately'
);
select pg_temp.admin();
select is(
  (select count(*)::int from public.outbound_mail where kind = 'business_flagged'),
  1,
  'and tells the founder it happened'
);

select * from finish();
rollback;
