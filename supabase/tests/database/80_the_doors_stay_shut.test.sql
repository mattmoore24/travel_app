-- THE DOORS 20260906090000 CLOSED, AND THE ONE THAT WAS NEVER OPEN.
--
-- Every finding in that migration was a grant NO MIGRATION EVER WROTE:
-- Postgres grants EXECUTE on a new function to PUBLIC, and `create extension
-- pg_net` grants its HTTP functions to PUBLIC as well. Reading the repository
-- would have found none of them. That is exactly why they need a test: the
-- next trigger function anybody adds arrives with the same grant, and nothing
-- in a diff will say so.
--
-- The last assertion here is different in kind. It is the reason SEC-005 is
-- documented rather than fixed, and it is proved rather than asserted.
--
--   The advisor flags 29 SECURITY INVOKER functions for a mutable search_path,
--   including city_pins, get_matches and haversine_km. An invoker function runs
--   as its CALLER, so a caller who controls the search_path controls only their
--   own privileges and has nothing to escalate to. The one case where it would
--   matter is an invoker function reached from inside a SECURITY DEFINER
--   context - and every one of the 205 definer functions in this schema pins
--   its search_path, which by Postgres's own semantics applies for the duration
--   of the call INCLUDING anything that call reaches.
--
--   So the fix would be a blanket `SET search_path` on 29 functions, several of
--   which are simple SQL called per row in a distance predicate, where a SET
--   clause blocks inlining. A real performance regression bought with nothing.
--   The two assertions below hold the two facts that argument rests on, so if
--   either stops being true this file fails instead of the argument silently
--   rotting.
begin;
select plan(9);

-- AND THIS FILE IS THE STANDING GUARD, not the migration.
--
-- 20260906090000 ends with a sweep over "any function in public that returns
-- trigger and is still executable", written so the fix would not go stale the
-- next time somebody adds a trigger. Mutating it proved that reading generous:
-- deleting the sweep entirely changes nothing, because the named list above it
-- already covers all twelve that exist. The sweep runs ONCE, when the migration
-- applies - a trigger function created by a later migration is added after it
-- has run and is never reached by it.
--
-- So the migration cleans up today's grants and the assertions below are what
-- catch tomorrow's. That is the right split, but only if this file exists.

-- 1. TRIGGER FUNCTIONS ARE NOT AN API -------------------------------------

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and t.typname = 'trigger'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'no trigger function in public is executable by anon'
);
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and t.typname = 'trigger'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'nor by authenticated'
);

-- Proof the query above can see anything at all. A count over an empty set is
-- zero, and a test whose subject vanished passes silently otherwise.
select cmp_ok(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and t.typname = 'trigger'),
  '>=', 12,
  'and there are trigger functions in public to have been checked'
);

-- 2. THE PRIVILEGED RPCS ---------------------------------------------------

select is(
  (select count(*)::int from unnest(array[
     'invoke_edge_worker', 'poke_worker', 'set_worker_credentials',
     'seed_launch_pins', 'apply_message_verdict', 'worker_status',
     'claim_moderation_budget', 'release_moderation_budget', 'config_int'
   ]) fn
   join pg_proc p on p.proname = fn
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'no server-only RPC is reachable by anon or authenticated'
);

-- 3. pg_net ----------------------------------------------------------------
--
-- Written to be vacuously true where the extension is absent, because the
-- local shim has no pg_net and a `skip` would hide a real regression the day
-- somebody runs this against a database that does.
select is(
  (select count(*)::int from pg_namespace n
    where n.nspname = 'net'
      and (has_schema_privilege('anon', n.oid, 'USAGE')
        or has_schema_privilege('authenticated', n.oid, 'USAGE'))),
  0,
  'neither API role has USAGE on schema net'
);

-- 4. EVERY DEFINER PINS ITS PATH -------------------------------------------
--
-- The invariant that makes SEC-005 moot. A SECURITY DEFINER function without a
-- pinned search_path is the real search_path vulnerability, and this schema has
-- none: the advisor's 29 warnings are all INVOKER.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null
        or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))),
  0,
  'every SECURITY DEFINER function in public pins its search_path'
);
select cmp_ok(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  '>=', 100,
  'and there are definer functions to have been checked'
);

-- 5. AND THAT PIN REACHES WHAT THE DEFINER CALLS ---------------------------
--
-- The half of the SEC-005 argument that is a claim about POSTGRES rather than
-- about this schema, so it is demonstrated here instead of cited. If this ever
-- fails, pinning the definers stops protecting the invokers they call and
-- SEC-005 has to be reopened.
create function pg_temp.what_path() returns text
  language sql stable as $$ select current_setting('search_path') $$;

create function pg_temp.definer_calls_invoker() returns text
  language sql security definer set search_path = pg_catalog, pg_temp
  as $$ select pg_temp.what_path() $$;

select isnt(
  pg_temp.what_path(), 'pg_catalog, pg_temp',
  'the invoker function sees the session path when called directly'
);
select is(
  pg_temp.definer_calls_invoker(), 'pg_catalog, pg_temp',
  'and the definer''s pinned path when reached through one'
);

rollback;
