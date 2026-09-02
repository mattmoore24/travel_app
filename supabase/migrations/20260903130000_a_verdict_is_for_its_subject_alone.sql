-- A VERDICT IS FOR ITS SUBJECT ALONE — AT THE TABLE, NOT ONLY ON THE PHONE
--
-- 20260903050000:67-83 wrote down who may see a group's photo, and one line of
-- it was enforced by nothing but the client:
--
--   "pending — the person who uploaded it, and nobody else... To everybody
--    else there is NO photo, not a photo being checked: ... a member who could
--    watch 'being checked' turn into nothing would know the admin's picture
--    was refused, and a verdict is for its subject alone."
--
-- The PATH half of that was true — my_chats, group_invite_preview and
-- chat_photos_select_group all mask it. The STATUS half was false at the
-- table. `grant select on public.groups to authenticated` (20260821010000:42)
-- is TABLE-level, and groups_select_member admits every member of the room, so
-- any member could read the fact itself:
--
--   select photo_status, photo_path from public.groups where name = 'Porto crew';
--   -- pending, <the admin's path>   ... and then, seconds later:
--   -- rejected, null
--
-- Those two reads ARE the inference the paragraph forbids, and they need no
-- app at all: an anon key and the row's name. src/features/groups/photo.ts
-- (`groupPhotoView`) was the only thing hiding it, and
-- 67_a_group_photo_is_checked never asked the question — every `pg_temp.status()`
-- call in it is a positive assertion on the VALUE, never a refusal, so deleting
-- the client guard failed nothing in the suite. Client code is UX; Postgres is
-- the boundary. This migration moves the line to the boundary.
--
-- THE PIECES, and the entry point of each:
--
--   groups.photo_set_by        NEW. Who uploaded the photo the row is wearing
--                              a verdict about. Written by the trigger on
--                              every change of photo_path, and KEPT when a
--                              verdict removes the path, because that is the
--                              one moment the subject can no longer be read
--                              off the path. Never granted to a client.
--   the column grant           `select` on public.groups is now column-level:
--                              everything a member legitimately reads, and
--                              not photo_path, photo_status or
--                              moderation_attempts. A direct read of any of
--                              the three is 42501 for everybody, the setter
--                              included — they read their own through the
--                              function below, the way my_chats already hands
--                              them their own path.
--   group_detail(chat_id)      NEW. The one client read of a group row.
--                              SECURITY DEFINER, membership-gated exactly as
--                              groups_select_member is, masking the three
--                              columns with the same rule my_chats uses:
--                              approved is everybody's, pending and rejected
--                              are the setter's. src/features/groups/api.ts
--                              (`fetchGroup`) is its only caller; useGroup
--                              still shapes what a screen is handed.
--   can_view_group_photo       NEW, and it is not decoration. An RLS policy's
--                              expression is evaluated with the PRIVILEGES OF
--                              THE READER, so chat_photos_select_group —
--                              which names g.photo_path and g.photo_status
--                              directly — would not have answered FALSE once
--                              the grant went column-level. It would have
--                              RAISED, and a policy that raises takes the
--                              whole select with it: measured, with the
--                              policy left inline, every authenticated read
--                              of storage.objects dies with "permission
--                              denied for table groups" — chat photos,
--                              a person's own uploads, all of it. Three test
--                              files die at their first storage read
--                              (03_chats_storage_rls, 67, 74). Same shape as
--                              can_view_business_photo (20260827110000:103)
--                              and can_view_photo_object (20260816190100:15),
--                              which exist for exactly this reason: the
--                              tables they read are column-granted too.
--
-- WHAT IS NOW TRUE, and what is not:
--
--   approved   path and status to every member, exactly as before.
--   pending    path and status to the setter alone. To everybody else the row
--              says null and null — not "pending with the path withheld",
--              which is the same tell one step removed.
--   rejected   the status to the setter alone; the path is already gone. The
--              setter is photo_set_by, not the path's prefix, precisely
--              because the verdict removes the path it would have been read
--              from.
--   moderation_attempts  the setter's own count, and 0 to everybody else: a
--              counter climbing is a photo being retried, which is the same
--              fact again.
--
--   NOT enforced, and said here rather than claimed away: a group photo
--   REJECTED BEFORE this migration ran has no photo_set_by to backfill from —
--   the path it would have been read off was removed by the verdict that
--   rejected it. Those rows carry `rejected` with a null setter, and a null
--   setter matches nobody, so the notice ("That photo was not approved and has
--   been removed. Pick another.") is shown to nobody for them. Fail closed:
--   the admin picks another photo and the next verdict has a subject. There
--   are no production users; the founder's own test groups are the whole
--   population.
--
--   Also not enforced, and not enforceable here: a verdict's subject who is
--   still IN the group is the only person the mask distinguishes. Somebody
--   who has left reads nothing at all, because groups_select_member and
--   group_detail both stop at membership first.
--
-- DEPLOY WINDOW, established rather than assumed. An expo-updates bundle is
-- never applied on the launch that downloads it, so for at least one launch
-- every phone runs the PREVIOUS client against this schema, and that client
-- reads the group row with `.from('groups').select('*')` (api.ts:97).
-- Postgres refuses a star select unless EVERY column is granted, so that read
-- is `permission denied for table groups` — the trap 31_select_star_stays_readable
-- exists for, taken deliberately this time rather than walked into:
--   * the group SETTINGS page (src/app/group/[id].tsx:316-340) has a
--     LoadError branch and shows it, with a Retry that keeps failing until
--     the new bundle is running. It is one screen, one launch, and it says
--     something rather than lying.
--   * the room HEADER (src/app/room/[id].tsx:125) destructures only `data`,
--     so an errored query is `undefined`: the header draws the group glyph
--     and the plan banner (`group?.pin_id`) does not render. Nothing throws.
--   * everything else in a room, the chat list, and the invite screen read
--     RPCs and are untouched.
-- The alternative was leaving a documented privacy promise enforced by a
-- client guard for another release. `31_select_star_stays_readable` drops
-- `groups` from its list in the same commit, which is what documents that the
-- app no longer star-reads this table.

-- ---------------------------------------------------------------------------
-- Who set the photo
-- ---------------------------------------------------------------------------

-- No foreign key on purpose. A seeded or service-role path need not begin
-- with a uuid that exists in public.users, and the trigger's safe cast
-- already answers null for one that is not a uuid at all; an FK would turn
-- that into a failed insert on a path this column only describes.
alter table public.groups
  add column if not exists photo_set_by uuid;

comment on column public.groups.photo_set_by is
  'Who uploaded the photo this row wears a verdict about. Server-owned: the '
  'trigger writes it on every change of photo_path and KEEPS it when a '
  'verdict removes the path, which is the one moment the subject can no '
  'longer be read off the path''s first segment. Never granted to a client; '
  'group_detail compares it against auth.uid() and hands the verdict to that '
  'person alone.';

-- Every row that still wears a photo can be backfilled from the path, which
-- is where the setter has always been. A row already REJECTED cannot: its
-- path is gone. Those stay null and are shown to nobody (see the header).
update public.groups
   set photo_set_by = case
         when split_part(photo_path, '/', 1) ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then split_part(photo_path, '/', 1)::uuid
       end
 where photo_path is not null
   and photo_set_by is null;

-- ---------------------------------------------------------------------------
-- The trigger, restated from 20260903050000:151 with ONE change: it writes
-- photo_set_by alongside the status it already writes. Same signature, so
-- create-or-replace is right and there is nothing to drop; the revoke is
-- restated rather than trusted.
-- ---------------------------------------------------------------------------

create or replace function public.moderate_group_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v_setter uuid;
begin
  -- NOTHING PERSISTENT HAPPENS BELOW THIS LINE UNLESS THE PHOTO MOVED. The
  -- trigger is already scoped `update of photo_path`, but update_group names
  -- that column on every call (it coalesces the old value back in), so the
  -- scope alone would still run this body for a rename.
  if tg_op = 'UPDATE' then
    if new.photo_path is not distinct from old.photo_path then
      return new;
    end if;
  end if;

  if new.photo_path is null then
    -- The photo is gone. Either the admin cleared it (update_group clears the
    -- status with it) or a verdict removed it, and a verdict says 'rejected'
    -- so the group page can tell the admin to pick another. Nobody but the
    -- verdict function can arrive here with 'rejected' in hand: the table has
    -- no client write grant and update_group never writes that value.
    --
    -- photo_set_by goes with the status and stays with it: a cleared photo
    -- has no verdict and so has no subject, while a REFUSED one has both, and
    -- this is the only place the subject could otherwise be lost - the path
    -- the prefix was read from is being removed by the same statement.
    if new.photo_status is distinct from 'rejected' then
      new.photo_status := null;
      new.photo_set_by := null;
    end if;
    new.moderation_attempts := 0;
    return new;
  end if;

  -- A new picture. It has to be the caller's own upload, or the path is a
  -- name somebody learned and the group would become a way to read it.
  v_first := split_part(new.photo_path, '/', 1);
  if auth.uid() is not null and v_first <> auth.uid()::text then
    raise exception 'That photo is not one you uploaded.'
      using errcode = 'check_violation';
  end if;
  -- A safe cast: a seeded or service-role path may not start with a uuid, and
  -- a moderation event about nobody is still worth recording.
  v_setter := case
    when v_first ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then v_first::uuid
  end;

  new.moderation_attempts := 0;
  -- The subject of whatever verdict this photo is about to get. Null for a
  -- seeded path, which matches nobody, which is the right answer: nobody
  -- uploaded it.
  new.photo_set_by := v_setter;

  if public.config_flag('require_photo_moderation') then
    new.photo_status := 'pending';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_setter, 'group_photo', new.chat_id, 'queued_for_llm', 'photo-pipeline',
       jsonb_build_object('storage_path', new.photo_path, 'chat_id', new.chat_id));
  else
    new.photo_status := 'approved';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_setter, 'group_photo', new.chat_id, 'auto_approved', 'stub',
       jsonb_build_object('storage_path', new.photo_path, 'chat_id', new.chat_id));
  end if;
  return new;
