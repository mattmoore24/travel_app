-- A badge follows the face
-- ===========================================================================
--
-- A verified traveler could replace their profile photo with a different
-- person's face and keep the badge. Every piece of that sentence was true on
-- the evidence of the tree:
--
--   * The only write of profiles.verified = true is the approve branch of
--     apply_verification_verdict (20260817090000:811-863). Nothing anywhere
--     set it false again.
--   * Every trigger on profile_photos was BEFORE or AFTER INSERT. None on
--     UPDATE, none on DELETE - and a reorder is an UPDATE of position, a
--     removal is a DELETE.
--   * The worker compared the selfie against the first TWO approved photos by
--     position, read at tick time, and recorded nothing about which two. The
--     evidence jsonb was {method, request_id, verdict, at}: a badge with no
--     memory of the face it was issued for.
--   * profiles_reset_visibility (20260823030000:366-382) was written "for a
--     photo set replaced" and had never once fired for that reason, because
--     nothing replaced a badge when a photo set was.
--
-- So the badge said "this face was checked" while the face it sat next to was
-- whichever one the person put in slot 0 afterwards. In an app whose women-
-- only audience is gated on that badge (set_visibility, 20260823040000:118),
-- that is the audience setting enforced only at write time - the exact
-- failure profiles_reset_visibility was built to close.
--
-- FOUR PIECES.
--
--   1. apply_verification_verdict RECORDS which photos were compared. The
--      evidence jsonb gains 'photo_ids': the array the worker says it sent,
--      falling back to the same first-two-approved-by-position derivation the
--      worker uses (compared_photo_ids, below) for a verdict from an older
--      worker that does not send one.
--
--   2. A BACKFILL for everybody verified before this migration, deriving the
--      ids the same way now. This is the best approximation available: the
--      photos may have changed since the check, and if they have, the person
--      keeps a badge that was matched to a face they no longer show. Exempting
--      them forever would be worse - it would leave every pre-migration badge
--      permanently transferable, which is the defect itself with a date on it.
--      photo_ids_backfilled_at is written beside the array so a review can
--      tell an observed list from an inferred one.
--
--   3. submit_verification ACCEPTS A PENDING PHOTO. Its guard required an
--      approved one, and a fresh upload is pending, so verifying during
--      signup - selfie taken seconds after the photo went up, which is what
--      the signup flow does - was refused with "add a profile photo before
--      verifying" (20260821130000:10-14 calls this the commonest way to hit
--      the orphaned-selfie bug it fixed). The worker now WAITS for a pending
--      photo instead of rejecting, so the guard only has to keep out the
--      request that can never be judged: the one with no photo at all.
--
--   4. THE TRIGGER, profile_photos_badge_follows_the_face, on UPDATE OF
--      position, moderation_status and on DELETE. It takes the badge away
--      when the face it was issued for stops being the face the profile
--      leads with. Naming `verified` in its update is what fires
--      profiles_reset_visibility, which drops visible_to back to everyone -
--      so the audience rule and the badge fall together, as designed.
--
-- THE RULE IS ROW-BASED, DELIBERATELY. Read the trigger's own comment for the
-- full argument; the short form is that "is the lead photo one of the
-- compared ones?" is the wrong question to ask after any single write,
-- because a reorder is several writes and the state between two of them is
-- not a state anybody chose. The rule instead asks what THIS row just did.
--
-- WHAT A REVOKE IS. verified goes false and the evidence keeps its history
-- (revoked_at, revoked_by, revoked_photo_id appended, nothing removed); the
-- approved verification_requests row becomes rejected with a reason the
-- client already knows how to show; one moderation_events row, action
-- verification_revoked, source system, NOT a strike; one push. Not a fourth
-- verification_status value: 'rejected' plus a reason is exactly what the
-- capture screen renders as a card (verification-capture.tsx: rejected &&
-- reason), and "take a new selfie" is the same next step as any other
-- rejection. A new enum value would have been a client change on every
-- installed build for a state that behaves identically to one it has.
--
-- ENTRY POINTS, because a capability with nothing on the other end has
-- shipped here more than once: the worker (moderation-worker/index.ts,
-- verifications block) sends photo_ids and waits on pending photos; the
-- client (features/profile/hooks.ts) refetches the profile and the latest
-- verification after a delete or a reorder, since either can now take the
-- badge off server-side; the main tile's delete confirm (photo-grid.tsx)
-- says so before the tap. pgTAP: 75_a_badge_follows_the_face.

