-- A support message must not be abandoned because a key was wrong for
-- twenty-five minutes.
--
-- The mailer gave up after 5 attempts and runs every five minutes, so a row
-- reached its ceiling and was permanently abandoned inside half an hour. That
-- is exactly what happened on 2026-08-21: a wrong Resend key burned the first
-- attempts, a sandbox sender rule refused the rest, and both messages were
-- dead before anybody had read the error. The rows survive in this table --
-- that part of the design held -- but nothing was ever going to try again,
-- and nobody is watching the table.
--
-- Twenty-five minutes is not enough time for a human to notice a
-- misconfiguration, let alone fix it. Retries are spaced now, so the same
-- handful of attempts covers days instead of minutes.
--
-- This matters more than it looks. The contact form is the app's only route
-- to a person, it is open to somebody who cannot even sign in, and a safety
-- report can arrive through it. Losing one to a config error nobody saw is
-- not an acceptable failure mode.

alter table public.support_messages
  add column if not exists next_attempt_at timestamptz not null default now();

comment on column public.support_messages.next_attempt_at is
  'Earliest the mailer may try this row again. The worker pushes it further '
  'out after each failure, so a misconfiguration costs one attempt an hour '
  'rather than five in twenty-five minutes.';

-- The scan is now "what is due", not "what is oldest".
drop index if exists support_messages_undelivered_idx;
create index support_messages_undelivered_idx
  on public.support_messages (next_attempt_at)
  where delivered_at is null;

-- One-time repair. Everything still undelivered goes back in the queue: those
-- rows failed on configuration, not on content, and the old ceiling denied
-- them a retry they should have had.
update public.support_messages
   set delivery_attempts = 0,
       delivery_error = null,
       next_attempt_at = now()
 where delivered_at is null;