end
$$;

revoke execute on function public.moderate_group_photo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The storage policy reads the two columns THROUGH a definer function now
-- ---------------------------------------------------------------------------
--
-- A policy expression runs with the reader's privileges, so a policy that
-- names a column the reader may not select answers "permission denied" rather
-- than false. chat_photos_select_group names g.photo_path and g.photo_status
-- directly (20260903050000:392), so without this every member would have lost
-- every approved group photo the moment the grant below went column-level.
-- The predicate is unchanged, term for term; only who evaluates it moves.

create or replace function public.can_view_group_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.groups g
    where g.photo_path = object_name
      and g.photo_status = 'approved'
      and (public.is_room_member(g.chat_id) or public.is_room_moderator(g.chat_id))
  )
$$;

revoke execute on function public.can_view_group_photo(text) from public, anon;
grant execute on function public.can_view_group_photo(text) to authenticated;

comment on function public.can_view_group_photo(text) is
  'Whether this caller may be handed a signed URL for a chat-photos object '
  'that is some group''s own picture: approved, and they are in that group. '
  'A definer function rather than the predicate inline, because an RLS policy '
  'is evaluated with the READER''s privileges and groups is column-granted - '
  'the same reason can_view_business_photo and can_view_photo_object exist.';

drop policy if exists chat_photos_select_group on storage.objects;
create policy chat_photos_select_group
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and public.can_view_group_photo(storage.objects.name)
  );

