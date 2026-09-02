-- A PUSH THAT FAILED SAYS SO
--
-- push-worker (supabase/functions/push-worker/index.ts) reads one thing off
-- an Expo push ticket: whether it says DeviceNotRegistered, in which case the
-- token is pruned. Every other ticket error - InvalidCredentials when no APNs
-- key is on EAS, MessageTooBig, MessageRateExceeded, a request-level error
-- with no tickets at all - was dropped on the floor and the row stamped
-- sent_at as if it had gone. So the exact wall the founder is about to walk
-- into with the 0.2.0 build (docs/APP_STORE.md, "The APNs entitlement"): a
-- perfect entitlement, no APNs key, registration succeeds, nothing arrives,
-- every check green, the queue empty, and nowhere in the database a record
-- that a single push was ever refused.
--
-- Two NULLABLE columns, never a new state value: the queue's one state is
-- still `sent_at`, and its meaning is unchanged - the worker is finished with
-- this row. What changes is that the worker only becomes finished with a row
-- when Expo accepted every notification it produced, or when the recipient
-- has no token to send to, or when it has tried MAX_ATTEMPTS times and gives
-- up. The two columns are the record of the road in between.
--
--   attempts    how many ticks have tried this row and been refused by a
--               ticket error other than DeviceNotRegistered. NULL is zero.
--               Bumped by the worker on every refusal; read by the worker to
--               decide when to give up.
--   last_error  the name of the ticket error the most recent refusal carried
--               ('InvalidCredentials', 'MessageTooBig', ...), or the request
--               level error when Expo answered with no tickets. NULL once the
--               row goes out. Left in place beside `sent_at` when the worker
--               gives up, which is how "sent_at is set and last_error is not"
--               reads as "given up after N attempts", and how the founder
--               can answer "did anything actually go?" with one query:
--
--                 select last_error, count(*) from public.push_queue
--                  where last_error is not null group by 1;
--
-- Neither column is in any client grant. push_queue has been revoked from
-- anon and authenticated since it was created (20260816220000:208) at the
-- table level, so a new column inherits nothing; 70_a_push_that_failed_says_so
-- asserts the refusal rather than assuming it.
--
-- No trigger fires on this table. `grep -n "on public.push_queue"
-- supabase/migrations` finds the revoke and nothing else, so the worker's
-- bookkeeping update reaches no BEFORE UPDATE function that would have to be
-- scoped (the profiles lesson, 20260903020000 and 20260903030000). Stated so
-- it is not re-asked.
--
-- `admin_ops_health.unsent_pushes` (20260903070000) counts `sent_at is null`
-- and is unchanged: a row the worker is retrying now shows there for as long
-- as it is being retried, which is the first time the smoke test has been
-- able to see a push that is not going.

alter table public.push_queue
  add column attempts integer,
  add column last_error text;

comment on column public.push_queue.attempts is
  'Ticks that tried this row and were refused by an Expo ticket error other than DeviceNotRegistered. NULL is zero. push-worker gives up at MAX_ATTEMPTS.';
comment on column public.push_queue.last_error is
  'The Expo ticket (or request) error name from the most recent refusal. NULL once the row goes out; left beside sent_at when the worker gives up.';
