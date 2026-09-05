-- A badge follows the face (20260904100000).
--
-- A verified traveler could swap in a different person's photo and keep the
-- badge: nothing ever set profiles.verified back to false, no trigger on
-- profile_photos watched an UPDATE or a DELETE, and the verdict recorded
-- nothing about which photos it compared. Every assertion below is written as
-- the attack, or as the innocent edit the rule must NOT mistake for one.
--
-- The rule is row-based (what did THIS row just do), not derived (is the lead
-- compared?), because a reorder is several round trips and on a full gallery
-- photoWritePlan (src/features/profile/photo-order.ts) empties slot 0 for one
-- of them. bob's block replays that plan write for write.
--
-- MUTATION CHECK. Each guard in revoke_badge_when_the_face_changes was broken
-- in turn (a copy of the migration, one edit, the whole suite on its own
-- cluster) and the FIRST assertion that failed is recorded, so nothing here
-- survives the deletion of what it tests. Numbers are this file's.
--
--   position rule, drop `new.position = 0`
--       6  alice: "a third photo approved after the check does not take the
--          badge" - the rule runs on every UPDATE the trigger sees, and an
--          approval at position 2 is where it first bites.
--   position rule, drop `new.moderation_status = 'approved'`
--       46 fay: "a pending photo moved to the lead slot does not, yet"
--   position rule, drop `not compared`
--       29 bob: "C, compared, lands at 0: still verified"
--   approval rule, drop `not compared`
--       43 eve: "the founder reinstating the compared lead does not"
--   approval rule, drop `old.moderation_status <> 'approved'`
--       NOT CAUGHT, and no reachable state can: without it a no-op
--       re-approval of an UNCOMPARED lead would revoke, and an uncompared
--       approved lead under a live badge is the state the rule exists to
--       end. Kept as the change-detection it is; `update of` fires on a
--       statement that names the column without changing it.
--   approval rule, drop `no approved photo below it`
--       6  alice, as above (also 32 bob, 38 dave had the file got there)
--   leaves-approval rule, drop `old.id compared`
--       27 bob: "a verdict landing inside the round trip does not"
--   leaves-approval rule, drop `lead after is null or uncompared`
--       42 eve: "moderation rejecting the compared lead, compared successor"
--   delete rule, drop `old.id compared`
--       28 bob: "a delete landing inside the round trip does not"
--   delete rule, drop `lead after is null or uncompared`
--       11 alice: "deleting the lead when the next photo was also compared"
--   the never-on-leaving-0 rule (mutation: ADD `old.position = 0 and
--   new.position <> 0 and lead-after uncompared`, the derived check)
--       26 bob: "A, compared, leaves 0 and the lead is uncompared B"
--   the photo_ids array guard (drop the early return)
--       52 ivy: "a JSON null there is not recorded too". With the key absent
--          (51) the SQL null propagates through `?` to no decision either
--          way; the guard is what makes that deliberate rather than lucky.
--   the two no-op guards, `where p.verified` on the read and `and verified`
--   + `found` on the profile update
--       20 alice: "the same write again files nothing twice" - when BOTH
--          are dropped. Each alone is masked by the other: the read guard is
--          what stops a serial repeat, the update guard is for two
--          transactions that both read verified = true, which no serial test
--          can stage. Defence in depth, both on purpose.
--   the users-row guard
--       not asserted: it is for an account-delete cascade, which
--       delete-account runs through auth.admin and no SQL test replays.
begin;
select plan(53);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'face-alice@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'face-bob@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'face-cara@example.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'face-dave@example.com'),
  ('00000000-0000-0000-0000-0000000000a5', 'face-eve@example.com'),
  ('00000000-0000-0000-0000-0000000000a6', 'face-fay@example.com'),
  ('00000000-0000-0000-0000-0000000000a7', 'face-gus@example.com'),
  ('00000000-0000-0000-0000-0000000000a8', 'face-hal@example.com'),
  ('00000000-0000-0000-0000-0000000000a9', 'face-ivy@example.com');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$$;

-- Back to postgres AND clear the claims: the verdict RPCs runtime-guard on
-- auth.role(), which would otherwise still read the last login's claims.
create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- Fixture FUNCTIONS, not temp tables: `set local role authenticated` has no
-- privileges on anything in pg_temp, and most of what follows runs after
-- that switch. Photos are named, not numbered, because their slots are the
-- thing under test.
create function pg_temp.pid(u uuid, name text) returns uuid language sql
security definer set search_path = public as
  $$ select id from public.profile_photos
     where storage_path = u::text || '/' || name || '.jpg' $$;

