-- A business photo that nobody but its owner can see.
--
-- `business_photos.moderation_status` defaults to 'pending' and NOTHING has
-- ever moved it off that value. `profile_photos` gets `moderate_photo_stub`
-- on insert; business photos got the same column, the same enum and the same
-- `= 'approved'` filter on every read, and no trigger. So:
--
--   * no business photo has ever been visible to a traveler, on the map, in
--     the place sheet, or in the chat list;
--   * and business signup step 7 cannot be passed at all, because its
--     `photoCount` comes from `business_detail`, which filters on 'approved',
--     so the count is pinned at 0 no matter how many photos are uploaded and
--     Continue just reopens the editor.
--
-- The second one is a dead end in the middle of the flow the founder was
-- asked to test, and it is invisible in the schema: every piece looks right
-- on its own.
--
-- Two halves here, because the flag has both settings and both must work:
--   OFF -> approve on insert, exactly as profile photos do, so keyless dev
--          and a flag-off project keep working.
--   ON  -> hold at 'pending' and queue an event, and the moderation-worker's
--          new business-photo branch classifies it and calls the verdict
--          function below. Production runs with the flag ON
--          (LAUNCH_RUNBOOK step 1), so without that branch this fix would
--          swap one invisible state for another.

alter table public.business_photos
  add column if not exists moderation_attempts int not null default 0;

create or replace function public.moderate_business_photo_stub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- The subject is the person who runs the place. Nullable on the column, so
  -- read it rather than assuming: an unclaimed launch venue has no owner, and
  -- a moderation event about nobody is still worth recording.
  select owner_user_id into v_owner
  from public.businesses
  where id = new.business_id;

  if public.config_flag('require_photo_moderation') then
    new.moderation_status := 'pending';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_photo', new.id, 'queued_for_llm', 'photo-pipeline',
       jsonb_build_object('storage_path', new.storage_path,
                          'position', new.position,
                          'business_id', new.business_id));
  else
    new.moderation_status := 'approved';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_photo', new.id, 'auto_approved', 'stub',
       jsonb_build_object('storage_path', new.storage_path,
                          'position', new.position,
                          'business_id', new.business_id));
  end if;
  return new;
end
$$;

drop trigger if exists business_photos_moderate on public.business_photos;
create trigger business_photos_moderate
  before insert on public.business_photos
  for each row execute function public.moderate_business_photo_stub();

-- The worker's door, mirroring apply_photo_verdict.
--
-- One deliberate difference: no push. A rejected profile photo is a strike
-- against a person and they are told. A business photo is a picture of a
-- room, the owner is not a traveler and has no strike ledger, and a push
-- reading "Photo removed" on an account with no profile is a message from
-- nowhere. The event is recorded either way, which is what the founder reads.
create or replace function public.apply_business_photo_verdict(
  p_photo_id uuid,
  p_verdict jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo public.business_photos%rowtype;
  v_owner uuid;
begin
  perform public.assert_service_caller();
  select * into v_photo
  from public.business_photos
  where id = p_photo_id and moderation_status = 'pending'
  for update;
  if not found then
    raise exception 'that business photo is not awaiting moderation';
  end if;

  select owner_user_id into v_owner
  from public.businesses
  where id = v_photo.business_id;

  if p_verdict ->> 'action' = 'allow' then
    update public.business_photos
      set moderation_status = 'approved' where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_photo', p_photo_id, 'photo_approved',
       'claude-moderator', p_verdict);
  else
    update public.business_photos
      set moderation_status = 'rejected' where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_photo', p_photo_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'photo_rejected_failsafe'
            else 'photo_rejected' end,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
  end if;
end
$$;

revoke execute on function public.apply_business_photo_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- Count an attempt, so a photo the model keeps refusing cannot spin forever.
-- Same shape as the profile pipeline's cap.
create or replace function public.note_business_photo_attempt(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_service_caller();
  update public.business_photos
     set moderation_attempts = moderation_attempts + 1
   where id = p_photo_id;
end
$$;

revoke execute on function public.note_business_photo_attempt(uuid)
  from public, anon, authenticated;
