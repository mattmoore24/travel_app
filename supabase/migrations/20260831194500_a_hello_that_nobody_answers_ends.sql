-- A hello that nobody answers ends
--
-- request_status has declared an 'expired' value since the first matching
-- migration and nothing in the schema has ever written it. So a pending hello
-- sits in the recipient's "Waiting on you" and the sender's "You said hi"
-- for ever: eight a day over a two-week trip leaves twenty-odd dead rows
-- stacked above the conversations that actually matter, in a city everybody
-- involved has left.
--
-- Four things have to be true of the ending, and the third and fourth are the
-- ones that decide the shape of this migration.
--
--   1. It is NOT a withdraw, and nothing here deletes.
--      trips_matching.sql:394 records unique(sender_id, recipient_id) as
--      "one shot per direction, ever (anti-pester)". Freeing the row turns
--      withdraw-and-resend into exactly the pester loop that constraint
--      closes. Expiring keeps the constraint and still clears the inbox.
--
--   2. The recipient's inbox needs no change. incoming_requests() already
--      reads `status = 'pending'`, so an expired row falls out of it.
--
--   3. THE SWEEP MUST TAKE THE DECLINED ROWS WITH IT.
--      This is the whole reason the WHERE clause below says
--      `status in ('pending', 'declined')`. sent_requests() masks a decline
--      as 'sent' precisely so a sender can never tell silence from a no
--      (invariant 4). Expiring only the pending rows would undo that in one
--      move: after a sender's trip ended, the hellos nobody answered would
--      be marked and the DECLINED ones would not. A row that was left alone
--      is a row that was answered. Both arms have to leave together, and
--      they leave on a clock the sender can read off their own trip dates,
--      so nothing about the recipient is in the signal at all.
--
--   4. AN OLD BUNDLE MUST NOT MEET A NEW STATE.
--      An over-the-air update is never applied on the launch that downloads
--      it (`.claude/skills/traps`, "Over-the-air updates"), so for at least
--      one launch every phone runs the PREVIOUS bundle against this schema.
--      A sixth value in sent_requests()'s `state` would land in code that
--      has never heard of it: the shipped already-sent predicate answers
--      "nothing is out to this traveler" for a state it does not know, so
--      the profile and the pin card would offer a second Say hi that the
--      unique constraint refuses at the last step, destroying a written
--      message. Splitting the deploy in two is not the answer either.
--
--      So expiry is ADDITIVE, the way the push payload's `kind` key was:
--      `state` keeps exactly the vocabulary it has, an expired row still
--      reads 'sent', and a NEW nullable `expired_at` column carries the
--      fact for the bundles that know to look for it. Old builds tolerate
--      the extra column and behave as they do today; new builds can say
--      something true about a hello that can no longer be answered
--      (respond_to_message_request only accepts status = 'pending').
--
--      It leaks nothing. expired_at is stamped by the sweep, at the same
--      moment and by the same statement on the unanswered rows and the
--      declined ones, and the clock it runs on is the sender's own trip
--      dates - which the sender already knows.
--
-- 'accepted' is untouched (it is a chat now), and 'blocked_by_moderation' is
-- untouched (it is the sender's own feedback about their own message, and
-- the row they are allowed to replace). 'pending_moderation' is untouched:
-- it is still waiting on a verdict, and expiring it would hide a hello that
-- has not been delivered yet.