create function pg_temp.add(u uuid, name text, slot int) returns void language plpgsql
security definer set search_path = public as $$
begin
  insert into public.profile_photos (user_id, storage_path, position)
  values (u, u::text || '/' || name || '.jpg', slot);
end
$$;

-- The worker's own door, with the worker's own verdict. Call as admin.
create function pg_temp.approve(u uuid, name text) returns void language plpgsql
security definer set search_path = public as $$
begin
  perform public.apply_photo_verdict(pg_temp.pid(u, name),
    '{"action":"allow","category":"ok","engine":"claude-moderator"}'::jsonb);
end
$$;

-- The whole verification flow as it happens: the owner uploads a selfie and
-- submits, the worker answers. Ends as admin.
create function pg_temp.verify(u uuid, verdict jsonb) returns void language plpgsql as $$
declare
  v_path text := u::text || '/' || gen_random_uuid()::text || '.jpg';
begin
  perform pg_temp.login(u);
  insert into storage.objects (bucket_id, name) values ('verification-selfies', v_path);
  perform public.submit_verification(v_path);
  perform pg_temp.admin();
  perform public.apply_verification_verdict(
    (select id from public.verification_requests where user_id = u and status = 'pending'),
    verdict);
end
$$;

create function pg_temp.verified(u uuid) returns boolean language sql
security definer set search_path = public as
  $$ select verified from public.profiles where user_id = u $$;

create function pg_temp.photo_ids(u uuid) returns jsonb language sql
security definer set search_path = public as
  $$ select verification -> 'photo_ids' from public.profiles where user_id = u $$;

create function pg_temp.evidence(u uuid) returns jsonb language sql
security definer set search_path = public as
  $$ select verification from public.profiles where user_id = u $$;

create function pg_temp.visible_to(u uuid) returns text language sql
security definer set search_path = public as
  $$ select visible_to::text from public.profiles where user_id = u $$;

create function pg_temp.revokes(u uuid) returns int language sql
security definer set search_path = public as
  $$ select count(*)::int from public.moderation_events
     where subject_user_id = u and action = 'verification_revoked' $$;

create function pg_temp.pushes(u uuid) returns int language sql
security definer set search_path = public as
  $$ select count(*)::int from public.push_queue
     where user_id = u and title = 'Your badge needs a new selfie' $$;

-- The audit row is server-only; read it through the definer, whoever is
-- logged in when the question is asked.
create function pg_temp.revoke_source(u uuid) returns text language sql
security definer set search_path = public as
  $$ select source from public.moderation_events
     where subject_user_id = u and action = 'verification_revoked' $$;

-- Photo moderation ON, as production runs it: every upload holds at pending
-- and only the worker's door approves. Without this the stub approves on
-- insert and "pending at verification time" cannot be staged.
select pg_temp.admin();
update public.app_config set value = 'true' where key = 'require_photo_moderation';

-- ---------------------------------------------------------------------------
-- The trigger is there, and is the one described
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(t.tgname::text order by t.tgname::text collate "C")
     from pg_trigger t
    where t.tgrelid = 'public.profile_photos'::regclass
      and not t.tgisinternal),
  array['profile_photos_badge_follows_the_face', 'profile_photos_limit',
        'profile_photos_moderation_stub', 'profile_photos_no_guests',
        'profile_photos_poke_moderation', 'profile_photos_refuse_business',
        'profile_photos_throttle']::text[],
  'these are all the triggers on profile_photos, and a new one has to be classified'
);
select alike(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgrelid = 'public.profile_photos'::regclass
      and t.tgname = 'profile_photos_badge_follows_the_face'),
  '%AFTER DELETE OR UPDATE OF "position", moderation_status ON public.profile_photos FOR EACH ROW%',
  'it watches a delete and the two columns that move a face, after the row is written'
);
select is(public.is_strike_action('verification_revoked'), false,
  'losing the badge to a photo change is not a strike');

-- ---------------------------------------------------------------------------
-- alice: the attack itself, and everything a revoke is made of
-- ---------------------------------------------------------------------------

