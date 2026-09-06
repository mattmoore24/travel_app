-- CLOSE THE DOORS NOBODY MEANT TO OPEN.
--
-- Security hardening, 2026-09-06. Every item here was found by reading the LIVE
-- database (pg_proc, pg_namespace, has_function_privilege) rather than the
-- migrations, because the finding in both cases is a grant that no migration
-- ever wrote: Postgres and the extension defaults wrote them.
--
-- Nothing here changes behaviour for the app. Every revoke below was checked
-- against the client first: `grep -rn "rpc('<name>'" src/ supabase/functions/`
-- returns zero for all twelve trigger functions, and the two privileged
-- callers of pg_net are SECURITY DEFINER functions owned by postgres, which
-- keep their access whatever anon and authenticated lose.
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

-- 1. pg_net: THE ONE REAL HOLE.
--
-- `create extension pg_net` grants EXECUTE on net.http_get, net.http_post,
-- net.http_delete and net.http_collect_response to PUBLIC, and grants USAGE on
-- schema net broadly. Verified live before writing this:
--   has_function_privilege('anon','net.http_post(...)','EXECUTE') = true
--   has_schema_privilege('anon','net','USAGE')                    = true
-- ...and the same for authenticated.
--
-- What that is worth to an attacker: the database will issue arbitrary HTTP
-- requests on their behalf, from Supabase's network. That is server-side
-- request forgery against anything the database can reach, an outbound-request
-- amplifier pointed at any third party, and an unbounded cost and storage vector
-- (every call queues a row in net._http_response).
--
-- TODAY the only thing preventing it is that schema `net` is not in PostgREST's
-- exposed-schema list, which is a DASHBOARD setting one careless change away
-- from being wrong, and which this repository cannot assert. Defence in depth
-- costs nothing here: the app never calls these as anon or authenticated, so
-- revoking removes the hole rather than mitigating it.
--
-- Guarded because the local test shim (scripts/db-test.sh) has no pg_net.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    execute 'revoke all on schema net from anon, authenticated';
    execute 'revoke all on all functions in schema net from public, anon, authenticated';
    execute 'revoke all on all tables in schema net from public, anon, authenticated';
    -- Future objects too, or the next pg_net upgrade re-opens it.
    execute 'alter default privileges in schema net revoke all on functions from public, anon, authenticated';
    execute 'alter default privileges in schema net revoke all on tables from public, anon, authenticated';
  end if;
end
$$;

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
  'nobody asked for. pg_net is revoked from both roles as well - the workers '
  'reach it through SECURITY DEFINER functions owned by postgres.';

notify pgrst, 'reload schema';
