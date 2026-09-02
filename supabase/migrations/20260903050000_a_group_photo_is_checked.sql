-- A GROUP'S OWN PHOTO IS CHECKED BEFORE ANYBODY ELSE SEES IT
--
-- src/features/groups/api.ts recorded the gap the day the camera permission
-- string was corrected: a photo posted INTO a chat is moderated through the
-- messages row it creates, but a group's OWN picture is not a message.
-- `groups.photo_path` (20260821010000:29) is a plain text column written by
-- create_group and update_group with no trigger, no status and no check, so a
-- group photo reached every member, and everybody holding an invite link who
-- was already a member, unchecked. app.json's camera string had promised
-- Apple, and a person, that every photo is checked before it reaches anyone
-- else; on 2026-09-01 (cc82431) it was narrowed to "profile photos and chat
-- photos" because this gap made the wider sentence untrue, and a group's own
-- picture is neither. This closes the gap the way business photos
-- (20260829180000) and post photos (20260902170000) were closed, so the
-- wider sentence could be true again if the founder chooses to restore it.
--
-- THE PIECES, and the entry point of each, because a door with nobody behind
-- it is the failure this project keeps paying for:
--
--   groups.photo_status        NULLABLE, never a new enum value. Set by the
--                              trigger below; read by my_chats,
--                              group_invite_preview, the storage policy, and
--                              src/features/groups/photo.ts on the client.
--   groups_moderate_photo      BEFORE INSERT OR UPDATE OF photo_path. Scoped
--                              to the one column it cares about AND
--                              early-returns when that column did not move,
--                              so a rename, an invite policy change or the
--                              worker's own attempt counter costs nothing
--                              persistent (the profiles lesson, 20260903030000).
--   groups_poke_moderation_insert / _update
--                              poke the worker for a pending photo, so the
--                              admin watching "Checking this photo" waits
--                              seconds rather than a cron minute. Two
--                              triggers because the UPDATE one is guarded on
--                              the path actually moving (a WHEN clause on an
--                              INSERT OR UPDATE trigger cannot mention OLD):
--                              a rename while a photo is pending names
--                              photo_path in its SET list and must not poke.
--   apply_group_photo_verdict  the worker's door. moderation-worker/index.ts
--                              queue 3d walks through it, with its own slice
--                              of the tick; moderation-worker-queues.test.ts
--                              fails if a migration opens a door the worker
--                              does not call. Keyed on the chat AND the path
--                              the worker classified: a group is one row, so
--                              a verdict keyed on the chat alone would land on
--                              whatever photo the row wears by the time it
--                              arrives. Answers false and writes nothing when
--                              that is no longer the photo it is about.
--   note_group_photo_attempt   the counter that makes MAX_ATTEMPTS reachable,
--                              so a photo the model keeps refusing ends in
--                              removal and not in 'pending' for ever.
--   chat_photos_select_group   the storage policy, now approved-only. This is
--                              the half that protects a phone on the PREVIOUS
--                              bundle: it reads groups.photo_path with no idea
--                              photo_status exists, and the bucket refuses to
--                              sign the picture for anyone but its uploader.
--   update_group               p_clear_photo nulls photo_status with the
--                              path. Sent by the group page's photo control
--                              (src/app/group/[id].tsx, "Remove photo" / "Go
--                              without a photo"), which is how an admin told
--                              "pick another" makes the notice go without
--                              choosing a new picture.
--
-- WHO MAY SEE WHAT, on every read of the path:
--   approved            everyone in the group (and the invite screen, to a
--                       member), exactly as before.
--   pending             the person who uploaded it, and nobody else. Their
--                       own upload is readable to them anyway
--                       (chat_photos_select_own keys on the path's first
--                       segment), so withholding it would hide nothing and
--                       leave the person who chose the picture looking at an
--                       empty frame - the same reasoning room_messages and
--                       business_detail already record. To everybody else
--                       there is NO photo, not a photo being checked: the
--                       client (photo.ts) shows a member the glyph and says
--                       nothing, because a member who could watch "being
--                       checked" turn into nothing would know the admin's
--                       picture was refused, and a verdict is for its
--                       subject alone.
--   rejected            nobody. The verdict REMOVES the path (as
--                       apply_chat_photo_verdict does for a chat photo) and
--                       leaves the status behind so the group page can tell
--                       the admin to pick another. Not a strike: the event
--                       action is 'group_photo_rejected', which
--                       is_strike_action does not count, and
--                       67_a_group_photo_is_checked asserts the ledger.
--
-- THE SETTER IS THE PATH. Every group photo is uploaded under the uploader's
-- own uid (chat_photos_insert_own enforces the folder), so the first segment
-- of photo_path IS who set it, and that is what the RPCs compare against
-- auth.uid(). The trigger now REQUIRES it: before this migration create_group
-- accepted any string as p_photo_path, which meant an admin could name any
-- object in the bucket they had ever learned the path of - another group's
-- photo, say - and chat_photos_select_group would then let every member read
-- it. Your own upload, or nothing.
--
-- DEPLOY WINDOW. An expo-updates bundle is never applied on the launch that
-- downloads it, so for at least one launch every phone runs the old client
-- against this schema. What that client shows is established, not assumed:
--   * the group page and the room header read groups.photo_path through
--     `select *` (a table-wide grant, so the two new columns ride in unread).
--     For an unapproved photo they hold a path the bucket refuses to sign, so
--     useChatPhotoUrl's query errors and the tile falls back to the group
--     glyph - the same picture a phone with no photo at all draws. The
--     uploader still sees their own picture, with no "checking" beside it.
--   * the chat list and the invite screen read RPCs, and both RPCs are
--     restated below to hand out the path only when it is approved or the
--     reader uploaded it. No OUT column moves, so nothing is dropped and no
--     grant has to be restated - they are restated anyway rather than trusted.
--
-- Existing rows with a photo are put through the same check every new photo
-- gets: approved if the flag is off, pending if it is on. There are no
-- production users; a founder's test group blinks to the glyph for one tick
-- and comes back.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

-- Nullable on purpose: a group with no photo has no verdict to carry, and an
-- old bundle reading `select *` must find nothing it has to interpret.
alter table public.groups
  add column if not exists photo_status public.moderation_status,
  add column if not exists moderation_attempts int not null default 0;

comment on column public.groups.photo_status is
  'Server-owned. NULL when there is no photo. The trigger sets it on every '
  'change of photo_path (pending with require_photo_moderation on, approved '
  'with it off), apply_group_photo_verdict moves it, and nothing else can: '
  'groups carries no client write grant at all. A rejected photo has its path '
  'removed and keeps this status so the admin can be told to pick another.';

comment on column public.groups.moderation_attempts is
  'How many times the worker has tried and failed to classify the current '
  'photo. Reset by the trigger whenever photo_path changes; bumped by '
  'note_group_photo_attempt; read by the worker to fail closed at MAX_ATTEMPTS.';

-- The worker's own lookup, and the storage policy's: both ask "which group
-- carries this path", not "which paths does this group carry".
create index if not exists groups_photo_path_idx
  on public.groups (photo_path)
  where photo_path is not null;

-- ---------------------------------------------------------------------------
-- The check
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
    if new.photo_status is distinct from 'rejected' then
      new.photo_status := null;
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

-- `update of photo_path`: the verdict's approve write, note_group_photo_attempt
-- and the plan bookkeeping (plan_ended_at, pin_id) never name this column, so
-- they never enter the function at all.
drop trigger if exists groups_moderate_photo on public.groups;
create trigger groups_moderate_photo
  before insert or update of photo_path on public.groups
  for each row execute function public.moderate_group_photo();

-- And the worker is poked, so the admin watching "Checking this photo" on the
-- group page waits seconds rather than a cron minute. AFTER, so the row is
-- there when the worker looks; poke_worker swallows its own failures, so a
-- keyless project still saves the group.
--
-- Two triggers, not one. A poke is persistent (a worker_pokes write and,
-- with pg_net, an HTTP request), so the UPDATE half needs the same "did the
-- path move" guard the moderate trigger has: update_group names photo_path
-- in its SET list on every call, and without the guard a RENAME while a
-- photo was pending poked the worker for a photo it had already been poked
-- for. A WHEN clause on an INSERT OR UPDATE trigger cannot mention OLD, so
-- the guard cannot be written on the combined form. 67 parks the throttle
-- row, renames, and asserts it did not move; then replaces the photo and
-- asserts it did.
drop trigger if exists groups_poke_moderation on public.groups;
drop trigger if exists groups_poke_moderation_insert on public.groups;
create trigger groups_poke_moderation_insert
  after insert on public.groups
  for each row
  when (new.photo_status = 'pending' and new.photo_path is not null)
  execute function public.poke_moderation_worker();

drop trigger if exists groups_poke_moderation_update on public.groups;
create trigger groups_poke_moderation_update
  after update of photo_path on public.groups
  for each row
  when (new.photo_status = 'pending'
        and new.photo_path is not null
        and old.photo_path is distinct from new.photo_path)
  execute function public.poke_moderation_worker();

-- Rows that already carry a photo get the same answer a new photo would.
update public.groups
   set photo_status = case
         when public.config_flag('require_photo_moderation') then 'pending'
         else 'approved'
       end::public.moderation_status
 where photo_path is not null
   and photo_status is null;

-- ---------------------------------------------------------------------------
-- The worker's door, and the counter that keeps it from spinning
-- ---------------------------------------------------------------------------
--
-- Mirrors apply_business_photo_verdict with three deliberate differences. A
-- rejected photo is REMOVED, as a rejected chat photo is: the path goes, the
-- status stays so the admin is told. The ledger action is
-- 'group_photo_rejected', not 'photo_rejected': the uploader is a traveler
-- with a strike ledger, is_strike_action counts 'photo_rejected', and a group
-- picture the model did not like is not a strike against the person who
-- chose it. No push either way; the group page says it.
--
-- And the verdict names the PATH it is about, not just the chat. A profile,
-- chat, business or post photo is its own row, so a verdict keyed on the
-- row's id can only ever land on the photo the worker looked at. A group is
-- ONE row: if the admin replaces the picture while the worker is classifying
-- the previous one, the trigger sets the new path pending, and a verdict
-- keyed on the chat alone would be applied to the new path - an allow would
-- approve a photo nobody had looked at. So the door takes the path the worker
-- signed (index.ts holds group.photo_path from the same select), matches it
-- against the row under lock, and when it is no longer the group's photo
-- (replaced, or cleared by the admin) answers false and writes NOTHING. Not
-- an error: an error would send the worker down its failure branch and bump
-- the counter of the photo that replaced it, which has never been tried.
-- The failsafe walks through the same door with the same path, for the same
-- reason. 67 writes the race as the attack.
create or replace function public.apply_group_photo_verdict(
  p_chat_id uuid,
  p_photo_path text,
  p_verdict jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
  v_first text;
  v_setter uuid;
begin
  perform public.assert_service_caller();
  select * into v_group
  from public.groups
  where chat_id = p_chat_id
  for update;
  if not found
     or v_group.photo_status is distinct from 'pending'
     or v_group.photo_path is distinct from p_photo_path then
    -- The group no longer wears the photo this verdict is about. Whatever
    -- it wears now is the next tick's to look at.
    return false;
  end if;

  v_first := split_part(v_group.photo_path, '/', 1);
  v_setter := case
    when v_first ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then v_first::uuid
  end;

  if p_verdict ->> 'action' = 'allow' then
    update public.groups
      set photo_status = 'approved' where chat_id = p_chat_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_setter, 'group_photo', p_chat_id, 'group_photo_approved',
       'claude-moderator', p_verdict);
  else
    -- Removed, and the trigger keeps 'rejected' because it is what this
    -- statement writes. metadata keeps the path so the founder can still
    -- find the object if an appeal ever needs it.
    update public.groups
      set photo_status = 'rejected', photo_path = null where chat_id = p_chat_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_setter, 'group_photo', p_chat_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'group_photo_rejected_failsafe'
            else 'group_photo_rejected' end,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict || jsonb_build_object('storage_path', v_group.photo_path));
  end if;
  return true;
