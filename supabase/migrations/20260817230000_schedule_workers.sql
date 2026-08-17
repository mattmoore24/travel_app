-- Schedule the two Edge Function workers from inside the database.
--
-- Why here and not the dashboard: a schedule created by clicking is invisible
-- to the repo, survives nowhere, and cannot be rebuilt from a fresh clone. This
-- migration makes the schedule part of the deployable state like everything
-- else.
--
-- Credentials live in Supabase Vault, never in this file. Populate them once
-- (Dashboard -> SQL Editor), after which the jobs start working on their own:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>',        'service_role_key');
--
-- Until those exist the invoker no-ops quietly rather than erroring every
-- minute, so deploy order does not matter.

-- The workers themselves take no request body and read their own service-role
-- key from the function environment; this only has to get past the platform's
-- JWT check, which is why it sends a real key rather than the anon one.
create or replace function public.invoke_edge_worker(p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_url text;
  v_key text;
begin
  -- Allowlist, not interpolation: this function runs as definer and builds a
  -- URL, so an arbitrary p_name would be a path-traversal primitive.
  if p_name not in ('moderation-worker', 'push-worker') then
    raise exception 'unknown worker %', p_name using errcode = 'check_violation';
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  exception
    when others then
      -- No vault (local/CI) or no rows yet: nothing to do.
      return;
  end;

  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end
$$;

-- Definer + service-role bearer token: nothing but cron may call this.
revoke all on function public.invoke_edge_worker(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    -- Held first messages and photos are invisible to their recipients until a
    -- verdict lands, so this is the delivery latency for anything moderated.
    perform cron.schedule(
      'moderation-worker',
      '* * * * *',
      $cron$select public.invoke_edge_worker('moderation-worker')$cron$
    );
    perform cron.schedule(
      'push-worker',
      '* * * * *',
      $cron$select public.invoke_edge_worker('push-worker')$cron$
    );
  end if;
end
$$;
