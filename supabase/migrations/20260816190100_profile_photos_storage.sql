-- Private bucket for profile photos.
--
-- Path convention: <user_id>/<photo_uuid>.jpg — the first path segment is the
-- owner's auth uid, and write policies key off it. Reads are limited to
-- authenticated users; which photos a user can *discover* is governed by RLS
-- on public.profile_photos (approved + visible owner), and object names are
-- unguessable UUIDs under a per-user prefix.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

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

create policy profile_photos_storage_select_authenticated
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos');