end
$$;

revoke execute on function public.apply_group_photo_verdict(uuid, text, jsonb)
  from public, anon, authenticated;

comment on function public.apply_group_photo_verdict(uuid, text, jsonb) is
  'The moderation worker''s verdict on a group''s own photo. Takes the path '
  'the worker classified as well as the chat: a group is one row, so a verdict '
  'keyed on the chat alone would land on whatever photo the row wears by the '
  'time it arrives. Returns true when applied; false, writing nothing, when '
  'the group no longer wears that photo. Service role only.';

create or replace function public.note_group_photo_attempt(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_service_caller();
  update public.groups
     set moderation_attempts = moderation_attempts + 1
   where chat_id = p_chat_id;
end
$$;

revoke execute on function public.note_group_photo_attempt(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may read the object
-- ---------------------------------------------------------------------------
--
-- Restated from 20260821100000:12 with one more term. This is the enforcement
-- that reaches a client which has never heard of photo_status: whatever path
-- it holds, the bucket signs a member's group photo only once approved. The
-- uploader keeps reading their own upload through chat_photos_select_own.

drop policy if exists chat_photos_select_group on storage.objects;
create policy chat_photos_select_group
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and exists (
      select 1 from public.groups g
      where g.photo_path = storage.objects.name
        and g.photo_status = 'approved'
        and (public.is_room_member(g.chat_id) or public.is_room_moderator(g.chat_id))
    )
  );

-- ---------------------------------------------------------------------------
-- update_group: clearing the photo clears its verdict
-- ---------------------------------------------------------------------------
--
-- Restated from 20260901180000:100-155, its current definition, with ONE
-- change: p_clear_photo now also nulls photo_status, so an admin told "pick
-- another" can decide to have no photo instead and the notice goes with it.
-- The group page's photo control sends it ("Remove photo" while a picture is
-- up, "Go without a photo" after a refusal); until it did, this branch was a
-- documented escape no screen could take. The signature does not move, so
-- create-or-replace keeps the grants; they are restated below anyway.

