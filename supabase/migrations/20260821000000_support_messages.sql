-- An in-app way to reach support, so the app stops publishing a personal
-- email address.
--
-- The row is the durable record and the email is only the notification: if
-- Resend is down, or nobody has set a key yet, the message is still here and
-- still readable from the dashboard. That ordering matters — a contact form
-- that silently loses a report is worse than no contact form.
--
-- Guests can write. Somebody who cannot sign in is exactly the person most
-- likely to need support, so gating this behind auth would lock out the case
-- it exists for. That means an unauthenticated write path, which needs
-- limits: three an hour per address, and a global ceiling so one determined
-- person cannot fill the table.

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  -- Null for a guest. `set null` rather than cascade: deleting an account
  -- must not delete the complaint that account filed.
  user_id uuid references public.users (id) on delete set null,
  reply_to text not null
    check (
      char_length(reply_to) between 5 and 254
      and reply_to ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  body text not null check (char_length(btrim(body)) between 10 and 4000),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivery_attempts int not null default 0,
  delivery_error text
);

comment on table public.support_messages is
  'Messages from the in-app contact form. The row is the record; the email '
  'is the notification. Never readable by anon or authenticated.';

-- The mailer scans for undelivered rows oldest first.
create index support_messages_undelivered_idx
  on public.support_messages (created_at)
  where delivered_at is null;

create index support_messages_reply_to_idx on public.support_messages (lower(reply_to), created_at);

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

create function public.enforce_support_message_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
  v_total int;
begin
  -- Serialised per address, the same shape as the photo and trip limits, so
  -- two simultaneous submissions cannot both see a stale count.
  perform pg_advisory_xact_lock(hashtext('support:' || lower(new.reply_to)));

  select count(*) into v_recent
    from public.support_messages
   where lower(reply_to) = lower(new.reply_to)
     and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    raise exception 'You have sent a few messages already. We will come back to you shortly.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_total
    from public.support_messages
   where created_at > now() - interval '1 hour';
  if v_total >= 200 then
    raise exception 'Support is busy right now. Please try again in a little while.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger support_messages_limit
  before insert on public.support_messages
  for each row execute function public.enforce_support_message_limit();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.support_messages enable row level security;

-- Write only, and only ever as yourself. There is deliberately no select
-- policy: nobody but the service role reads this table, which is what keeps
-- one person's report from being enumerable by anyone else.
create policy support_messages_insert
  on public.support_messages for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

revoke all on public.support_messages from public, anon, authenticated;
grant insert (user_id, reply_to, body) on public.support_messages to anon, authenticated;

revoke all on function public.enforce_support_message_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling the mailer
-- ---------------------------------------------------------------------------

-- Same allowlist shape as before: the worker name is checked against a fixed
-- set rather than interpolated, because this function carries a service-role
-- bearer token and an interpolated name would be a path-traversal primitive
-- pointed at the project's own function host.
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
  if p_name not in ('moderation-worker', 'push-worker', 'support-mailer') then
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

-- Every five minutes. Support is not a real-time channel and a person
-- writing in expects an answer in hours, not seconds. cron.schedule upserts
-- by job name, so re-running this migration re-points the job rather than
-- adding a second one.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    perform cron.schedule(
      'support-mailer',
      '*/5 * * * *',
      $cron$select public.invoke_edge_worker('support-mailer')$cron$
    );
  end if;
end
$$;
