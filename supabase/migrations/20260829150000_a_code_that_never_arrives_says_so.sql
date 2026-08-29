-- A code that never arrives says so
-- =============================================================================
--
-- The founder tried to list a business, was told a code had been sent, and
-- never received one. A second address, on a different provider, worked. That
-- is the exact shape of the sandbox rule this project has already been bitten
-- by once: with no verified sending domain, Resend's shared
-- `onboarding@resend.dev` sender may only deliver to the Resend account's own
-- address, and every other recipient is refused at the API. The mailer records
-- the refusal faithfully in `outbound_mail.delivery_error` — and nothing has
-- ever read it, so the screen went on saying "We sent a six-digit code to
-- your@address" about mail that was never going anywhere.
--
-- Two things here. Neither of them is the fix for the underlying config, which
-- is the founder verifying a domain in Resend and setting SUPPORT_FROM; that
-- is written down in docs/ONBOARDING.md §6 and cannot be done from a
-- migration.
--
-- 1. THE APP STOPS CLAIMING A DELIVERY IT CANNOT CONFIRM. A narrow,
--    caller-scoped read of the mail queue, for your own business's own latest
--    code and nothing else. It reports queued / delivered / failed. It never
--    returns the provider's error text: that string names domains and API
--    details, and it is written by a third party.
--
-- 2. THE CODE STOPS WAITING ON THE CLOCK. The mailer runs on a five-minute
--    cron, so a business could sit on the code screen for five minutes before
--    the first send was even attempted. The poke mechanism built for
--    moderation already exists, is already throttled, already swallows its own
--    failures, and `invoke_edge_worker` already allowlists 'support-mailer' —
--    only poke_worker's own mirror of that allowlist was missing it.

-- ---------------------------------------------------------------------------
-- 1. The mailer can be poked, like the other two workers
-- ---------------------------------------------------------------------------
--
-- create or replace: the signature is unchanged and four triggers depend on
-- this function. The only edit is the allowlist.

create or replace function public.poke_worker(p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_claimed boolean := false;
begin
  -- invoke_edge_worker allowlists the name itself; this mirrors it so a bad
  -- name cannot even reach the throttle table. 'support-mailer' was already
  -- on that list and missing from this one, which is the drift a mirrored
  -- constant always eventually has.
  if p_name not in ('moderation-worker', 'push-worker', 'support-mailer') then
    return;
  end if;

  -- Non-blocking by construction. `try` never waits, and losing the race is
  -- the same outcome as losing the throttle: somebody else is poking.
  if not pg_try_advisory_xact_lock(hashtext('worker-poke:' || p_name)) then
    return;
  end if;

  insert into public.worker_pokes as w (worker, last_poked_at)
  values (p_name, now())
  on conflict (worker) do update
    set last_poked_at = now()
    where w.last_poked_at < now() - interval '3 seconds'
  returning true into v_claimed;

  if coalesce(v_claimed, false) then
    perform public.invoke_edge_worker(p_name);
  end if;
exception
  when others then
    -- A poke is an optimisation. The cron backstop is the guarantee, so a
    -- failure here must never take down the insert that triggered it — which
    -- would mean a code that could not be requested at all.
    return;
end
$$;

revoke all on function public.poke_worker(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Asking for a code sends it now, not within five minutes
-- ---------------------------------------------------------------------------
--
-- Body identical to 20260827120000 apart from the last line. Restated whole
-- rather than patched, because a create-or-replace REPLACES: there is no
-- partial edit, and a reader who finds this file needs to see what the
-- function is, not what changed about it.

create or replace function public.request_business_email_confirmation(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_name text;
  v_code text;
  v_sends int;
begin
  select id, name into v_business, v_name
    from public.businesses where owner_user_id = auth.uid();
  if v_business is null then
    raise exception 'this account does not run a business' using errcode = '42501';
  end if;

  select case when sends_day = current_date then sends_today else 0 end
    into v_sends
    from public.business_email_confirmations where business_id = v_business;
  if coalesce(v_sends, 0) >= 5 then
    raise exception 'that is as many codes as we can send today';
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.business_email_confirmations
    (business_id, email, code_hash, expires_at, attempts, sends_today, sends_day)
  values
    (v_business, lower(btrim(p_email)), encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
     now() + interval '20 minutes', 0, 1, current_date)
  on conflict (business_id) do update
    set email = excluded.email,
        code_hash = excluded.code_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        sends_today = case
          when public.business_email_confirmations.sends_day = current_date
          then public.business_email_confirmations.sends_today + 1
          else 1
        end,
        sends_day = current_date,
        confirmed_at = null;

  insert into public.outbound_mail (to_address, subject, text_body, kind)
  values (
    lower(btrim(p_email)),
    'Your Samewhere code',
    concat(
      'Here is the code that puts ', v_name, ' on the map:', E'\n\n',
      '    ', v_code, E'\n\n',
      'Type it into the app in the next twenty minutes. If you did not ask ',
      'for this, you can ignore it and nothing happens.'
    ),
    'business_email_code'
  );

  -- The code has a twenty-minute life and somebody is watching an empty box
  -- for it. Waiting up to five minutes for a cron tick before the first send
  -- attempt spends a quarter of that on nothing.
  perform public.poke_worker('support-mailer');
end
$$;

revoke execute on function public.request_business_email_confirmation(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Whether it actually went
-- ---------------------------------------------------------------------------
--
-- Scoped three ways over: to the caller's own business, to the address
-- currently on file for it, and to the single newest code sent there. A
-- caller cannot ask about anybody else's mail and cannot ask about mail of
-- any other kind.
--
-- `failed` means the mailer tried at least once and the row is still
-- undelivered. That is the state worth a different sentence on the screen:
-- somebody is waiting for a code that a provider has already refused to
-- carry, and the only thing that helps them is a different address.

create function public.my_business_code_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'sent_at', m.created_at,
        'delivered', m.delivered_at is not null,
        'attempts', m.delivery_attempts,
        'failed', m.delivered_at is null and m.delivery_attempts > 0
      )
      from public.outbound_mail m
      join public.business_email_confirmations c on c.email = m.to_address
      join public.businesses b
        on b.id = c.business_id and b.owner_user_id = auth.uid()
      where m.kind = 'business_email_code'
      order by m.created_at desc
      limit 1
    ),
    '{}'::jsonb
  )
$$;

revoke execute on function public.my_business_code_status() from public, anon;
grant execute on function public.my_business_code_status() to authenticated;

comment on function public.my_business_code_status() is
  'Whether the latest confirmation code for the caller''s own business '
  'actually left the building. Never returns the provider''s error text: that '
  'string is written by a third party and names infrastructure.';