create or replace function public.update_group(
  p_chat_id uuid,
  p_name text default null,
  p_speaking public.group_speaking default null,
  p_max_stay_until date default null,
  p_photo_path text default null,
  p_clear_photo boolean default false,
  p_clear_max_stay boolean default false,
  p_invites public.group_invites_who default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;
  if p_clear_max_stay and p_max_stay_until is not null then
    raise exception 'Pick a date or no end date, not both.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
  end if;

  update public.groups
     set name = coalesce(btrim(p_name), name),
         speaking = coalesce(p_speaking, speaking),
         invites = coalesce(p_invites, invites),
         max_stay_until = case
           when p_clear_max_stay then null
           else coalesce(p_max_stay_until, max_stay_until)
         end,
         photo_path = case
           when p_clear_photo then null
           else coalesce(p_photo_path, photo_path)
         end,
         -- Only the clear touches this. A new path is the trigger's to judge,
         -- and an unchanged one keeps whatever verdict it has.
         photo_status = case
           when p_clear_photo then null
           else photo_status
         end
   where chat_id = p_chat_id;
end
$$;

revoke execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean,
                      public.group_invites_who)
from public, anon;
grant execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean,
                      public.group_invites_who)
to authenticated;

-- ---------------------------------------------------------------------------
-- my_chats: the chat list is handed the path only when it may draw it
-- ---------------------------------------------------------------------------
--
-- Restated from 20260902000000, its current definition, with the room branch
-- of the photo expression changed and NOTHING else. The OUT columns do not
-- move, so create-or-replace is right and there is no signature to drop.
-- The chat list row (src/features/chat/chat-row.tsx) needs no change: a null
-- path is already the glyph.

