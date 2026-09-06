-- A BUCKET SAYS WHAT IT TAKES.
--
-- All five storage buckets are private, which is the half that was already
-- right and the half people usually get wrong. What none of them had was a
-- size limit or a content-type allowlist:
--
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--   -- five rows, public=false on every one, and null, null on every one.
--
-- Null means "whatever the project allows", and the project's own upload
-- ceiling is a dashboard number measured in tens of megabytes. So the standing
-- storage caps -- 30 objects in profile-photos, 200 in chat-photos, 10 in
-- verification-selfies (20260817150000, 20260817200000) -- bound the COUNT of
-- objects an account can hold and say nothing about their size. Thirty objects
-- with no size limit is not a bound on anything that gets billed.
--
-- And null on allowed_mime_types means a signed URL out of these buckets can
-- be served as text/html. The app renders them through <Image>, so nothing in
-- the product is at risk today; a signed URL opened in a browser is a
-- different story, and it is a link somebody can be sent.
--
-- WHAT THE CLIENT ACTUALLY UPLOADS, which is why the allowlist can be this
-- narrow without breaking a feature: every upload in the app goes through
-- processAndUploadImage (src/lib/image-upload.ts). It resizes to 1440px wide,
-- re-encodes with saveAsync({ compress: 0.8, format: SaveFormat.JPEG }), and
-- uploads with contentType: 'image/jpeg' -- one code path, one type, no
-- exceptions, and no edge function uploads at all (they list, sign and
-- delete). A file in these buckets that is not a JPEG did not come from this
-- app.
--
-- 5 MB against a 1440px JPEG at quality 0.8, which lands between 200 KB and
-- 2 MB in practice: room for the worst photograph anyone will take, and an
-- order of magnitude off the project ceiling.
--
-- Guarded on the column existing, because the local shim (scripts/db-test.sh)
-- stands up a storage.buckets with only the columns the RLS tests need.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
    set file_size_limit = 5 * 1024 * 1024,
        allowed_mime_types = array['image/jpeg']
    where id in (
      'profile-photos',
      'chat-photos',
      'verification-selfies',
      'business-photos',
      'business-verification'
    );
  end if;
end
$$;
