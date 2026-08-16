-- Private bucket for profile photos.
--
-- Path convention: <user_id>/<photo_uuid>.jpg — the first path segment is the
-- owner's auth uid, and write policies key off it. Reads mirror the RLS on
-- public.profile_photos: your own objects, or objects backing an APPROVED
-- photo of a VISIBLE (active) owner — so rejected photos and shadowbanned or
-- banned users' photos are not fetchable, matching the DB-layer gate.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

-- Caller-scoped (auth.uid() bound internally — see the core migration's note
-- on why viewer parameters are forbidden on definer helpers).
create function public.can_view_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_photos pp
    where pp.storage_path = object_name
      and (
        pp.user_id = auth.uid()
        or (pp.moderation_status = 'approved' and public.is_visible_owner(pp.user_id))
      )
  )
$$;

revoke execute on function public.can_view_photo_object(text) from public, anon;

create policy profile_photos_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_photos_storage_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_photos_storage_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_photos_storage_select_gated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or public.can_view_photo_object(name)
    )
  );