create or replace function public.my_chats(p_archived boolean default false)
returns table (
  chat_id uuid,
  kind public.chat_kind,
  chat_status public.chat_status,
  title text,
  other_user_id uuid,
  photo_path text,
  first_message text,
  first_message_sender_id uuid,
  last_message text,
  last_message_at timestamptz,
  member_count int,
  pinned boolean,
  muted boolean,
  archived boolean,
  expires_at timestamptz,
  created_at timestamptz,
  my_role text,
  unread_count int,
  first_message_element text,
  plan_date date,
  public_preview boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.chat_participants cp on cp.chat_id = c.id and cp.user_id = auth.uid()
    where c.kind in ('direct', 'business')
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.room_members rm on rm.chat_id = c.id and rm.user_id = auth.uid()
    where rm.expires_at > now() or rm.role = 'admin'
       or public.group_chat_closed(c.id)
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    join public.business_staff s
      on s.business_id = b.id and s.user_id = auth.uid()
    union
    select c.id, c.kind, c.status, c.created_at
    from public.chats c
    join public.businesses b on b.chat_id = c.id
    where b.owner_user_id = auth.uid()
  )
  select
    m.id,
    m.kind,
    m.status,
    case
      when m.kind = 'room' then coalesce(b.name, g.name)
      when m.kind = 'business' then coalesce(ob.name, op.display_name)
      else op.display_name
    end,
    other.user_id,
    case
      -- A group's photo, once it has cleared - or to the person who uploaded
      -- it, who can read their own upload regardless. Everybody else gets
      -- null, which the row draws as the group glyph.
      when m.kind = 'room' then
        case
          when g.photo_status = 'approved' then g.photo_path
          when split_part(g.photo_path, '/', 1) = auth.uid()::text then g.photo_path
        end
      when m.kind = 'business' and ob.id is not null then
        (select bp.storage_path from public.business_photos bp
          where bp.business_id = ob.id and bp.moderation_status = 'approved'
          order by bp.position limit 1)
      else
        (select pp.storage_path from public.profile_photos pp
          where pp.user_id = other.user_id and pp.moderation_status = 'approved'
          order by pp.position limit 1)
    end,
    r.first_message,
    r.sender_id,
    coalesce(lm.body, case when lm.image_path is not null then 'Photo' else null end),
    lm.created_at,
    case when m.kind = 'room'
      then (select count(*)::int from public.room_members rm2
             where rm2.chat_id = m.id and rm2.expires_at > now())
      else null end,
    coalesce(pref.pinned, false),
    coalesce(pref.muted, false),
    pref.archived_at is not null,
    rmine.expires_at,
    m.created_at,
    case
      when b.chat_id is not null then
        case when public.is_room_moderator(m.id) then 'admin' else null end
      when g.chat_id is not null then rmine.role::text
      else null
    end,
    (
      select count(*)::int
      from public.messages msg
      where msg.chat_id = m.id
        and msg.sender_id <> auth.uid()
        and msg.removed_at is null
        and msg.unsent_at is null
        and msg.moderation_status = 'approved'
        and msg.created_at > coalesce(
          pref.last_read_at,
          rmine.joined_at,
          cpmine.created_at,
          m.created_at
        )
    ),
    r.profile_element,
    (select p.intent_date from public.pins p
      where p.id = g.pin_id and p.expires_at > now()),
    b.public_preview
  from mine m
  left join public.businesses b on b.chat_id = m.id
  left join public.groups g on g.chat_id = m.id
  left join public.chat_participants other
    on other.chat_id = m.id and other.user_id <> auth.uid()
   and m.kind in ('direct', 'business')
  left join public.chat_participants cpmine
    on cpmine.chat_id = m.id and cpmine.user_id = auth.uid()
  left join public.profiles op on op.user_id = other.user_id
  left join public.businesses ob
    on m.kind = 'business' and ob.owner_user_id = other.user_id
  left join lateral (
    select mr.first_message, mr.sender_id, mr.profile_element
    from public.message_requests mr
    where mr.chat_id = m.id
    order by mr.created_at
    limit 1
  ) r on true
  left join public.chat_prefs pref on pref.chat_id = m.id and pref.user_id = auth.uid()
  left join public.room_members rmine on rmine.chat_id = m.id and rmine.user_id = auth.uid()
  left join lateral (
    select msg.body, msg.image_path, msg.created_at
    from public.messages msg
    where msg.chat_id = m.id
      and msg.removed_at is null
      and msg.unsent_at is null
      and msg.moderation_status = 'approved'
    order by msg.created_at desc
    limit 1
  ) lm on true
  where (pref.archived_at is not null) = p_archived
    and (
      m.kind <> 'business'
      or not public.is_business_account(auth.uid())
      or public.is_visible_owner(other.user_id)
    )
  order by coalesce(pref.pinned, false) desc,
           coalesce(lm.created_at, m.created_at) desc
