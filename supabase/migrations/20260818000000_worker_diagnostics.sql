-- Make the worker scheduling self-diagnosing.
--
-- The first cut of invoke_edge_worker wrapped its Vault lookup in a blanket
-- `exception when others then return`, so "Vault not populated yet", "secret
-- named wrong" and "definer cannot read vault" were indistinguishable from
-- each other and from a healthy no-op. That flexibility about deploy order was
-- not worth being unable to tell what went wrong.

-- Records why an invocation did not post. Bounded: one row per worker, upserted.
create table if not exists public.worker_invoke_log (
  worker text primary key,
  last_attempt_at timestamptz not null default now(),
  last_outcome text not null,
  last_detail text
);

revoke all on public.worker_invoke_log from public, anon, authenticated;

create or replace function public.invoke_edge_worker(p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_url text;
  v_key text;
  v_outcome text;
  v_detail text;
begin
  if p_name not in ('moderation-worker', 'push-worker') then
    raise exception 'unknown worker %', p_name using errcode = 'check_violation';
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  exception
    when others then
      -- Still non-fatal (a broken lookup must not wedge cron), but no longer silent.
      insert into public.worker_invoke_log (worker, last_attempt_at, last_outcome, last_detail)
      values (p_name, now(), 'vault_unreadable', sqlstate || ': ' || sqlerrm)
      on conflict (worker) do update
        set last_attempt_at = excluded.last_attempt_at,
            last_outcome = excluded.last_outcome,
            last_detail = excluded.last_detail;
      return;
  end;

  if v_url is null or v_key is null then
    v_detail := concat_ws(', ',
      case when v_url is null then 'project_url missing' end,
      case when v_key is null then 'service_role_key missing' end);
    insert into public.worker_invoke_log (worker, last_attempt_at, last_outcome, last_detail)
    values (p_name, now(), 'vault_incomplete', v_detail)
    on conflict (worker) do update
      set last_attempt_at = excluded.last_attempt_at,
          last_outcome = excluded.last_outcome,
          last_detail = excluded.last_detail;
    return;
  end if;

  begin
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    v_outcome := 'posted';
    v_detail := null;
  exception
    when others then
      v_outcome := 'post_failed';
      v_detail := sqlstate || ': ' || sqlerrm;
  end;

  insert into public.worker_invoke_log (worker, last_attempt_at, last_outcome, last_detail)
  values (p_name, now(), v_outcome, v_detail)
  on conflict (worker) do update
    set last_attempt_at = excluded.last_attempt_at,
        last_outcome = excluded.last_outcome,
        last_detail = excluded.last_detail;
end
$$;

revoke all on function public.invoke_edge_worker(text) from public, anon, authenticated;

-- One query that answers "why aren't the workers running". Reports lengths and
-- states, never secret values, so its output is safe to paste into a chat.
create or replace function public.worker_status()
returns table (check_name text, result text)
language plpgsql
security definer
set search_path = public, extensions, net, vault, cron
as $$
begin
  begin
    return query
      select 'vault: ' || s.name,
             'present, length ' || length(s.decrypted_secret)::text
      from vault.decrypted_secrets s
      where s.name in ('project_url', 'service_role_key');
  exception when others then
    return query select 'vault'::text, 'UNREADABLE — ' || sqlstate || ': ' || sqlerrm;
  end;

  begin
    return query
      select 'cron job: ' || j.jobname, 'active=' || j.active::text || ' schedule=' || j.schedule
      from cron.job j
      where j.jobname in ('moderation-worker', 'push-worker');
  exception when others then
    return query select 'cron'::text, 'UNREADABLE — ' || sqlerrm;
  end;

  begin
    return query
      select 'last invoke: ' || l.worker,
             l.last_outcome || coalesce(' — ' || l.last_detail, '')
               || ' @ ' || to_char(l.last_attempt_at, 'HH24:MI:SS')
      from public.worker_invoke_log l;
  exception when others then
    return query select 'invoke log'::text, 'UNREADABLE — ' || sqlerrm;
  end;

  begin
    return query
      select 'last http response',
             r.status_code::text || coalesce(' — ' || r.error_msg, '')
               || ' @ ' || to_char(r.created, 'HH24:MI:SS')
      from net._http_response r
      order by r.created desc
      limit 3;
  exception when others then
    return query select 'http response'::text, 'UNREADABLE — ' || sqlerrm;
  end;
end
$$;

revoke all on function public.worker_status() from public, anon, authenticated;
