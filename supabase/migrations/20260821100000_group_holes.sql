-- Three holes the audit sweep found in the group rules.

-- 1. A group's photo was unreadable by everybody ----------------------------
--
-- chat-photos has exactly one select policy, and it matches the object
-- against a `messages.image_path`. A group's picture is not a message: it is
-- uploaded to the same bucket and recorded on `groups.photo_path`, so the
-- insert succeeded, `create_group` stored it, and then nobody — not the
-- members, not even the admin who chose it — could ever load it. Every group
-- photo in the product is currently invisible.

create policy chat_photos_select_group
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and exists (
      select 1 from public.groups g
      where g.photo_path = storage.objects.name
        and (public.is_room_member(g.chat_id) or public.is_room_moderator(g.chat_id))
    )
  );

-- And your own uploads, so the admin who just picked the photo can see it in
-- the moment between choosing it and the group existing, and so a pending
-- chat photo is not a broken tile to the person who sent it.
create policy chat_photos_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- 2. Removal did not stick --------------------------------------------------

create or replace function public.room_remove_member(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'room not found';
  end if;
  delete from public.room_members where chat_id = p_chat_id and user_id = p_user_id;
  -- clock_timestamp(), not the now() default: now() is frozen for the whole
  -- transaction, so a removal and a readmission written in one would carry
  -- the SAME created_at, and the rule below would be deciding by whichever
  -- random uuid sorted higher. This is the timestamp of the act, and it
  -- advances.
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata, created_at)
  values (p_user_id, 'room_member', p_chat_id, 'removed_by_moderator',
          'establishment', jsonb_build_object('chat_id', p_chat_id), clock_timestamp());
end
$$;

revoke execute on function public.room_remove_member(uuid, uuid) from public, anon;

create or replace function public.join_group_with_invite(p_token text, p_stay_until date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_max date;
  v_stay date;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  select g.chat_id, g.max_stay_until into v_chat, v_max
    from public.group_invites i
    join public.groups g on g.chat_id = i.chat_id
    join public.chats c on c.id = g.chat_id
   where i.token = p_token
     and i.revoked_at is null
     and i.expires_at > now()
     and c.status = 'active';

  if v_chat is null then
    raise exception 'That invite has expired or been withdrawn.' using errcode = '42501';
  end if;

  -- Removal has to mean something. Without this, an admin removing somebody
  -- who was making the group uncomfortable was told it worked while the
  -- person still held the same link everyone was sent, one tap from being
  -- back in — and the on-conflict below would even revive their archived row.
  --
  -- The tombstone is the moderation event room_remove_member already writes,
  -- so there is one record of this rather than two that can disagree. The
  -- LATEST of the two actions wins, which is what gives an admin a way to
  -- let somebody back in (allow_group_rejoin) without erasing the history.
  -- Both are stamped with clock_timestamp(), so "latest" is always decidable;
  -- a tie would otherwise have been broken by a random uuid.
  if (
    select coalesce(max(created_at) filter (where action = 'removed_by_moderator'),
                    '-infinity'::timestamptz)
         > coalesce(max(created_at) filter (where action = 'readmitted_by_moderator'),
                    '-infinity'::timestamptz)
      from public.moderation_events
     where subject_user_id = v_user
       and entity_type = 'room_member'
       and entity_id = v_chat
  ) then
    raise exception 'You were removed from this group. Ask an admin to let you back in.'
      using errcode = '42501';
  end if;
  if p_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;

  v_stay := least(p_stay_until, v_max);
  -- A week of grace after you leave, the same as a hostel room, so a
  -- conversation does not vanish the morning you fly out.
  v_expires := (v_stay + 7)::timestamptz;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at)
  values (v_chat, v_user, v_stay, v_expires)
  on conflict (chat_id, user_id) do update
    set departure_date = excluded.departure_date,
        expires_at = excluded.expires_at,
        archived_at = null;

  return jsonb_build_object('chat_id', v_chat, 'stay_until', v_stay, 'expires_at', v_expires);
end
$$;

/**
 * Let somebody back in after a removal.
 *
 * Without this, a removal would be permanent and unappealable, which is not
 * what an admin means by it half the time. It writes a counter-event rather
 * than deleting the removal, so the history stays readable and the check in
 * join_group_with_invite simply takes whichever came last.
 */
create function public.allow_group_rejoin(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.room_members
    where chat_id = p_chat_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'group not found';
  end if;

  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata, created_at)
  values (p_user_id, 'room_member', p_chat_id, 'readmitted_by_moderator',
          'establishment', jsonb_build_object('chat_id', p_chat_id), clock_timestamp());
end
$$;

revoke execute on function public.allow_group_rejoin(uuid, uuid) from public, anon;
grant execute on function public.allow_group_rejoin(uuid, uuid) to authenticated;

-- 3. The invite preview handed out a path nobody could read ------------------

create or replace function public.group_invite_preview(p_token text)
returns table (
  chat_id uuid,
  name text,
  photo_path text,
  member_count int,
  max_stay_until date,
  speaking public.group_speaking,
  already_member boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.chat_id,
    g.name,
    -- Only to somebody already in it. The bucket's read policy is scoped to
    -- members and the uploader (see below), and it cannot see an invite
    -- token, so handing the path to a stranger would only draw a broken
    -- image. The name and the numbers are what the screen is for.
    case when exists (
      select 1 from public.room_members rm3
      where rm3.chat_id = g.chat_id and rm3.user_id = auth.uid()
    ) then g.photo_path end,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = g.chat_id and rm.expires_at > now()),
    g.max_stay_until,
    g.speaking,
    exists (
      select 1 from public.room_members rm2
      where rm2.chat_id = g.chat_id and rm2.user_id = auth.uid() and rm2.expires_at > now()
    )
  from public.group_invites i
  join public.groups g on g.chat_id = i.chat_id
  join public.chats c on c.id = g.chat_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and c.status = 'active'
$$;

revoke execute on function public.group_invite_preview(text) from public, anon;
grant execute on function public.group_invite_preview(text) to authenticated;