-- ---------------------------------------------------------------------------
-- 1. The derivation, in one place
-- ---------------------------------------------------------------------------
--
-- The two photos the worker compares are "the first two approved by
-- position" (moderation-worker/index.ts, the profilePhotos select). The
-- verdict's fallback and the backfill below both need that exact set, and
-- two copies of a query that must agree is one more than this repo keeps.
-- Empty array rather than null when there is nothing approved: null in the
-- evidence means "not recorded" and switches the trigger OFF for that
-- profile, and a verified profile with no approved photo is the one case
-- where the next approved face is certainly not the one that was checked.

create function public.compared_photo_ids(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_agg(x.id order by x.position)
       from (select id, position
               from public.profile_photos
              where user_id = p_user and moderation_status = 'approved'
              order by position
              limit 2) x),
    '[]'::jsonb)
$$;

revoke execute on function public.compared_photo_ids(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The verdict remembers which photos it compared
-- ---------------------------------------------------------------------------
--
-- Restated whole from 20260817090000:811-863 with two additions and nothing
-- else moved: 'photo_ids' in the evidence, and the same per-user advisory
-- lock submit_verification takes. The lock is for the trigger below, which
-- takes it before reading the profile: without it a verdict landing in the
-- same instant as a reorder could set the badge from a snapshot that no
-- longer describes the gallery, and the trigger, having read the profile
-- before the verdict committed, would see an unverified account and do
-- nothing. The function has no RETURNS TABLE, so create or replace is
-- enough; the revoke is restated so the file reads on its own.

create or replace function public.apply_verification_verdict(p_request_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.verification_requests%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_req
  from public.verification_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'verification is not pending';
  end if;
  perform pg_advisory_xact_lock(hashtext('verification:' || v_req.user_id::text));

  if p_verdict ->> 'action' = 'approve' then
    update public.verification_requests
      set status = 'approved', verdict = p_verdict, reviewed_at = now()
      where id = p_request_id;
    update public.profiles
      set verified = true,
          verification = jsonb_build_object(
            'method', 'claude-vision-plausibility',
            'request_id', p_request_id,
            'verdict', p_verdict,
            'at', now(),
            -- What the worker says it SENT wins over what this database
            -- would derive now: the two can differ by the time it takes a
            -- model to answer, and the badge is about the photos in the
            -- prompt. The derivation covers a verdict from an older worker;
            -- a jsonb null in the verdict is "not sent", not a list.
            'photo_ids', coalesce(
              case when jsonb_typeof(p_verdict -> 'photo_ids') = 'array'
                   then p_verdict -> 'photo_ids' end,
              public.compared_photo_ids(v_req.user_id)))
      where user_id = v_req.user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.user_id, 'verification', p_request_id, 'verification_approved',
       'claude-verifier', p_verdict);
    insert into public.push_queue (user_id, title, body, data)
    values (v_req.user_id, 'You''re verified', 'Your profile now shows the verified badge.',
            jsonb_build_object('type', 'verification'));
  else
    update public.verification_requests
      set status = 'rejected',
          reason = coalesce(p_verdict ->> 'reason', 'The selfie could not be matched to your profile photos.'),
          verdict = p_verdict,
          reviewed_at = now()
      where id = p_request_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_req.user_id, 'verification', p_request_id, 'verification_rejected',
       'claude-verifier', p_verdict); -- not a strike
  end if;
end
$$;

revoke execute on function public.apply_verification_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Everybody verified before today
-- ---------------------------------------------------------------------------
--
-- The best available approximation, and knowingly so: these ids are the first
-- two approved photos NOW, not the two the worker saw when it checked. Anyone
-- who has since swapped their face in keeps the badge until the next change,
-- because nothing recorded the swap. The alternative - leaving photo_ids null
-- so the trigger never watches them - would make every badge issued before
-- this date transferable for as long as the account lives, which is the
-- defect with an exemption stapled to it. A profile with no approved photo
-- gets [] and so loses the badge on the next approved face, which is right:
-- whatever was checked, it is not on the profile any more.
-- `verification` is nullable (20260816190000:46); a verified row with a null
-- there has never happened but is not this statement's to break on.

update public.profiles p
   set verification = coalesce(p.verification, '{}'::jsonb)
                      || jsonb_build_object(
                           'photo_ids', public.compared_photo_ids(p.user_id),
                           'photo_ids_backfilled_at', now())
 where p.verified
   and p.verification -> 'photo_ids' is null;

-- ---------------------------------------------------------------------------
-- 4. A selfie can be taken before the photo has been checked
-- ---------------------------------------------------------------------------
--
-- Restated whole from 20260817090000:754-809; the photo guard is the only
-- line that changes. Grants restated after it - the original revoked from
-- public and anon and relied on the platform's default privileges for
-- authenticated, which create or replace preserves, but a grant that is
-- written down is one nobody has to go and check.

