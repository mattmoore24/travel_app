-- A hello can be taken back, and the liquidity number can be counted
-- ---------------------------------------------------------------------------
--
-- TWO PACKAGES IN ONE FILE, and that is a deliberate cost rather than an
-- oversight: this batch was handed exactly one migration slot, and splitting
-- them would have meant a filename nobody allocated. They are unrelated and
-- sit under two headed sections below. Anyone tidying the tree later should
-- split them at the second heading; a migration is atomic, so combining them
-- costs nothing at deploy time and only costs a reader's grep.
--
--   PART ONE   chat-sent-hello-age-and-withdraw (the database half)
--   PART TWO   admin-liquidity-reach-and-history
--
--
-- =========================================================================
-- PART ONE. A hello you sent can be taken back.
-- =========================================================================
--
-- Inside a chat you can already unsend a message, so the app has decided
-- taking words back is legitimate. The one message you cannot take back is
-- the FIRST one - the hello sitting under "You said hi" with your words on
-- it, which stays there whether the other person declined it, never opened
-- it, or was stopped by moderation, because the row deliberately says none of
-- those things (invariants 4 and 5).
--
-- THE DANGEROUS VERSION OF THIS FEATURE IS THE OBVIOUS ONE: delete the row.
-- message_requests carries `unique (sender_id, recipient_id)` - one shot per
-- direction, ever, the anti-pester constraint (20260816200000:394). Deleting
-- frees that slot, so "take it back" becomes "say hi again", and again, and
-- again, at the same person who did not answer. It would also destroy the
-- moderation_verdict history of a message that was already delivered. So the
-- row STAYS and gains a stamp.
--
-- A timestamptz column rather than a sixth `request_status` value, for two
-- reasons. `alter type ... add value` and the single transaction Supabase
-- runs a migration in do not mix. And a new STATE would reach the client as a
-- new word in `sent_requests.state`, which the previous bundle has never
-- heard of - an over-the-air update is never applied on the launch that
-- downloads it, so for at least one launch every phone runs the old code
-- against this schema. An unknown state drops the sender's own hello out of
-- "You said hi" AND makes `saidHiAlready` answer "nothing is out to this
-- traveler", which offers a second Say hi the unique constraint refuses. So
-- `state` keeps its three words and the new fact arrives as an extra nullable
-- column, exactly the way `expired_at` did in 20260831194500.
--
-- INVARIANT 4 IN BOTH DIRECTIONS, which is the part worth reading twice.
--
--   * Sender to recipient: withdrawing tells the recipient nothing. The row
--     leaves incoming_requests() and leaves their RLS view of the table, the
--     same way an unsent message leaves a thread. No tombstone, no push, no
--     "somebody took back a hello" - and the hello's OWN push is pulled from
--     the queue if it has not gone out yet, because a notification that
--     arrives thirty seconds after a withdrawal sends somebody to an inbox
--     with nothing in it. A push already delivered cannot be un-rung, and
--     nothing here rings a new one.
--
--   * Recipient to sender: withdrawing must not become an oracle for what the
--     recipient did. sent_requests() collapses pending, declined and expired
--     into one flat 'sent', so a withdraw that SUCCEEDED on a pending row and
--     FAILED on a declined one would hand the sender the exact fact the whole
--     design refuses to tell them. That is why the update below accepts every
--     state the sender reads as 'sent' - pending, pending_moderation,
--     declined and expired - and not just 'pending' as the package spec
--     asked. Same call, same answer, whatever the other person did.
--
--     The two states it refuses are the two the sender can already see for
--     themselves: 'accepted' (there is a chat, and it is in their chat list)
--     and 'blocked_by_moderation' (the row reads 'blocked' and offers a
--     rewrite). Refusing those leaks nothing that is not already on screen.
--
--   * And it does not leak a READ. Nothing in this schema records whether a
--     first message was opened, so there is nothing here for a withdrawal to
--     expose.

alter table public.message_requests add column if not exists withdrawn_at timestamptz;