select pg_temp.add('00000000-0000-0000-0000-0000000000a1', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a1', 'b', 1);
select pg_temp.add('00000000-0000-0000-0000-0000000000a1', 'c', 2);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a1', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a1', 'b');
-- c is still pending when the selfie is judged: an older worker's verdict,
-- with no photo_ids of its own, so the database derives them.
select pg_temp.verify('00000000-0000-0000-0000-0000000000a1',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a1'), true,
  'alice is verified against a@0 and b@1');
select is(
  pg_temp.photo_ids('00000000-0000-0000-0000-0000000000a1'),
  jsonb_build_array(pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'a')::text,
                    pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'b')::text),
  'the evidence names the first two approved photos by position, and not the pending third'
);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a1', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a1'), true,
  'a third photo approved after the check does not take the badge: two checked faces still lead');
select is(
  pg_temp.photo_ids('00000000-0000-0000-0000-0000000000a1'),
  jsonb_build_array(pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'a')::text,
                    pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'b')::text),
  'and approving it later does not rewrite what was compared'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.set_visibility('verified_women'), 'verified_women'::public.profile_audience,
  'the badge buys a narrowed audience, which is what makes taking it back matter');
select throws_ok(
  $$ select public.compared_photo_ids('00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'the derivation is not a client RPC'
);
select throws_ok(
  $$ update public.profiles set verified = false
     where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null,
  'and the owner still cannot write the badge column either way'
);

-- Deleting the lead. b, also compared, becomes the lead: same checked face.
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a1'), true,
  'deleting the lead when the next photo was also compared keeps the badge');

-- The attack: put the face nobody checked in front. This is the write
-- photoWritePlan emits for reorderedPhotos([b@1, c@2], c, 0): slot 0 is free
-- after the delete, so c lands in one round trip.
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a1'), false,
  'an unchecked face arriving at the lead slot takes the badge');
select is(pg_temp.visible_to('00000000-0000-0000-0000-0000000000a1'), 'everyone',
  'and the narrowed audience with it, through profiles_reset_visibility');
select is(
  (select status::text || ' / ' || reason from public.verification_requests
    where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'rejected / Your profile photo changed. Take a new selfie and the badge comes back.',
  'the approved request now reads as rejected, with the reason the capture screen shows as a card'
);
select is(pg_temp.revokes('00000000-0000-0000-0000-0000000000a1'), 1,
  'one verification_revoked event is filed');
select is(pg_temp.revoke_source('00000000-0000-0000-0000-0000000000a1'), 'system',
  'by the system, not a moderator');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000000a1'), 1,
  'and one push says what to do about it');
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a1') ->> 'revoked_photo_id',
  pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'c')::text,
  'the evidence keeps the approval and names the photo that ended it'
);
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a1') ->> 'method',
  'claude-vision-plausibility',
  'appended to, not replaced'
);

-- A retried request, or the next write of a longer plan: nothing to revoke
-- twice.
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'c');
select is(pg_temp.revokes('00000000-0000-0000-0000-0000000000a1'), 1,
  'the same write again files nothing twice');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000000a1'), 1,
  'and sends nothing twice');

-- The way back is the ordinary way: a new selfie, judged against the new lead.
select pg_temp.verify('00000000-0000-0000-0000-0000000000a1',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a1'), true,
  'submit_verification opens again after a revoke: the badge comes back with a new selfie');
select is(
  pg_temp.photo_ids('00000000-0000-0000-0000-0000000000a1'),
  jsonb_build_array(pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'c')::text,
                    pg_temp.pid('00000000-0000-0000-0000-0000000000a1', 'b')::text),
  'bound to the photos that lead now, c@0 and b@1'
);
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a1') ->> 'revoked_at',
  null,
  'a fresh approval is fresh evidence, not the old evidence with a badge back on it'
);

-- ---------------------------------------------------------------------------
-- bob: the full-gallery round trip that a derived rule would get wrong
-- ---------------------------------------------------------------------------
--
-- Nine approved photos, a..i at 0..8. The worker compared a and c (it sends
-- what it sent; here it is asked to skip b so that b is the uncompared photo
-- at 1). Swapping a@0 and c@2 on a full gallery is the plan photoWritePlan
-- emits as [a -> 2, c -> 0]: after the first write slot 0 is empty and the
-- lead is b, uncompared. A rule that asked "is the lead compared?" would take
-- the badge off a person moving between two faces that were both checked.

