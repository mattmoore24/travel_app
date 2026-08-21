-- 1. A failed verification could not clean up after itself -------------------
--
-- submitVerificationSelfie uploads first, then calls submit_verification, and
-- on failure calls storage.remove() to take the orphan back out. That remove
-- has always been a no-op: Supabase Storage resolves the object row before
-- deleting it, so a DELETE policy without a matching SELECT policy leaves the
-- caller unable to see what they are asking to delete, and the call returns
-- success having removed nothing.
--
-- The commonest way to hit it is the ordinary one: finish onboarding with
-- photo moderation on, so your only photo is still pending, tap Get verified,
-- and submit_verification refuses with "add a profile photo before
-- verifying". The selfie stays in the bucket. Ten of those and the insert
-- policy's own ceiling locks you out of verifying at all.
--
-- Reading your own selfie is not an exposure: it is your face, in a folder
-- named after your own user id, and the insert policy already scopes writes
-- the same way.

create policy verification_selfies_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- 2. A group could be left with nobody able to run it ------------------------
--
-- Groups are private, their invite links live for thirty days, and only an
-- admin can revoke one or remove anybody. Delete the account of a group's
-- only admin and the group carries on with everyone still in it and the link
-- still admitting strangers, with no one on earth able to stop it.
--
-- Succession, rather than deletion: the group is other people's conversation
-- and it is not this migration's place to end it. The longest-standing member
-- takes over, preferring somebody who already had the microphone. If nobody
-- is left, the chat is closed, which is what every other empty room does.

create function public.promote_group_successor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next uuid;
begin
  -- Only groups, and only when the last admin has just gone.
  if not exists (select 1 from public.groups where chat_id = old.chat_id) then
    return old;
  end if;
  if exists (
    select 1 from public.room_members
    where chat_id = old.chat_id and role = 'admin'
  ) then
    return old;
  end if;

  select user_id into v_next
    from public.room_members
   where chat_id = old.chat_id
   order by (role = 'speaker') desc, joined_at, user_id
   limit 1;

  if v_next is null then
    update public.chats set status = 'closed' where id = old.chat_id;
  else
    update public.room_members
       set role = 'admin'
     where chat_id = old.chat_id and user_id = v_next;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata, created_at)
    values (v_next, 'room_member', old.chat_id, 'promoted_to_admin',
            'system', jsonb_build_object('chat_id', old.chat_id), clock_timestamp());
  end if;
  return old;
end
$$;

create trigger room_members_admin_succession
  after delete on public.room_members
  for each row execute function public.promote_group_successor();

revoke execute on function public.promote_group_successor() from public, anon, authenticated;