-- Granted for the same reason expired_at is (20260831194500:70): the column
-- list on this table is column-level, so a column left ungranted is a trap
-- for the next reader who writes `select *`. It exposes nothing - the sender
-- has no direct select on this table at all, and the recipient's policy below
-- stops serving a withdrawn row entirely.
grant select (withdrawn_at) on public.message_requests to authenticated;

comment on column public.message_requests.withdrawn_at is
  'When the SENDER took this hello back. The row is kept rather than deleted: '
  'deleting frees the unique (sender_id, recipient_id) slot and turns one '
  'shot per direction into unlimited re-sends at the same person.';

-- The recipient's own read of the table stops at a withdrawn row.
--
-- incoming_requests() is the inbox and is fixed below, but the POLICY is the
-- enforcement layer and the RPC is only the UX: a client with a direct
-- PostgREST select would otherwise still see a hello that had been taken
-- back. Restated verbatim from 20260816200000:405 with the one added clause.
drop policy message_requests_select_recipient on public.message_requests;
create policy message_requests_select_recipient
  on public.message_requests for select to authenticated
  using (
    recipient_id = auth.uid()
    and status in ('pending', 'accepted')
    and withdrawn_at is null
  );

-- Take back a hello you sent.
--
-- Returns rather than raises on every refusal, and that is the invariant-4
-- point again in the shape of an error code: a raise would have to say WHY,
-- and the honest reasons ('they already answered', 'that row is not yours')
-- are exactly the facts this function may not hand out. `withdrawn` false is
-- the same answer for a row that is not the caller's, a row already
-- withdrawn, and a row already accepted. The client refetches sent_requests()
-- and reads the truth from there.
--
-- No assert_good_standing(). Every other write path here gates on account
-- standing; taking your own words back is the one act there is never a reason
-- to refuse a suspended account, and refusing it would leave a hello standing
-- in somebody's inbox from an account we have already stopped trusting.
create function public.withdraw_message_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_hit int;
begin
  if v_sender is null then
    raise exception 'not authenticated' using errcode = '42501', hint = 'not_authenticated';
  end if;

  -- One statement, so the row lock is taken by the update itself. A
  -- respond_to_message_request racing this takes the same lock and
  -- re-evaluates its own `withdrawn_at is null` clause after acquiring it, so
  -- whichever commits first wins and the loser finds nothing.
  update public.message_requests
     set withdrawn_at = now()
   where id = p_request_id
     and sender_id = v_sender
     and withdrawn_at is null
     -- Every state the sender reads as a flat 'sent'. Listed rather than
     -- written as `not in ('accepted', 'blocked_by_moderation')` so that a
     -- state added later has to be considered here on purpose.
     and status in ('pending', 'pending_moderation', 'declined', 'expired');
  get diagnostics v_hit = row_count;

  -- The notification this hello queued, if the worker has not sent it yet.
  -- Targeted by request_id and not by recipient: two travelers can have said
  -- hi to the same person in the same minute, and pulling "their unsent
  -- request pushes" would silence somebody else's hello. That is why
  -- enqueue_request_push carries the id at all.
  if v_hit > 0 then
    delete from public.push_queue
     where sent_at is null
       and data ->> 'type' = 'request'
       and data ->> 'request_id' = p_request_id::text;
  end if;

  return jsonb_build_object('withdrawn', v_hit > 0);
end
$$;

revoke execute on function public.withdraw_message_request(uuid) from public, anon;
grant execute on function public.withdraw_message_request(uuid) to authenticated;

comment on function public.withdraw_message_request(uuid) is
  'The sender takes their own first message back. Stamps withdrawn_at rather '
  'than deleting, so the anti-pester unique (sender_id, recipient_id) still '
  'refuses a second hello to the same traveler. Answers the same for a '
  'pending, declined and expired row (invariant 4).';

