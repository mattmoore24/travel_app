-- CLOSE THE DOORS NOBODY MEANT TO OPEN.
--
-- Security hardening, 2026-09-06. Every item here was found by reading the LIVE
-- database (pg_proc, pg_namespace, has_function_privilege) rather than the
-- migrations, because the finding in both cases is a grant that no migration
-- ever wrote: Postgres and the extension defaults wrote them.
--
-- Nothing here changes behaviour for the app. Every revoke below was checked
-- against the client first: `grep -rn "rpc('<name>'" src/ supabase/functions/`
-- returns zero for all twelve trigger functions.
--
-- THIS FILE DOES ONE THING, NOT TWO. It closes the trigger functions. It does
-- NOT close pg_net - that cannot be done from a migration, and attempting it
-- would have broken every background worker. Section 1 is the record of why.
--
-- WHAT WAS ALREADY RIGHT, recorded so a later reader does not "fix" it again:
--   * every table in public has RLS enabled — no exceptions;
--   * no write policy anywhere is unrestricted;
--   * the fifteen tables with RLS and zero policies (app_config, push_queue,
--     outbound_mail, moderation_events, apple_refresh_tokens and the rest) are
--     deny-all BY DESIGN and correct: server-owned tables no client may read;
--   * the ten admin_* views lack security_invoker but are granted only to
--     postgres and service_role, so they are unreachable from the API. For an
--     admin view, bypassing RLS is the point;
--   * invoke_edge_worker, poke_worker, set_worker_credentials, seed_launch_pins,
--     push_last_call and apply_message_verdict are all closed to anon AND
--     authenticated already;
--   * no SECURITY DEFINER function in public has a mutable search_path.

-- 1. pg_net: THE HOLE THIS MIGRATION CANNOT CLOSE, AND MUST NOT TRY TO.
--
-- `create extension pg_net` leaves net.http_get, net.http_post, net.http_delete
-- and net.http_collect_response executable by PUBLIC, and schema net usable
-- broadly. Verified live:
--   has_function_privilege('anon','net.http_post(...)','EXECUTE') = true
--   has_schema_privilege('anon','net','USAGE')                    = true
-- Worth to an attacker who could reach it: the database issues arbitrary HTTP
-- requests from Supabase's network. SSRF, an outbound amplifier, and a row in
-- net._http_response per call.
--
-- THIS FILE ORIGINALLY REVOKED ALL OF THAT. The revokes have been REMOVED, for
-- two measured reasons, and the removal is the fix rather than a retreat.
--
-- FIRST, THEY DO NOTHING HERE. Migrations run as `postgres`, and on Supabase:
--   current_user = postgres, rolsuper = FALSE
--   schema net and all 12 net.* functions are owned by supabase_admin
-- A role that is neither owner nor superuser cannot revoke a privilege it did
-- not grant; Postgres warns and changes nothing. Running all three statements
-- against the live database inside a rolled-back transaction left
-- has_schema_privilege('anon','net','USAGE') and
-- has_function_privilege('anon','net.http_post(...)','EXECUTE') both still TRUE.
--
-- SECOND, AND WORSE: WHERE THEY WOULD WORK, THEY WOULD BREAK THE PRODUCT.
-- net.http_post carries a NULL ACL - the default, which is EXECUTE to PUBLIC
-- and nothing else. `postgres` therefore reaches it through the PUBLIC grant
-- and through no other route:
--   proacl = null, has_function_privilege('postgres', 'net.http_post', 'EXECUTE') = true
-- So `revoke all on all functions in schema net from public` takes the
-- privilege away from postgres too - and public.invoke_edge_worker is SECURITY
-- DEFINER owned by postgres. Every cron worker (moderation, push, and the rest)
-- would stop dead. An earlier draft of this file asserted the opposite in a
-- comment: "the workers keep their access whatever anon and authenticated
-- lose". That was wrong, and it was wrong in the dangerous direction.
--
-- There is no correct version of the revoke. anon and authenticated hold no
-- direct grant to take away - their access IS the PUBLIC grant - so the only
-- statement that would help is the one that breaks the workers, and repairing
-- that needs an explicit grant back, which needs ownership, which this role
-- does not have.
--
-- WHAT ACTUALLY PROTECTS THIS, and always has: schema `net` is not in
-- PostgREST's exposed-schema list, so nothing routes from the API to these
-- functions. That is a dashboard setting this repository can neither read nor
-- change, which makes it a checklist item and not a migration - see
-- docs/security/MANUAL_CHECKLIST.md, section 2, first entry.

-- 2. TRIGGER FUNCTIONS ARE NOT AN API.
--
-- Twelve trigger functions in public were callable via /rest/v1/rpc/ by
-- authenticated, eleven of them by anon, because Postgres grants EXECUTE on a
-- new function to PUBLIC and nothing revoked it.
--
-- HONEST SEVERITY: this is hygiene, not a breach. Postgres refuses a direct
-- call to a trigger function ("trigger functions can only be called as
-- triggers", SQLSTATE 0A000), so none of them leaks or writes anything. What
-- it does do is put twelve functions in the public API surface, in the
-- advisors' warning list, and in the way of anyone auditing what is genuinely
-- callable. A quiet API is one where everything present is meant to be there.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'groups_remember_the_plan_ended',
    'guest_membership_cap',
    'guest_message_limits',
    'guest_profile_stays_minimal',
    'guests_do_not_broadcast',
    'guests_do_not_reach_strangers',
    'guests_do_not_upload',
    'messages_kind_is_earned',
    'moderate_business_photo_stub',
    'pin_owner_is_a_traveler',
    'reset_visibility_when_unverified',
    'validate_pin'
  ] loop
    -- By name, over every overload, and only where the function actually
    -- returns trigger: a same-named ordinary function must keep its grants.
    -- (guest_membership_cap and guest_message_limits are trigger functions
    -- here despite reading like getters; the filter is what proves it rather
    -- than the name.)
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = v_fn and t.typname = 'trigger'
    ) then
      execute format(
        'revoke all on function public.%I() from public, anon, authenticated', v_fn);
    end if;
  end loop;
end
$$;

-- 3. AND THE SAME FOR ANY TRIGGER FUNCTION ADDED LATER.
--
-- The twelve above are today's list. This catches the thirteenth: any function
-- in public that returns trigger and is still executable by anon or
-- authenticated gets closed. Written as a sweep rather than a list so the fix
-- does not go stale the next time somebody adds a trigger.
do $$
declare
  r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and t.typname = 'trigger'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format(
      'revoke all on function public.%I() from public, anon, authenticated', r.proname);
  end loop;
end
$$;

comment on schema public is
  'Samewhere. Trigger functions carry no EXECUTE for anon or authenticated: '
  'they are reachable only as triggers, and a grant on one is an API surface '
  'nobody asked for. pg_net is deliberately NOT touched here: its objects '
  'belong to supabase_admin, and revoking PUBLIC from them would cut off '
  'postgres and stop every cron worker. Schema net not being an exposed '
  'PostgREST schema is what protects it.';

notify pgrst, 'reload schema';