$$;

revoke execute on function public.my_chats(boolean) from public, anon;
grant execute on function public.my_chats(boolean) to authenticated;

comment on function public.my_chats(boolean) is
  'Every conversation this caller is in, one row each, with the reader''s own '
  'prefs folded in. plan_date is the day of the pin the room opened from and '
  'is null once that pin has expired or been swept (hard rule 3); '
  'public_preview is the room''s readability, null for a traveler group. A '
  'group''s photo_path is handed out only once approved, or to its uploader.';

-- ---------------------------------------------------------------------------
-- group_invite_preview: a member is handed the path only when it may be drawn
-- ---------------------------------------------------------------------------
--
-- Restated from 20260827170000:454-495, its current definition, with the
-- photo expression narrowed and NOTHING else: still members only (a stranger
-- could not sign it anyway), and now approved-or-own within that. Same OUT
-- columns, so no drop; both grants restated rather than trusted.

create or replace function public.group_invite_preview(p_token text)
returns table (
  chat_id uuid,
  name text,
  photo_path text,
  member_count int,
  max_stay_until date,
  speaking public.group_speaking,
  already_member boolean,
  closed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.chat_id,
    g.name,
    case when exists (
      select 1 from public.room_members rm3
      where rm3.chat_id = g.chat_id and rm3.user_id = auth.uid()
    ) and (
      g.photo_status = 'approved'
      or split_part(g.photo_path, '/', 1) = auth.uid()::text
    ) then g.photo_path end,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = g.chat_id and rm.expires_at > now()),
    g.max_stay_until,
    g.speaking,
    exists (
      select 1 from public.room_members rm2
      where rm2.chat_id = g.chat_id and rm2.user_id = auth.uid() and rm2.expires_at > now()
    ),
    (c.status <> 'active' or now() >= public.group_closes_at(g.max_stay_until))
  from public.group_invites i
  join public.groups g on g.chat_id = i.chat_id
  join public.chats c on c.id = g.chat_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
$$;

revoke execute on function public.group_invite_preview(text) from public;
grant execute on function public.group_invite_preview(text) to anon, authenticated;

comment on function public.group_invite_preview(text) is
  'The invite screen. Returns a row for a chat that has ended as well as one '
  'that is open, with `closed` saying which, so a group that ran its course is '
  'not described to a stranger as a link somebody turned off. photo_path only '
  'to a member, and only once approved or when they uploaded it.';

notify pgrst, 'reload schema';