-- The push a withdrawn hello must not ring, and the one it must be able to
-- take back.
--
-- Restated from its current definition, 20260820001000:87, with two changes.
--
-- The guard is the first. A hello sent with require_llm_moderation on lands
-- as 'pending_moderation'; the worker comes back minutes later and flips it
-- to 'pending', and THAT is what fires this trigger. Withdraw it during those
-- minutes and, without the guard, the classifier's approval would push
-- "Someone said hi" for a message that had already been taken back - the one
-- thing this feature promises cannot happen. The INSERT branch cannot be
-- withdrawn yet, and is guarded anyway so the two arms cannot drift.
--
-- `request_id` in the payload is the second, and it is what makes the
-- withdraw above able to pull an unsent push without silencing somebody
-- else's. The client reads `type` and nothing else, and every consumer
-- already tolerates keys it has never heard of (old builds sent payloads with
-- none of these), so an extra key routes exactly as it did before.
create or replace function public.enqueue_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.withdrawn_at is null
     and ((tg_op = 'INSERT' and new.status = 'pending')
          or (tg_op = 'UPDATE' and old.status = 'pending_moderation'
              and new.status = 'pending')) then
    select display_name into v_name from public.profiles where user_id = new.sender_id;
    insert into public.push_queue (user_id, title, body, data)
    values (new.recipient_id, 'Someone said hi',
            coalesce(v_name, 'A traveler') || ' wants to say hi',
            jsonb_build_object('type', 'request', 'request_id', new.id));
  end if;
  return new;
end
$$;

-- A withdrawn hello cannot be accepted, and refusing it says nothing new.
--
-- Restated from its current definition, 20260817090000:532, with one added
-- clause in the lookup. Without it, a recipient holding a list fetched before
-- the withdrawal could still accept: a chat would open, social handles would
-- unlock (hard rule 4 runs off exactly this row), and the sender would find
-- themselves in a conversation they had ended. The refusal reuses the
-- existing 'request not found', which is already what an answered, expired or
-- deleted row raises, so it tells the recipient nothing it did not tell them
-- before.
create or replace function public.respond_to_message_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.message_requests%rowtype;
  v_chat uuid;
begin
  perform public.assert_good_standing();
  select * into v_req
  from public.message_requests
  where id = p_request_id and recipient_id = auth.uid() and status = 'pending'
    and withdrawn_at is null
  for update;
  if not found then
    raise exception 'request not found';
  end if;

  if p_accept then
    -- Re-validate at accept time: a block created (or an account banned)
    -- after the request was sent must prevent the chat — and therefore the
    -- social-handle unlock — from ever forming.
    if public.is_blocked_pair(v_req.sender_id)
       or not public.is_discoverable_owner(v_req.sender_id) then
      raise exception 'request unavailable';
    end if;

    -- If a chat between the pair already exists (the reverse-direction
    -- request was accepted first), attach to it instead of creating a
    -- duplicate conversation.
    select c.id into v_chat
    from public.chats c
    join public.chat_participants a on a.chat_id = c.id and a.user_id = v_req.sender_id
    join public.chat_participants b on b.chat_id = c.id and b.user_id = v_req.recipient_id
    where c.status = 'active'
    limit 1;

    if v_chat is null then
      insert into public.chats default values returning id into v_chat;
      insert into public.chat_participants (chat_id, user_id)
      values (v_chat, v_req.sender_id), (v_chat, v_req.recipient_id);
    end if;

    update public.message_requests
      set status = 'accepted', chat_id = v_chat, responded_at = now()
      where id = p_request_id;
    return jsonb_build_object('accepted', true, 'chat_id', v_chat);
  end if;

  update public.message_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id;
  return jsonb_build_object('accepted', false);
end
$$;