select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a2', chr(96 + n), n - 1)
  from generate_series(1, 9) as n;
select pg_temp.approve('00000000-0000-0000-0000-0000000000a2', chr(96 + n))
  from generate_series(1, 9) as n;
select pg_temp.verify('00000000-0000-0000-0000-0000000000a2', jsonb_build_object(
  'action', 'approve', 'confidence', 0.9, 'reason', 'plausible match',
  'engine', 'claude-verifier',
  'photo_ids', jsonb_build_array(pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'a'),
                                 pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'c'))));
select is(
  pg_temp.photo_ids('00000000-0000-0000-0000-0000000000a2'),
  jsonb_build_array(pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'a')::text,
                    pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'c')::text),
  'the worker''s own list of what it sent wins over what the database would derive'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
-- Write 1 of the plan.
update public.profile_photos set position = 2
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'A, compared, leaves 0 and the lead is uncompared B: still verified, the row did nothing');
-- Things that can land inside that round trip, because the worker and the
-- owner do not take turns: a verdict on some other photo, a delete.
select pg_temp.admin();
update public.profile_photos set moderation_status = 'rejected'
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'f');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'a verdict landing inside the round trip does not: the rejected photo was never compared');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'g');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'a delete landing inside the round trip does not: the deleted photo was never compared');
-- Write 2 of the plan.
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'C, compared, lands at 0: still verified');
select is(pg_temp.revokes('00000000-0000-0000-0000-0000000000a2'), 0,
  'and nothing was filed at any point of the swap');

-- Ordinary gallery upkeep, after the swap.
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a2', 'h');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'deleting an uncompared gallery photo does not');
select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a2', 'j', 5);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a2', 'j');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a2'), true,
  'a new photo approved into the gallery does not: a checked face still leads');

-- ---------------------------------------------------------------------------
-- cara: the small-gallery plan, write for write
-- ---------------------------------------------------------------------------
--
-- Three approved photos, a and b compared. Moving c to the front is the plan
-- photoWritePlan emits as [c -> 3, b -> 2, a -> 1, c -> 0]: it steps the
-- moving photo into the free slot, renumbers what is behind the lead, and
-- only the LAST write puts an unchecked face in front.

select pg_temp.add('00000000-0000-0000-0000-0000000000a3', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a3', 'b', 1);
select pg_temp.add('00000000-0000-0000-0000-0000000000a3', 'c', 2);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a3', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a3', 'b');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a3', 'c');
select pg_temp.verify('00000000-0000-0000-0000-0000000000a3',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
update public.profile_photos set position = 3
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a3', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a3'), true,
  'moving the uncompared photo to a free slot does not');
update public.profile_photos set position = 2
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a3', 'b');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a3'), true,
  'renumbering a compared photo does not');
update public.profile_photos set position = 1
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a3', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a3'), true,
  'the compared lead stepping out of 0 does not');
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a3', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a3'), false,
  'the last write, the unchecked face arriving at 0, does');
select is(pg_temp.revokes('00000000-0000-0000-0000-0000000000a3'), 1,
  'once');

-- ---------------------------------------------------------------------------
-- dave: delete the lead, and what is behind it was never checked
-- ---------------------------------------------------------------------------

select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a4', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a4', 'b', 1);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a4', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a4', 'b');
select pg_temp.verify('00000000-0000-0000-0000-0000000000a4',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select pg_temp.add('00000000-0000-0000-0000-0000000000a4', 'd', 2);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a4', 'd');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a4'), true,
  'an uncompared photo approved behind two checked ones does not');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a4', 'b');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a4'), true,
  'deleting a compared photo that was not the lead does not');
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a4', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a4'), false,
  'deleting the lead when the next approved photo was never checked does');
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a4') ->> 'revoked_by',
  'DELETE',
  'and the evidence says a delete did it'
);

-- ---------------------------------------------------------------------------
-- eve: moderation takes the compared lead away later
-- ---------------------------------------------------------------------------

select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a5', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a5', 'b', 1);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a5', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a5', 'b');
select pg_temp.verify('00000000-0000-0000-0000-0000000000a5',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select pg_temp.add('00000000-0000-0000-0000-0000000000a5', 'd', 2);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a5', 'd');
update public.profile_photos set moderation_status = 'rejected'
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a5', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a5'), true,
  'moderation rejecting the compared lead, compared successor: still verified');