-- ---------------------------------------------------------------------------
-- The one client read of a group row
-- ---------------------------------------------------------------------------
--
-- Membership-gated exactly as groups_select_member is, because a definer
-- function does not get RLS applied to it and a function that forgot the
-- gate would be a wider door than the table it replaced.
--
-- The photo rule is the one my_chats already applies, said once more here:
-- approved is everybody's, and anything else is its setter's. moderation_
-- attempts is masked with it rather than dropped, so GroupRow on the client
-- keeps its shape and no screen has to learn a new one; the value a
-- non-setter gets is 0, which is what a group with nothing pending has.

create or replace function public.group_detail(p_chat_id uuid)
returns table (
  chat_id uuid,
  created_by uuid,
  name text,
  photo_path text,
  photo_status public.moderation_status,
  moderation_attempts int,
  speaking public.group_speaking,
  invites public.group_invites_who,
  max_stay_until date,
  pin_id uuid,
  plan_ended_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.chat_id,
    g.created_by,
    g.name,
    -- `=` and not `is not distinct from`: a null setter (a seeded path, or a
    -- photo refused before photo_set_by existed) must match nobody, and null
    -- = null is null, which is not true.
    case when g.photo_status = 'approved' or g.photo_set_by = auth.uid()
         then g.photo_path end,
    case when g.photo_status = 'approved' or g.photo_set_by = auth.uid()
         then g.photo_status end,
    case when g.photo_set_by = auth.uid() then g.moderation_attempts else 0 end,
    g.speaking,
    g.invites,
    g.max_stay_until,
    g.pin_id,
    g.plan_ended_at,
    g.created_at
  from public.groups g
  where g.chat_id = p_chat_id
    and (public.is_room_member(g.chat_id) or public.is_room_moderator(g.chat_id))
$$;

revoke execute on function public.group_detail(uuid) from public, anon;
grant execute on function public.group_detail(uuid) to authenticated;

comment on function public.group_detail(uuid) is
  'The group row as a member may hold it: the settings page and the room '
  'header read this, never the table. Members only, and the photo columns '
  'carry the same rule my_chats does - an approved photo is everybody''s, a '
  'pending or refused one is its setter''s alone, because a verdict is for '
  'its subject alone and photo_status is that verdict.';

-- ---------------------------------------------------------------------------
-- And the grant that makes all of the above the only way in
-- ---------------------------------------------------------------------------
--
-- The idiom profiles (20260816190000:353) and message_requests
-- (20260902210000:82) already use. Everything a member legitimately reads off
-- this table is listed; the three photo columns are not, and neither is
-- photo_set_by. A column added to public.groups after today must be added to
-- this list or it is unreadable - and must NOT be added to it if it says
-- anything about a photo before its verdict.

revoke select on public.groups from public, anon, authenticated;
grant select (chat_id, created_by, name, speaking, invites, max_stay_until,
              pin_id, plan_ended_at, created_at)
  on public.groups to authenticated;

notify pgrst, 'reload schema';