-- The recipient's inbox stops serving it.
--
-- Restated from its current definition, 20260831193000:31, with one added
-- clause in the WHERE. No OUT column changes, so `create or replace` is legal
-- here and the grants survive - which is why this one is not a drop, and
-- sent_requests() below is.
create or replace function public.incoming_requests()
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  age int,
  verified boolean,
  profile_element text,
  first_message text,
  photo_path text,
  created_at timestamptz,
  overlap_city text,
  overlap_start date,
  overlap_end date
)
language sql
stable
as $$
  select
    r.id,
    r.sender_id,
    p.display_name,
    p.age,
    p.verified,
    r.profile_element,
    r.first_message,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = r.sender_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    r.created_at,
    o.city_label,
    o.starts_on,
    o.ends_on
  from public.message_requests r
  join public.profiles p on p.user_id = r.sender_id
  -- The earliest window the two of you actually share. `left join lateral`
  -- so a hello with no readable overlap still renders the card; the columns
  -- come back null and the chip is simply absent.
  left join lateral (
    select
      c.name as city_label,
      greatest(mine.start_date, theirs.start_date) as starts_on,
      least(mine.end_date, theirs.end_date) as ends_on
    from public.trips mine
    join public.trips theirs
      on theirs.city_id = mine.city_id
     and theirs.user_id = r.sender_id
     and theirs.start_date <= mine.end_date
     and mine.start_date <= theirs.end_date
     and theirs.status = 'active'
     and theirs.end_date >= current_date - 1
    join public.cities c on c.id = theirs.city_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.end_date >= current_date - 1
    order by greatest(mine.start_date, theirs.start_date)
    limit 1
  ) o on true
  where r.recipient_id = auth.uid() and r.status = 'pending'
    and r.withdrawn_at is null
  order by r.created_at desc
$$;

-- The sender's view gains the fact, and NOT a new state.
--
-- Adding an OUT column to a `RETURNS TABLE` function needs `drop function`
-- first: `create or replace` is refused, and refused AFTER the statements
-- above have already applied (AGENTS.md, and the traps skill). The drop takes
-- the grants with it, so both lines are restated below. Body otherwise
-- verbatim from its current definition, 20260902020000:38.
--
-- `state` is untouched, for the over-the-air reason at the top of this file.
-- The nightly sweep is untouched too: it may still stamp `expired_at` on a
-- row that was already withdrawn, and the client resolves that by reading
-- withdrawn_at first - the sender's own act outranks a clock.
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
  expired_at timestamptz,
  blocked_after_send boolean,
  withdrawn_at timestamptz
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
    expired_at,
    -- Stopped after the app said it was sent. The prefilter's own blocks are
    -- false here: those were refused in the composer, in front of the person
    -- writing, with the text still in the box.
    status = 'blocked_by_moderation'
      and coalesce(moderation_verdict ->> 'engine', '') <> 'prefilter-v1',
    withdrawn_at
  from public.message_requests
  where sender_id = auth.uid()
  order by created_at desc
$$;

revoke execute on function public.sent_requests() from public, anon;
grant execute on function public.sent_requests() to authenticated;

comment on function public.sent_requests() is
  'The sender''s only read path for their own hellos. Collapses pending, '
  'declined and expired into a flat "sent" (invariants 4 and 5), and marks '
  'the two facts that are the sender''s own business: a message stopped by '
  'the classifier after the app had already confirmed it, and one they took '
  'back themselves.';


