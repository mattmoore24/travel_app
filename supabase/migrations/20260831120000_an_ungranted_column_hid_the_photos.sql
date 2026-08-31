-- The owner's photo grid read "0 of 10" forever, with the photo safely in the
-- database.
--
-- business_photos is guarded by COLUMN-level select grants (20260827110000
-- lists six columns by name), and 20260829180000 added a seventh column,
-- moderation_attempts, without touching the grant. Postgres refuses
-- `select *` unless every column it expands to is granted, so the app's
-- `.select('*')` on business_photos has answered `permission denied` to its
-- own owner since that migration deployed. The write half was untouched — the
-- insert grant names its three columns — so an upload SUCCEEDED, the row
-- landed, and the read-back then failed. On screen that is the exact shape
-- e2e runs 90 to 92 photographed: spinner while the mutation runs, then the
-- empty add tile again, no photo, no error, because a failed QUERY renders as
-- its empty state unless the screen opts into LoadError. Run 89 was green
-- only because its flow never checked that the photo landed.
--
-- The grant mirrors the original's audience (anon, authenticated): the
-- column is a moderation retry counter on rows RLS already scopes, and a
-- symmetric grant means the next `select *` cannot half-work by role.
-- 31_select_star_stays_readable.test.sql now pins `select *` on every table
-- the app star-reads, so the next `add column` on one of them fails in CI
-- instead of in a founder's photo grid.

grant select (moderation_attempts)
  on public.business_photos to anon, authenticated;