create or replace function public.submit_verification(p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if split_part(p_storage_path, '/', 1) <> v_user::text then
    raise exception 'selfie must live in your own storage folder';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'verification-selfies' and name = p_storage_path
  ) then
    raise exception 'selfie upload not found';
  end if;
  if exists (select 1 from public.profiles where user_id = v_user and verified) then
    raise exception 'already verified';
  end if;
  -- The worker compares the selfie against approved profile photos, and it
  -- now WAITS for a pending one rather than rejecting: photos are drained
  -- earlier in the same tick, so a selfie taken seconds after the photo went
  -- up - which is what signup does - is judged the tick after the photo
  -- clears instead of being refused here. Only a request with no photo at
  -- all can never be judged, and that one would silently burn a daily
  -- attempt, so it is still refused up front.
  if not exists (
    select 1 from public.profile_photos
    where user_id = v_user and moderation_status in ('approved', 'pending')
  ) then
    raise exception 'add a profile photo before verifying';
  end if;

  perform pg_advisory_xact_lock(hashtext('verification:' || v_user::text));
  if exists (
    select 1 from public.verification_requests
    where user_id = v_user and status = 'pending'
  ) then
    raise exception 'verification already in review';
  end if;
  if (select count(*) from public.verification_requests
      where user_id = v_user and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too many verification attempts today';
  end if;

  insert into public.verification_requests (user_id, storage_path)
  values (v_user, p_storage_path)
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end
$$;

revoke execute on function public.submit_verification(text) from public, anon;
grant execute on function public.submit_verification(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The trigger
-- ---------------------------------------------------------------------------
--
-- Two words, defined once. A photo is COMPARED when its id is in the
-- evidence's photo_ids - it was in the prompt the badge was issued from. The
-- LEAD is the approved photo with the lowest position: what every reader
-- shows first (`order by position` and then the first row, photo-order.ts).
--
-- The badge comes off when, for a verified owner whose evidence has a
-- photo_ids array:
--
--   UPDATE OF position    an uncompared approved photo ARRIVES at slot 0.
--   UPDATE OF status      an uncompared photo becomes approved with no
--                         approved photo below it - it became the lead by
--                         being approved. Delete-the-lead-then-upload lands
--                         here: the upload is pending at 0 until the worker
--                         clears it, and clearing it is the moment the
--                         profile leads with a face that was never checked.
--   UPDATE OF status      a compared photo stops being approved, and the
--                         lead after that is nobody or somebody uncompared.
--   DELETE                a compared photo is deleted, and the lead after
--                         that is nobody or somebody uncompared.
--
-- And NEVER because a compared photo LEAVES slot 0. This is the whole reason
-- the rule is about rows and not about the derived state, and it is worth
-- the space. A reorder is several PostgREST round trips (photoWritePlan,
-- src/features/profile/photo-order.ts:59-115), and on a FULL gallery the
-- plan has no free slot to step into, so it moves the photo in the LOWEST
-- occupied slot first: for one round trip slot 0 is empty and the profile
-- falls back to whatever sits at 1. Take compared A at 0, uncompared B at 1,
-- compared C at 2, and a person swapping A and C: the plan writes A -> 2
-- (slot 0 empty, the lead is now B) and then C -> 0. A rule that asked "is
-- the lead compared?" after the first write would answer no and take the
-- badge off a person who is moving between two faces that were both
-- checked. The row rule is immune: the only row that ARRIVES at 0 in that
-- sequence is C, and C is compared. The same goes for the small-gallery
-- plan, which steps the moving photo into a free slot and then renumbers
-- everything past the lead before the final write lands at 0.
--
-- WHAT IS NOT A LOCK PROBLEM, AND WHAT IS. Two writes for the same owner can
-- both find verified = true and both decide to revoke; the profile row lock
-- serialises them and the loser's update re-evaluates `and verified` against
-- the committed row (READ COMMITTED re-checks the WHERE after waiting), finds
-- it false, matches nothing, and `found` sends it home before it files a
-- second event or a second push. The same guard is what makes the second and
-- later writes of one reorder no-ops. The advisory lock, taken BEFORE the
-- read, is for the other interleaving: a verdict and a photo write for the
-- same person in the same instant. apply_verification_verdict holds the same
-- key, so this read waits for the verdict to commit and then sees the badge
-- it just issued and the photo_ids it issued it for. Lock order is the same
-- everywhere it is taken (advisory, then the profiles row), so there is no
-- cycle to deadlock on.
--
-- AFTER, not BEFORE, so "the lead after this row" is one plain query: the
-- deleted row is gone and the updated row already carries its new status.
-- SECURITY DEFINER because the owner's own role cannot write verified or
-- verification (20260816190000:349, never re-granted) and must not start to;
-- the function is the only writer and no client can execute it.

create function public.revoke_badge_when_the_face_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_photo_ids jsonb;
  v_lead uuid;
  v_request uuid;
  v_revoke boolean := false;
begin
  -- An account being deleted cascades through here; there is nobody left to
  -- file a push or an event against, and the insert would fail on the user
  -- row that is going.
  if not exists (select 1 from public.users where id = v_user) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('verification:' || v_user::text));

  select p.verification -> 'photo_ids' into v_photo_ids
    from public.profiles p
   where p.user_id = v_user and p.verified;
  -- Not verified, or verified with nothing recorded (a JSON null is "not
  -- recorded" too): nothing to compare the change against, so nothing to do.
  -- Verified-without-photo_ids cannot happen after the backfill above, and if
  -- it ever does the answer is to record, not to revoke.
  if v_photo_ids is null or jsonb_typeof(v_photo_ids) <> 'array' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    if v_photo_ids ? old.id::text then
      select id into v_lead
        from public.profile_photos
       where user_id = v_user and moderation_status = 'approved'
       order by position, created_at, id
       limit 1;
      v_revoke := v_lead is null or not (v_photo_ids ? v_lead::text);
    end if;
  else
    -- An uncompared approved photo written to the lead slot. Asked of the
    -- row, not of the gallery: see the header for why leaving 0 is not
    -- asked about at all.
    if new.position = 0
       and new.moderation_status = 'approved'
       and not (v_photo_ids ? new.id::text) then
      v_revoke := true;
    end if;

    if new.moderation_status = 'approved'
       and old.moderation_status <> 'approved'
       and not (v_photo_ids ? new.id::text)
       and not exists (
         select 1 from public.profile_photos
          where user_id = v_user
            and moderation_status = 'approved'
            and position < new.position) then
      v_revoke := true;
    end if;

    if old.moderation_status = 'approved'
       and new.moderation_status <> 'approved'
       and v_photo_ids ? old.id::text then
      select id into v_lead
        from public.profile_photos
       where user_id = v_user and moderation_status = 'approved'
       order by position, created_at, id
       limit 1;
      if v_lead is null or not (v_photo_ids ? v_lead::text) then
        v_revoke := true;
      end if;
    end if;
  end if;

  if not v_revoke then
    return null;
  end if;

  -- Naming `verified` is what fires profiles_reset_visibility, which drops
  -- visible_to to everyone in the same statement. The evidence is appended
  -- to, never replaced: the approval that was, and the write that ended it,
  -- are both what a review needs.
  update public.profiles
     set verified = false,
         verification = verification || jsonb_build_object(
           'revoked_at', now(),
           'revoked_by', tg_op,
           'revoked_photo_id', coalesce(new.id, old.id)::text)
   where user_id = v_user and verified;
  if not found then
    return null;
  end if;

  select id into v_request
    from public.verification_requests
   where user_id = v_user and status = 'approved'
   order by reviewed_at desc nulls last, created_at desc
   limit 1;
  update public.verification_requests
     set status = 'rejected',
         reason = 'Your profile photo changed. Take a new selfie and the badge comes back.',
         reviewed_at = now()
   where user_id = v_user and status = 'approved';

  -- Not a strike: is_strike_action (20260817090000:140) is a closed list and
  -- this action is not on it. Changing your own photo is not misconduct.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (v_user, 'verification', v_request, 'verification_revoked', 'system',
     jsonb_build_object(
       'op', tg_op,
       'photo_id', coalesce(new.id, old.id),
       'photo_ids', v_photo_ids));
  insert into public.push_queue (user_id, title, body, data)
  values (v_user, 'Your badge needs a new selfie',
          'Your profile photo changed. Take a new selfie and it comes back.',
          jsonb_build_object('type', 'verification'));
  return null;
end
$$;

revoke execute on function public.revoke_badge_when_the_face_changes()
  from public, anon, authenticated;

create trigger profile_photos_badge_follows_the_face
  after delete or update of position, moderation_status on public.profile_photos
  for each row execute function public.revoke_badge_when_the_face_changes();

comment on trigger profile_photos_badge_follows_the_face on public.profile_photos is
  'Takes the verified badge away when the face it was issued for stops '
  'leading the profile. Row-based: an uncompared approved photo arriving at '
  'slot 0 or becoming the lead by approval, or a compared photo leaving '
  'approval or being deleted with no compared lead behind it. Never fires '
  'because a compared photo LEAVES slot 0 (photoWritePlan empties it for one '
  'round trip on a full gallery). See 20260904100000.';