-- =========================================================================
-- PART TWO. The liquidity number becomes countable, and keeps a history.
-- =========================================================================
--
-- The brief calls liquidity THE metric and gates opening a second city on it
-- (§6: 500-1,000 in-season per city). admin_liquidity (20260817150000:434)
-- answers two questions badly.
--
-- It unions users with a live pin and users with an active trip, and a trip
-- can be posted weeks ahead and run for weeks - so somebody who installed
-- once, posted a trip and never opened the app again counts toward a city's
-- liquidity for the whole window. The number the most expensive decision in
-- the plan turns on can therefore be met entirely by people who will never
-- answer a hello.
--
-- And it is a gauge with no trend. There is no snapshot table anywhere in
-- supabase/migrations, and pins hard-delete within 15 minutes of expiry by
-- design (hard rule 3), so the history cannot be reconstructed after the
-- fact. Either it is recorded as it happens or it does not exist.
--
-- WHY last_seen_on IS NOT A RULE 2 CONCERN, stated here so a later reader
-- does not have to guess.
--
-- Hard rule 2 is that no real-time user location is ever collected, stored or
-- displayed. This column is a DATE and nothing else: no time of day, no
-- coordinates, no city, no device. `2026-09-01` says the app was opened at
-- some point during a day, which is the same class of fact as `created_at`
-- that every row in this schema already carries. It is written by the account
-- itself for itself and read by nobody but the service role.
--
-- It is kept to a date deliberately, and that limit is the whole safety
-- argument rather than a detail. A per-minute last-seen is a PRESENCE signal,
-- and presence is one short step from the live-location promise this product
-- is built on refusing - "last seen 3 minutes ago" next to a name is exactly
-- what the design brief bans. A date cannot be read that way. Nothing
-- surfaces it to another user, and no view below exposes it to a client.
--
-- FOUNDER SIGN-OFF: this is a new fact stored about a person in an app whose
-- pitch is that it stores as little as possible. It is inside the hard rules
-- but it is not free, and docs/PROGRESS.md carries the question.

alter table public.profiles add column if not exists last_seen_on date;

comment on column public.profiles.last_seen_on is
  'The DAY this account last opened the app, written by touch_last_seen(). '
  'Day granularity only, never a time: a per-minute last-seen is a presence '
  'signal and this app does not have those (hard rule 2). Server-only - no '
  'client grant, and no view serves it to anon or authenticated.';

-- Deliberately NOT granted to authenticated. profiles carries column-level
-- grants and is never star-selected by the app (see
-- 31_select_star_stays_readable.test.sql, which lists profiles as a table
-- that must never be), so leaving this column out of the grant list is both
-- safe and the point: nothing in the client can read it, about themselves or
-- about anybody else.

-- Say that this account opened the app today.
--
-- Takes no argument, which is the strongest form of "cannot be called for
-- another user": there is nowhere to put somebody else's id. Writes at most
-- once per day per account - the second call of the day updates zero rows -
-- so a tab switch that remounts the caller costs one cheap no-op.
create function public.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles
     set last_seen_on = current_date
   where user_id = auth.uid()
     and (last_seen_on is null or last_seen_on < current_date)
$$;

revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

comment on function public.touch_last_seen() is
  'Stamps profiles.last_seen_on with today''s DATE for the calling account. '
  'No argument, so it can only ever write the caller''s own row; at most one '
  'write per account per day.';

-- admin_liquidity gains the reachable count.
--
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- reorder columns, and `liquidity_reachable` belongs beside `liquidity`
-- rather than tacked on after it where a reader would miss the pairing. A
-- view is not a function, so the drop-function-first rule does not apply -
-- but a dropped view loses its REVOKE, and the four-view revoke is restated
-- below, verbatim from 20260817150000:523.
--
-- Seven days is the window. It is long enough that somebody who opens the app
-- on a Sunday still counts on the following Saturday, and short enough that
-- an install-once account falls out of it while their two-week trip is still
-- posted - which is the whole gap this column exists to show.
--
-- `liquidity` itself is UNCHANGED. The reachable count sits beside it rather
-- than replacing it, because the two together are the finding: liquidity 800
-- with reachable 90 is a different city from liquidity 800 with reachable
-- 700, and a single corrected number would have hidden which one you have.
--
-- A null last_seen_on reads as unreachable, which is right and is also
-- temporary: every account is null until it next opens the app, so this
-- column reads low for the first week after deploy and is not a collapse.
drop view public.admin_liquidity;