update public.profile_photos set moderation_status = 'approved'
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a5', 'a');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a5'), true,
  'the founder reinstating the compared lead does not: that face was checked');
update public.profile_photos set moderation_status = 'rejected'
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a5', 'a');
update public.profile_photos set moderation_status = 'rejected'
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a5', 'b');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a5'), false,
  'moderation rejecting the last compared photo with an unchecked successor does');
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a5') ->> 'revoked_photo_id',
  pg_temp.pid('00000000-0000-0000-0000-0000000000a5', 'b')::text,
  'naming the rejection that did it'
);

-- ---------------------------------------------------------------------------
-- fay: delete the lead, upload a new face into the hole
-- ---------------------------------------------------------------------------

select pg_temp.add('00000000-0000-0000-0000-0000000000a6', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a6', 'b', 1);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a6', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a6', 'b');
select pg_temp.verify('00000000-0000-0000-0000-0000000000a6',
  '{"action":"approve","confidence":0.9,"reason":"plausible match","engine":"claude-verifier"}'::jsonb);
select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
delete from public.profile_photos
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a6', 'a');
select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a6', 'd', 2);
select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a6', 'd');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a6'), true,
  'a pending photo moved to the lead slot does not, yet: nobody else can see it');
select pg_temp.admin();
select pg_temp.approve('00000000-0000-0000-0000-0000000000a6', 'd');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a6'), false,
  'the moment it clears and leads, the badge is gone');
select is(
  pg_temp.evidence('00000000-0000-0000-0000-0000000000a6') ->> 'revoked_by',
  'UPDATE',
  'by the approval, not the move'
);

-- ---------------------------------------------------------------------------
-- gus and hal: verifying during signup
-- ---------------------------------------------------------------------------

select pg_temp.add('00000000-0000-0000-0000-0000000000a7', 'a', 0);
select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
insert into storage.objects (bucket_id, name) values
  ('verification-selfies', '00000000-0000-0000-0000-0000000000a7/selfie.jpg');
select is(
  (public.submit_verification('00000000-0000-0000-0000-0000000000a7/selfie.jpg')) ->> 'status',
  'pending',
  'a selfie taken seconds after the photo went up is accepted: the worker waits for the photo'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
insert into storage.objects (bucket_id, name) values
  ('verification-selfies', '00000000-0000-0000-0000-0000000000a8/selfie.jpg');
select throws_ok(
  $$ select public.submit_verification('00000000-0000-0000-0000-0000000000a8/selfie.jpg') $$,
  'add a profile photo before verifying',
  'with no photo at all there is nothing to wait for, and the attempt is not spent'
);

-- ---------------------------------------------------------------------------
-- ivy: a badge with nothing recorded is left alone, not revoked
-- ---------------------------------------------------------------------------
--
-- The backfill runs once, at migration time, over rows this cluster never
-- had; what can be asserted is the contract it establishes. A verified row
-- with no photo_ids (or a JSON null there) is "not recorded", and the answer
-- to not recorded is to record, never to punish.

select pg_temp.admin();
select pg_temp.add('00000000-0000-0000-0000-0000000000a9', 'a', 0);
select pg_temp.add('00000000-0000-0000-0000-0000000000a9', 'b', 1);
select pg_temp.add('00000000-0000-0000-0000-0000000000a9', 'c', 2);
select pg_temp.approve('00000000-0000-0000-0000-0000000000a9', 'a');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a9', 'b');
select pg_temp.approve('00000000-0000-0000-0000-0000000000a9', 'c');
update public.profiles set verified = true, verification = '{}'::jsonb
 where user_id = '00000000-0000-0000-0000-0000000000a9';
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a9', 'c');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a9'), true,
  'a badge whose evidence never recorded the photos is left alone by the trigger');
select pg_temp.admin();
update public.profiles set verification = '{"photo_ids": null}'::jsonb
 where user_id = '00000000-0000-0000-0000-0000000000a9';
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
update public.profile_photos set position = 0
 where id = pg_temp.pid('00000000-0000-0000-0000-0000000000a9', 'b');
select is(pg_temp.verified('00000000-0000-0000-0000-0000000000a9'), true,
  'and a JSON null there is "not recorded" too, not an empty list');
select is(pg_temp.revokes('00000000-0000-0000-0000-0000000000a9'), 0,
  'nothing filed against her');

select * from finish();
rollback;
