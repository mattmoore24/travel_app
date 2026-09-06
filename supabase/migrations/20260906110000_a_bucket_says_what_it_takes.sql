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
-- WHAT ACTUALLY UPLOADS, which is what decides how narrow the allowlist can be.
--
-- Every upload from the APP goes through processAndUploadImage
-- (src/lib/image-upload.ts:217). It resizes to 1440px wide, re-encodes with
-- saveAsync({ compress: 0.8, format: SaveFormat.JPEG }) and uploads with
-- contentType: 'image/jpeg' -- one code path, one type, no exceptions. No edge
-- function uploads at all; they list, sign and delete.
--
-- THE FIRST DRAFT OF THIS MIGRATION ALLOWED ONLY image/jpeg ON THAT BASIS, AND
-- IT WAS WRONG. scripts/seed-demo-travelers.mjs:200 fetches a generated
-- portrait and PUTs it with 'Content-Type': 'image/png', through the same
-- storage path the app uses so it goes through the real moderation queue. The
-- live bucket agrees: of the sixteen objects in profile-photos, TWELVE are
-- image/png -- the seeded demo travelers, who are most of what is in there.
--
-- And it would have failed SILENTLY. That upload sits in a try/catch whose
-- handler is `console.log('::warning::photo for ... skipped')`, so a rejected
-- content type does not fail the seed: it produces demo travelers with no
-- photo, and a map with no avatar markers, while the script reports success.
--
-- So: jpeg and png. That gives up nothing the allowlist was for. The exposure
-- being closed is "any content type at all", including text/html and
-- application/javascript on a signed URL somebody can be sent -- not "any image
-- format". Neither jpeg nor png can carry script. image/svg+xml can, and is
-- deliberately NOT here.
--
-- 5 MB: the largest object in any bucket today is 2.0 MB, and a 1440px JPEG at
-- quality 0.8 lands between 200 KB and 2 MB. Room for the worst photograph
-- anyone will take, and an order of magnitude off the project ceiling.
-- Existing objects are unaffected either way; a bucket's limits apply to new
-- uploads, not to reads of what is already stored.
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
        allowed_mime_types = array['image/jpeg', 'image/png']
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