create view public.admin_liquidity as
select
  c.name as city,
  lc.city_id,
  lc.active as city_open,
  (select count(distinct p.user_id) from public.pins p
    where p.city_id = lc.city_id and p.user_id is not null
      and p.expires_at > now()) as users_with_live_pin,
  (select count(distinct t.user_id) from public.trips t
    where t.city_id = lc.city_id and t.status = 'active'
      and t.end_date >= current_date) as users_with_active_trip,
  (select count(*) from (
    select p.user_id from public.pins p
      where p.city_id = lc.city_id and p.user_id is not null
        and p.expires_at > now()
    union
    select t.user_id from public.trips t
      where t.city_id = lc.city_id and t.status = 'active'
        and t.end_date >= current_date
  ) liquid) as liquidity,
  (select count(*) from (
    select p.user_id from public.pins p
      where p.city_id = lc.city_id and p.user_id is not null
        and p.expires_at > now()
    union
    select t.user_id from public.trips t
      where t.city_id = lc.city_id and t.status = 'active'
        and t.end_date >= current_date
  ) liquid
   join public.profiles pr on pr.user_id = liquid.user_id
   where pr.last_seen_on >= current_date - 7) as liquidity_reachable
from public.launch_cities lc
join public.cities c on c.id = lc.city_id;

-- The trend the gauge cannot keep.
--
-- COUNTS ONLY, and never rows. Hard rule 3 hard-expires pins within 72 hours
-- and deletes them within 15 minutes of expiry; a snapshot that stored pin
-- rows, user ids or anything with a location on it would be a way around that
-- rule wearing an analytics hat. A daily integer per city retains no pin, no
-- trip, no person and no coordinate, so rule 3 is untouched.
create table public.liquidity_daily (
  city_id int not null references public.cities (id),
  day date not null,
  users_with_live_pin int not null,
  users_with_active_trip int not null,
  liquidity int not null,
  reachable int not null,
  primary key (city_id, day)
);

comment on table public.liquidity_daily is
  'One row per launch city per day: the counts admin_liquidity shows live. '
  'Counts only, never rows - a pin hard-expires within 72 hours (rule 3) and '
  'nothing here may outlive it. Service-role only.';

alter table public.liquidity_daily enable row level security;

-- No policy, and that is the whole access model: RLS with no policy returns
-- zero rows to anon and authenticated, the revoke refuses them the table
-- outright, and the service role bypasses both. Its only reader is the
-- founder's SQL editor (docs/DASHBOARD.md); its only writer is the job below.
revoke all on public.liquidity_daily from anon, authenticated;

create function public.snapshot_liquidity()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.liquidity_daily
    (city_id, day, users_with_live_pin, users_with_active_trip, liquidity, reachable)
  select
    l.city_id, current_date,
    l.users_with_live_pin, l.users_with_active_trip, l.liquidity, l.liquidity_reachable
  from public.admin_liquidity l
  -- Re-running the job on the same day corrects that day rather than failing
  -- on the primary key, so a manual catch-up run after a missed night is
  -- safe.
  on conflict (city_id, day) do update
    set users_with_live_pin = excluded.users_with_live_pin,
        users_with_active_trip = excluded.users_with_active_trip,
        liquidity = excluded.liquidity,
        reachable = excluded.reachable;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.snapshot_liquidity()
  from public, anon, authenticated;

comment on function public.snapshot_liquidity() is
  'Writes today''s admin_liquidity counts into liquidity_daily, one row per '
  'launch city. Idempotent within a day. Counts only, never rows (rule 3).';

-- Nightly, under the same guard every other sweep in this schema uses: the
-- local test cluster has no pg_cron, and a migration that assumes one fails
-- the suite rather than the deploy. 3:50, after expire-message-requests at
-- 3:40, so the day's snapshot is taken on a swept database rather than mid-
-- sweep. It counts what is live at that moment, which is what a daily gauge
-- means.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('snapshot-liquidity', '50 3 * * *',
                          'select public.snapshot_liquidity()');
  end if;
end
$$;

-- Re-stated after the drop, verbatim from 20260817150000:523. A view
-- recreated without its revoke is readable by every signed-in client, and
-- this one now carries a reachability count derived from a column no client
-- may read at all.
revoke all on public.admin_liquidity, public.admin_request_funnel,
  public.admin_moderation_stats, public.admin_pin_stats
from anon, authenticated;

notify pgrst, 'reload schema';
