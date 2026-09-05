-- What became of what YOU sent, and nothing at all about anybody else.
--
-- A traveler who reports somebody hears a thank-you and then silence, so they
-- conclude the app does not moderate and say so in a review. The record they
-- want already exists on both sides: public.reports holds their own report and
-- public.support_messages holds their own message. Neither is readable.
-- `reports` grants the reporter select on every column EXCEPT status
-- (20260816220000_chat_realtime.sql:127, 'review status is admin-only') and
-- `support_messages` has no select policy at all
-- (20260821000000_support_messages.sql:33, it holds other people's
-- complaints). So both answers have to be functions, and neither can be a
-- policy.
--
-- A REPORT ABOUT A BUSINESS IS A REPORT. `public.reports` is only half the
-- record: report_business writes to `public.business_reports`
-- (20260827120000:520), which is `revoke all ... from anon, authenticated`
-- with RLS on and no policy at all, and two of its seven reasons are safety
-- reports about how the people at a venue behaved (20260902110000). So
-- somebody who reported a bar because the doorman followed them out would
-- have opened this screen and read "Nothing sent yet" - a denial that the
-- report exists, on the page built to end exactly that silence. Both tables
-- are unioned below, under the same binary mapping.
--
-- THE LINE THIS FILE IS WRITTEN AROUND, and the reason it is two states and
-- not three. `reports.status` is 'open' or 'resolved:<action>', where the
-- action is one of dismiss, warn, strike, suspend, ban, shadowban. The audit
-- asked for a coarse three-value state: received, reviewed, action taken.
-- A third state IS a moderation outcome about another person - 'we banned
-- them', said in two words - and it is reachable by anybody willing to file a
-- report to find out, which makes the report queue a scoreboard and the
-- reporter a spectator at somebody else's punishment. So the mapping is
-- binary. A dismissed report and a ban come back BYTE IDENTICAL here, and
-- supabase/tests/database/62_what_became_of_what_you_sent.test.sql asserts
-- exactly that rather than assuming it.
--
-- Both functions only READ. Neither writes to any row, ever - and that is a
-- deliberate note rather than an accident of scope. The last piece of
-- bookkeeping this project added wrote a date to an ungranted column, tripped
-- the updated_at trigger on the row it touched, and published a to-the-second
-- presence signal for every traveler (20260902220000). There is no shared row
-- in here to touch and no trigger to fire.

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- `reason` comes back as TEXT rather than as public.report_reason, and that
-- is the union's doing: a report about a person carries a report_reason and a
-- report about a business carries a business_report_reason, two enums with no
-- value in common. Text is the only type that can hold both, the two label
-- sets are disjoint so nothing is ambiguous once it lands, and the client
-- reads it through the same lists the two report FORMS offer, so the words a
-- reporter gets back are the words they were shown when they filed it.
create function public.my_report_status()
returns table (
  id uuid,
  created_at timestamptz,
  reason text,
  state text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.created_at,
         r.reason::text,
         case when r.status = 'open' then 'received' else 'reviewed' end
  from public.reports r
  where r.reporter_id = auth.uid()
  union all
  -- The same two facts out of the other table, mapped the same way and for
  -- the same reason. `business_reports.resolution` is one of dismiss, flag,
  -- relist, remove and unverify, and every one of those collapses to
  -- 'reviewed' here: a reporter who could tell a dismissal from a removal
  -- would be reading a moderation verdict about somebody else's listing off
  -- their own receipt, which is the rule this whole file is written around.
  --
  -- `reporter_user_id` is nullable (it is set null when an account is
  -- deleted, so a report outlives the reporter). The explicit null test is
  -- belt as well as braces: nothing with a null author may ever match a
  -- caller, whatever auth.uid() happens to be.
  select b.id,
         b.created_at,
         b.reason::text,
         case when b.resolved_at is null then 'received' else 'reviewed' end
  from public.business_reports b
  where b.reporter_user_id is not null
    and b.reporter_user_id = auth.uid()
  -- Names the OUTPUT column, which is what a set operation orders by. One
  -- list, newest first, whether the row is about a person or a business.
  order by created_at desc
$$;

comment on function public.my_report_status() is
  'What became of the caller''s OWN reports, about people and about '
  'businesses alike: when they filed it, what they said it was about, and '
  'whether a person has read it yet. Nothing about the account or the '
  'listing reported, and nothing that separates a dismissal from a ban or a '
  'removal - every resolved report reads "reviewed". Never returns another '
  'reporter''s rows, and never the raw status or resolution string.';

-- Every column of both tables is a fact about somebody else's account or
-- listing except the four above, so the answer is only ever handed to a
-- signed-in caller asking about their own rows. `create function` grants
-- execute to public by default; this takes it back first.
revoke execute on function public.my_report_status() from public, anon;
grant execute on function public.my_report_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Messages to support
-- ---------------------------------------------------------------------------
--
-- support_message_status(p_id) has been in the schema since
-- 20260821150000_support_delivery.sql and answers for ONE message the caller
-- can already name. Nothing keeps those ids, so nothing could ever call it:
-- submit_support_message returns an id that the client throws away. This asks
-- the question the other way round - which messages are mine - so the answer
-- needs no bookkeeping on the phone and survives a reinstall.
--
-- Same owner test as its older sibling, `user_id is not null and
-- user_id = auth.uid()`. The null half is BELT AND BRACES and nothing more,
-- and that is said plainly because the first draft of this comment claimed it
-- was load-bearing. It is not. A guest's message IS written with a null
-- author, but two separate things already keep it out of every answer, and
-- neither of them is this clause:
--
--   * execute is revoked from anon below, so a caller with no account cannot
--     ask the question at all; and
--   * `s.user_id = auth.uid()` with both sides null evaluates to NULL, not
--     TRUE, so a null-author row matches nobody - including a caller whose
--     own uid is null, which is the case the claim was about.
--
-- Deleting the clause changes no row of any answer (checked: the whole pgTAP
-- suite passes without it), which is exactly why it stays rather than why it
-- goes. It is here so that a later rewrite of the owner test - `is not
-- distinct from`, a coalesce, an outer join - cannot quietly turn "no match"
-- into "matches everybody's". 62_what_became_of_what_you_sent.test.sql
-- asserts the behaviour the two real guards produce, on the hardest caller
-- there is for them: one holding the authenticated role with no sub in its
-- token.

create function public.my_support_messages()
returns table (
  id uuid,
  created_at timestamptz,
  category text,
  delivered boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id,
         s.created_at,
         s.category,
         s.delivered_at is not null
  from public.support_messages s
  where s.user_id is not null
    and s.user_id = auth.uid()
  order by s.created_at desc
$$;

comment on function public.my_support_messages() is
  'The caller''s own messages to support: when they wrote, which kind they '
  'said it was, and whether it has reached us yet. Never the body, never the '
  'address, never anybody else''s row, and nothing at all for a guest, whose '
  'message has no owner to match.';

revoke execute on function public.my_support_messages() from public, anon;
grant execute on function public.my_support_messages() to authenticated;
