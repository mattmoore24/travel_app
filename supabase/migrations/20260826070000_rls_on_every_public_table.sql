-- Row-level security on the five tables that never had it
-- ===========================================================================
--
-- Supabase's linter (rls_disabled_in_public) emailed the founder on
-- 2026-08-26: "Anyone with your project URL can read, edit, and delete all
-- data in this table."
--
-- That sentence is the linter's boilerplate, not a finding about this
-- project. Audited against a real Postgres with every migration applied, the
-- five tables in `public` without RLS grant this to the API roles:
--
--   app_config             anon: nothing        authenticated: nothing
--   moderation_blocklist   anon: nothing        authenticated: nothing
--   worker_invoke_log      anon: nothing        authenticated: nothing
--   cities                 anon: SELECT         authenticated: SELECT
--   launch_cities          anon: SELECT         authenticated: SELECT
--
-- Every one of those was already revoked or narrowed by hand in the
-- migration that created the table. Nobody could edit or delete any of them,
-- and the two that are readable hold city names, coordinates and which
-- cities are live: reference data that exists to be read.
--
-- So this is not a breach, and it is still worth closing. Three reasons:
--
--   1. It is one `grant` away from being true. The linter is right that the
--      table is undefended - it is the GRANT doing the work, and a grant is
--      a thing somebody adds in a hurry from the dashboard. RLS is the
--      belt this project wears everywhere else.
--   2. Section 7 of the product brief says the rules live in the database.
--      Five tables opted out of the mechanism that enforces that.
--   3. A linter that cries wolf gets ignored, and the next one might not be
--      a false alarm. Clear it so the next email means something.
--
-- The pattern here is the one four tables in this schema already use
-- (daily_spotlights, group_invites, moderation_events, push_queue): RLS on,
-- no policy, which denies every API role and is invisible to service_role
-- and to SECURITY DEFINER functions, both of which bypass RLS.

-- The three nobody may touch -------------------------------------------------
--
-- No policies on purpose. anon and authenticated hold no privilege on these
-- at all, so no SECURITY INVOKER path can reach them as those roles today -
-- such a path would already be failing with permission denied. RLS therefore
-- takes nothing away and stops a future grant from handing them over.
--
-- Their real readers are unaffected: is_llm_enabled, the support mailer's
-- config lookup, the featured/cap ceilings, screen_text and worker_status
-- are all SECURITY DEFINER, and the workers come in as service_role.

alter table public.app_config enable row level security;
alter table public.moderation_blocklist enable row level security;
alter table public.worker_invoke_log enable row level security;

comment on table public.moderation_blocklist is
  'Screening patterns. RLS on with no policy, and no client grant: a reader '
  'could learn how to word around it, so only definer functions see it.';


-- The two that are meant to be read ------------------------------------------
--
-- These need policies, and this is the part that would break the app if it
-- were skipped. RLS with no policy does not raise - it returns zero rows -
-- so getting this wrong looks like an empty city list rather than an error.
--
-- `search_cities` is SECURITY INVOKER and reads public.cities as the caller,
-- which is anon on the signed-out city search. get_matches is INVOKER too and
-- joins cities for the card. The client reads launch_cities directly for the
-- map's city rail. Every one of those goes through the policy below.
--
-- `using (true)` is the honest expression of what these are: a public
-- gazetteer. There is no per-row secret in a city's name or a launch city's
-- flag, and the grant already said as much - the policy just says it in the
-- mechanism that the rest of the schema is written in.
--
-- Scoped `to anon, authenticated` rather than `to public` so the policy
-- cannot widen anything the grants do not already allow.

alter table public.cities enable row level security;

create policy cities_readable on public.cities
  for select to anon, authenticated
  using (true);

alter table public.launch_cities enable row level security;

create policy launch_cities_readable on public.launch_cities
  for select to anon, authenticated
  using (true);

-- Deliberately no insert, update or delete policy on either. Seeding is the
-- generated migration's job and curation is the founder's, both as postgres.