-- When the sweep ended it. Null on every other row, so it doubles as the
-- flag. Granted with the rest of the column list because message_requests
-- is column-granted and a star select needs every column (traps: "add
-- column on a table with column-level grants revokes select *") - it hands
-- a reader nothing, since message_requests_select_recipient only ever
-- exposes 'pending' and 'accepted' rows, where this is always null.
alter table public.message_requests add column if not exists expired_at timestamptz;
grant select (expired_at) on public.message_requests to authenticated;

create or replace function public.expire_message_requests()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.message_requests m
     set status = 'expired', expired_at = now()
   where m.status in ('pending', 'declined')
     -- WHICH trips. `max(t.end_date)` over every active trip the sender has
     -- was the wrong clock: one December trip postponed every September
     -- hello until January, and a sender whose only trip had already ended
     -- when they said hi from a pin expired on the day they sent it.
     --
     -- So: only the trips this hello could have been about. Still running
     -- when it was sent, and starting inside the horizon matching itself
     -- works to. That horizon is `current_date + 180` in get_matches
     -- (20260823030000_profile_visibility.sql:188) and in
     -- send_message_request's own trip_match gate
     -- (20260831140000_a_failure_says_what_to_do.sql:428), so it is +180
     -- here rather than a second number that could drift away from them.
     --
     -- The horizon alone does not finish the job, and the second term is
     -- why. At 180 days a December trip is genuinely offered in September,
     -- so a trip clause on its own would hold a September hello open until
     -- December, and adding a January trip in the meantime would hold it
     -- into January: an ending that keeps moving is not an ending, which is
     -- this package's whole subject.
     --
     -- So the trip window and a flat thirty days from the send, whichever
     -- comes FIRST. A hello nobody answered in a month is over whatever the
     -- calendar says, and the cap is the same thirty days a sender with no
     -- live trip at all gets, so there is one number here rather than two
     -- that could drift apart. LEAST ignores nulls, so the no-trip case
     -- lands on the cap without a coalesce.
     --
     -- Both terms are the SENDER's own dates and a constant. Nothing about
     -- the recipient reaches this clause, which is what keeps expired_at
     -- safe to show the sender: narrowing to "the trip that overlapped
     -- them" would leak the recipient's dates back through the expiry.
     and least(
           (select max(t.end_date) from public.trips t
             where t.user_id = m.sender_id
               and t.status = 'active'
               and t.end_date >= (m.created_at at time zone 'UTC')::date
               and t.start_date <= (m.created_at at time zone 'UTC')::date + 180),
           (m.created_at at time zone 'UTC')::date + 30
         ) < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.expire_message_requests()
  from public, anon, authenticated;

-- The sender's view gains the fact, and NOT a new state.
--
-- `state` is untouched on purpose (reason 4 above): an expired row keeps
-- falling through the else arm and reads 'sent', which is what every shipped
-- bundle expects and what keeps "You said hi" and the already-sent guard
-- correct on a phone running yesterday's JavaScript. The new column is
-- additive and nullable, so a bundle that has never heard of it simply does
-- not read it.
--
-- Adding an OUT column to a `RETURNS TABLE` function needs `drop function`
-- first - `create or replace` is refused, and refused AFTER the earlier
-- statements of this migration have applied (AGENTS.md, and traps). The drop
-- takes the grants with it, so both lines are restated below exactly as
-- 20260816200000_trips_matching.sql:728-734 had them. Body otherwise verbatim
-- from 20260816200000_trips_matching.sql:618-650.
drop function if exists public.sent_requests();

create function public.sent_requests()
returns table (
  id uuid,
  recipient_id uuid,
  source public.request_source,
  profile_element text,
  first_message text,
  state text,
  chat_id uuid,
  created_at timestamptz,
  expired_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    recipient_id,
    source,
    profile_element,
    first_message,
    case status
      when 'accepted' then 'accepted'
      when 'blocked_by_moderation' then 'blocked'
      else 'sent'
    end,
    case when status = 'accepted' then chat_id else null end,
    created_at,
    expired_at
  from public.message_requests
  where sender_id = auth.uid()
  order by created_at desc
$$;

revoke execute on function public.sent_requests() from public, anon;
grant execute on function public.sent_requests() to authenticated;

-- Nightly, under the same guard every other sweep here uses: the local test
-- cluster has no pg_cron, and a migration that assumes one fails the suite
-- rather than the deploy. 3:40, between the spotlight expiry and the hour
-- everything else runs.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-message-requests', '40 3 * * *',
                          'select public.expire_message_requests()');
  end if;
end
$$;
