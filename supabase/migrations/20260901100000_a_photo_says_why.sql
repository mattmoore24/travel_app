-- A refused photo says why, and a timeout stops being called a rules breach.
--
-- Two things were wrong at once. A rejected photo showed the single word
-- "Removed" on danger red with no reason, so the only moves available were to
-- upload the same photo again (and take a second strike, because
-- photo_rejected feeds apply_strike_policy) or to give up on having a photo,
-- which in this product means giving up on being findable. And the failsafe
-- case - the classifier timing out, explicitly NOT a strike
-- (photo_rejected_failsafe) - was drawn in exactly the same word and colour,
-- so somebody who did nothing wrong was told they broke the rules.
--
-- The verdict already knows both facts. It just never kept them: the push
-- split the two cases and the row did not, so the screen had nothing to read.
-- This stores the CATEGORY and the ENGINE, and nothing else. The model's
-- free-text `reason` stays out of the database on purpose - it is model prose,
-- it can be blunt or plain wrong, and it is one screenshot away from being
-- this app's voice. src/constants/moderation.ts maps the five known
-- categories to sentences the app owns, with a generic fallback for anything
-- it has not seen.
--
-- The push bodies gain the automation disclosure DSA Art. 17(3)(c) asks for:
-- a person told a decision was made about them is owed the fact that a
-- machine made it. The house rules and the privacy policy already say so in
-- general; this says it per decision, which is what the article is about.
-- (Still owed after this migration: the "Message not delivered" push, which
-- lives in apply_message_verdict and belongs to a messaging package.)

-- ---------------------------------------------------------------------------
-- The two columns
-- ---------------------------------------------------------------------------

-- profile_photos carries no COLUMN-level select grant (only `update
-- (position)` is column-scoped), so `select *` keeps working here without a
-- new grant. Who can read the columns is settled by RLS instead: the owner
-- sees their own rows, and everybody else is gated on moderation_status =
-- 'approved', so a rejected photo's reason is invisible to strangers because
-- the whole ROW is.
alter table public.profile_photos
  add column moderation_category text,
  add column moderation_engine text;

comment on column public.profile_photos.moderation_category is
  'The verdict category (explicit / suggestive / violent / other_violation, '
  'or a worker token like moderation_unavailable). Never the model''s '
  'free-text reason: the app maps this to copy of its own.';
comment on column public.profile_photos.moderation_engine is
  'Which engine decided: claude-moderator, or failsafe when classification '
  'gave up. A failsafe rejection is not a strike and must never be shown as '
  'a rules breach.';

-- business_photos IS column-granted for select (20260827110000 lists six
-- columns, and 20260829180000 forgot the seventh, which is what answered
-- "0 of 10" to the owner's own photo grid for three e2e runs). Grant both new
-- columns in the same migration or `select *` breaks again.
alter table public.business_photos
  add column moderation_category text,
  add column moderation_engine text;

grant select (moderation_category, moderation_engine)
  on public.business_photos to anon, authenticated;

comment on column public.business_photos.moderation_category is
  'Same contract as profile_photos.moderation_category.';
comment on column public.business_photos.moderation_engine is
  'Same contract as profile_photos.moderation_engine.';

-- ---------------------------------------------------------------------------
-- The verdicts, which now keep what they already knew
-- ---------------------------------------------------------------------------

-- Body copied from 20260817090000_trust_safety.sql:646, with the rejection
-- update carrying the two new columns and the push saying who decided. The
-- signature is unchanged and there is no RETURNS TABLE, so create-or-replace
-- is correct here; the revoke is restated anyway, which is what this repo
-- does after every replace.
create or replace function public.apply_photo_verdict(p_photo_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo public.profile_photos%rowtype;
begin
  perform public.assert_service_caller();
  select * into v_photo
  from public.profile_photos
  where id = p_photo_id and moderation_status = 'pending'
  for update;
  if not found then
    raise exception 'photo is not awaiting moderation';
  end if;

  if p_verdict ->> 'action' = 'allow' then
    update public.profile_photos
      set moderation_status = 'approved' where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_photo.user_id, 'profile_photo', p_photo_id, 'photo_approved',
       'claude-moderator', p_verdict);
  else
    update public.profile_photos
      set moderation_status = 'rejected',
          moderation_category = p_verdict ->> 'category',
          moderation_engine = p_verdict ->> 'engine'
      where id = p_photo_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_photo.user_id, 'profile_photo', p_photo_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'photo_rejected_failsafe'  -- not a strike
            else 'photo_rejected' end,      -- a strike (apply_strike_policy)
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
    insert into public.push_queue (user_id, title, body, data)
    values (v_photo.user_id,
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'Photo could not be checked'
              else 'Photo removed'
            end,
            case when p_verdict ->> 'engine' = 'failsafe'
              then 'Our automatic check could not read one of your photos, so nobody else can see it. Nothing about it broke a rule. Upload it again and the check runs once more.'
              else 'One of your photos breaks our house rules, so nobody else can see it. An automatic check made that call. Open your photos to see why, and tap Contact us if it got it wrong.'
            end,
            jsonb_build_object('type', 'moderation'));
  end if;
end
$$;

revoke execute on function public.apply_photo_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- The same pass for a business's photos. Body copied from
-- 20260829180000_a_business_photo_is_ever_seen.sql; there is no push on this
-- path (the owner learns from the grid), so only the columns change.
create or replace function public.apply_business_photo_verdict(p_photo_id uuid, p_verdict jsonb)
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
      set moderation_status = 'rejected',
          moderation_category = p_verdict ->> 'category',
          moderation_engine = p_verdict ->> 'engine'
      where id = p_photo_id;
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
