-- A poke must never be able to fail the message that triggered it.
--
-- `poke_worker` claims its throttle slot with `insert ... on conflict do
-- update`, which takes a row lock on `worker_pokes`. Two people posting a
-- photo in the same second therefore SERIALISE on that one row: the second
-- transaction waits for the first to commit. Both are short, so in practice
-- the wait is microseconds — but "in practice" is not the standard for code on
-- the path of sending a message, and the failure mode is bad in a specific
-- way. A wait long enough to hit `statement_timeout` raises `query_canceled`,
-- and plpgsql's `when others` does NOT catch that (nor `assert_failure`), so
-- the exception handler that exists precisely to keep a poke harmless would
-- let it through and the INSERT would fail. Somebody's photo would not send,
-- because somebody else's photo was sending.
--
-- A try-advisory lock removes the wait entirely. It either succeeds
-- immediately or returns false, and false is a perfectly good answer here:
-- another transaction is poking this very worker right now, which is exactly
-- the case the three-second throttle exists to collapse. The row lock is still
-- taken afterwards, but only by a transaction that already holds the advisory
-- lock, so nothing can be queued behind it.
--
-- create-or-replace, not drop: the signature is unchanged (`returns void`),
-- and four triggers depend on the function that calls this one.

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
  -- name cannot even reach the throttle table.
  if p_name not in ('moderation-worker', 'push-worker') then
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
    -- would mean a photo that could not be sent at all.
    return;
end
$$;

revoke all on function public.poke_worker(text) from public, anon, authenticated;
