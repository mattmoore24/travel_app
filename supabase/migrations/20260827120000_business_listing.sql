-- Business accounts, part 3: getting listed, getting verified, getting reported
-- ===========================================================================
--
-- docs/BUSINESS_ACCOUNTS.md phase 15, and the founder's final call on §3.9.
-- Two separate things, and keeping them separate is the whole design:
--
--   confirm the email     -> the listing goes live.   NO BADGE.
--   storefront photo      -> the badge.
--
-- A confirmation link proves an inbox exists and somebody read it. It proves
-- nothing about a business: hostellisboa2024@gmail.com confirms in four
-- seconds. Google's check is credible because the bar behind it is a video of
-- you unlocking the shop. A check mark next to an email click would be worse
-- than no badge at all, because it would lend an impersonator this app's
-- credibility. So the badge is earned by two live camera shots of the
-- premises, judged the way a selfie is.
--
-- And **[founder]** the impersonation scan runs on the FIRST report, not the
-- third, with an email out on every report. That is what keeps the disputes
-- rare enough to be handled by hand, which is the whole posture.

-- The audit trail already keys on a user. A business is the other kind of
-- subject a machine verdict can be about, and squeezing it into
-- subject_user_id would have made "everything ever decided about this
-- account" a query nobody could write.
alter table public.moderation_events
  add column subject_business_id uuid references public.businesses (id) on delete set null;

create index moderation_events_business_idx
  on public.moderation_events (subject_business_id, created_at desc)
  where subject_business_id is not null;

-- ---------------------------------------------------------------------------
-- Outbound mail
-- ---------------------------------------------------------------------------
--
-- A queue rather than a direct send, for the same reason support_messages is
-- one: the ROW is the record and the email is the notification, so a missing
-- Resend key means mail piles up safely instead of being lost. support-mailer
-- drains this alongside the contact form and its backoff is already proven
-- against a real outage.
--
-- `to_address` NULL means "the support inbox", which the worker fills in from
-- the SUPPORT_INBOX secret. The founder's own address therefore never enters
-- the database, and moving to a dedicated support address later is a secret
-- rotation with no migration.

create table public.outbound_mail (
  id uuid primary key default gen_random_uuid(),
  /** NULL = send to SUPPORT_INBOX. The worker substitutes it. */
  to_address text check (
    to_address is null
    or to_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  subject text not null check (char_length(subject) between 1 and 200),
  text_body text not null check (char_length(text_body) between 1 and 8000),
  /** Sorting hint for the founder's inbox and for our own log reading. */
  kind text not null check (char_length(kind) between 1 and 40),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivery_attempts int not null default 0,
  delivery_error text,
  next_attempt_at timestamptz not null default now()
);

create index outbound_mail_undelivered_idx on public.outbound_mail (next_attempt_at)
  where delivered_at is null;

-- RLS on with no policies at all: on hosted Supabase the service role has
-- BYPASSRLS, so this is a lock rather than a lockout, and it is the same
-- pattern push_queue and moderation_events already use.
alter table public.outbound_mail enable row level security;
revoke all on public.outbound_mail from anon, authenticated;

comment on table public.outbound_mail is
  'Queued email. The row is the record, the email is the notification. '
  'to_address NULL means the SUPPORT_INBOX secret, so the founder''s own '
  'address never lands in the database.';

-- ---------------------------------------------------------------------------
-- Step 1: confirm the email
-- ---------------------------------------------------------------------------
--
-- A six-digit code rather than a tappable link. Functionally identical - both
-- prove somebody reads that inbox - and a code needs no deep-link handling,
-- no associated-domain entitlement and no native build, so it ships over the
-- air today. It also survives mail clients that rewrite links.

create table public.business_email_confirmations (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  email text not null check (
    char_length(email) between 5 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sends_today int not null default 1,
  sends_day date not null default current_date,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.business_email_confirmations enable row level security;
revoke all on public.business_email_confirmations from anon, authenticated;

comment on table public.business_email_confirmations is
  'The six-digit code that puts a listing on the map. No client grants at '
  'all: the code is only ever compared server-side, never read back.';

/**
 * Send (or resend) the confirmation code.
 *
 * The code is stored hashed and never returned, so a caller who can run this
 * still has to read the inbox. Five sends a day, twenty minutes to live.
 */
create function public.request_business_email_confirmation(p_email text)
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
end
$$;

revoke execute on function public.request_business_email_confirmation(text) from public, anon;

/**
 * Confirm the code, and light the listing up.
 *
 * Only out of `unconfirmed`: a business the founder has flagged or removed
 * does not get to relist itself by clicking an email.
 */
create function public.confirm_business_email(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_email_confirmations%rowtype;
  v_state public.business_state;
begin
  select c.* into v_row
    from public.business_email_confirmations c
    join public.businesses b on b.id = c.business_id
   where b.owner_user_id = auth.uid()
   for update;
  if not found then
    raise exception 'ask for a code first';
  end if;
  if v_row.confirmed_at is not null then
    return jsonb_build_object('confirmed', true);
  end if;
  if v_row.expires_at <= now() then
    raise exception 'that code has expired. Ask for a new one';
  end if;
  if v_row.attempts >= 10 then
    raise exception 'too many tries. Ask for a new code';
  end if;

  if encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex') <> v_row.code_hash then
    update public.business_email_confirmations
       set attempts = attempts + 1 where business_id = v_row.business_id;
    raise exception 'that code is not right';
  end if;

  update public.business_email_confirmations
     set confirmed_at = now() where business_id = v_row.business_id;

  select state into v_state from public.businesses where id = v_row.business_id;
  if v_state = 'unconfirmed' then
    update public.businesses
       set state = 'listed', listed_at = now()
     where id = v_row.business_id;
  end if;

  return jsonb_build_object('confirmed', true);
end
$$;

revoke execute on function public.confirm_business_email(text) from public, anon;

-- ---------------------------------------------------------------------------
-- Step 2: the storefront photo, which is what the badge means
-- ---------------------------------------------------------------------------

-- Its own enum rather than a fourth value on public.verification_status.
-- Altering an existing enum and using the new value in the same transaction
-- is how a migration half-applies, and 'uncertain' has no meaning for a
-- selfie anyway.
create type public.business_verification_status as enum (
  'pending', 'approved', 'rejected', 'uncertain'
);

create table public.business_verifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  /** The whole front from across the street, sign and streetscape in frame. */
  wide_path text not null,
  /** Close enough to read the sign. */
  close_path text not null,
  status public.business_verification_status not null default 'pending',
  /** User-facing when rejecting; the full model verdict stays in `verdict`. */
  reason text,
  verdict jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index business_verifications_business_idx
  on public.business_verifications (business_id, created_at desc);
create index business_verifications_pending_idx
  on public.business_verifications (created_at) where status = 'pending';

alter table public.business_verifications enable row level security;
revoke all on public.business_verifications from anon, authenticated;
-- The owner sees the outcome and the sentence explaining it. `verdict` and
-- the two storage paths are not in the list: the evidence is nobody's
-- business but the reviewer's.
grant select (id, business_id, status, reason, created_at, reviewed_at)
  on public.business_verifications to authenticated;

create policy business_verifications_select_own
  on public.business_verifications for select to authenticated
  using (public.owns_business(business_id));

insert into storage.buckets (id, name, public)
values ('business-verification', 'business-verification', false)
on conflict (id) do nothing;

-- Same path convention as every other private bucket here,
-- `<owner_user_id>/<random>.jpg`, so own_object_count()'s ceiling works and
-- the write policies are the proven ones. These never render on the listing:
-- there is no read policy for anyone but the uploader.
create policy business_verification_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-verification'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.own_object_count('business-verification') < 20
  );

create policy business_verification_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-verification'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy business_verification_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-verification'
    and split_part(name, '/', 1) = auth.uid()::text
  );

/**
 * Submit the two shots.
 *
 * Two and not one, and that is the anti-fraud design rather than a nicety: a
 * close-up of a sign is the easiest thing on earth to find on the internet,
 * and a wide shot pins that sign to a building, a street and a streetscape.
 * The pair has to agree with each other and with the marker the business
 * dropped. It costs an honest business twenty extra seconds.
 *
 * The gates, in order, each raising a sentence that reaches the owner
 * verbatim through the client's save-failure path:
 */
create function public.submit_business_verification(p_wide_path text, p_close_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_state public.business_state;
  v_verified timestamptz;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();

  select id, state, verified_at into v_business, v_state, v_verified
    from public.businesses where owner_user_id = auth.uid();
  if v_business is null then
    raise exception 'this account does not run a business' using errcode = '42501';
  end if;
  if v_verified is not null then
    raise exception 'you are already verified';
  end if;
  -- Confirming the email comes first. Without this gate a business that had
  -- not been listed yet would burn one of its three daily attempts on a check
  -- it was never going to be allowed to pass.
  if v_state <> 'listed' then
    raise exception 'confirm your email first';
  end if;

  if split_part(p_wide_path, '/', 1) <> auth.uid()::text
     or split_part(p_close_path, '/', 1) <> auth.uid()::text then
    raise exception 'those photos must live in your own storage folder';
  end if;
  if p_wide_path = p_close_path then
    raise exception 'we need two different photos';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'business-verification' and name in (p_wide_path, p_close_path)
    having count(*) = 2
  ) then
    raise exception 'photo upload not found';
  end if;

  -- Transaction-scoped, so the one-pending and three-a-day checks below
  -- cannot be raced by two simultaneous submits.
  perform pg_advisory_xact_lock(hashtext('business_verification:' || v_business::text));

  if exists (
    select 1 from public.business_verifications
    where business_id = v_business and status = 'pending'
  ) then
    raise exception 'your photos are already being checked';
  end if;
  if (
    select count(*) from public.business_verifications
    where business_id = v_business and created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'too many tries today. Have another go tomorrow';
  end if;

  insert into public.business_verifications (business_id, wide_path, close_path)
  values (v_business, p_wide_path, p_close_path)
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end
$$;

revoke execute on function public.submit_business_verification(text, text) from public, anon;

/**
 * Write back the machine's verdict. Service role only.
 *
 * Three outcomes, not two. `uncertain` goes to the founder rather than to
 * either extreme, because a hand-painted sign in a script the model reads
 * poorly is a real business having a bad day, and refusing it outright would
 * be the app being confidently wrong about somebody's livelihood.
 *
 * Unlike the selfie flow, the evidence is NOT deleted afterwards. A traveler
 * appeals nothing; a business that is refused is told to write in, and the
 * founder cannot judge an appeal against a photo that no longer exists.
 */
create function public.apply_business_verification_verdict(p_request_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_verifications%rowtype;
  v_action text := p_verdict ->> 'action';
begin
  perform public.assert_service_caller();

  select * into v_row from public.business_verifications
   where id = p_request_id for update;
  if not found then
    raise exception 'verification request not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'verification request is not pending';
  end if;

  if v_action = 'approve' then
    update public.business_verifications
       set status = 'approved', verdict = p_verdict, reviewed_at = now(), reason = null
     where id = p_request_id;
    update public.businesses set verified_at = now() where id = v_row.business_id;
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, 'You are verified on Samewhere',
           concat(b.name, ' now shows the verified check on its page. Nothing ',
                  'else changes, and you can put more up whenever you like.'),
           'business_verified'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  elsif v_action = 'uncertain' then
    -- Left PENDING on purpose. The founder is the next reviewer, and this is
    -- the queue they read; flipping it to a terminal state here would hide it.
    update public.business_verifications
       set status = 'uncertain', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(p_verdict ->> 'reason', null)
     where id = p_request_id;
    insert into public.outbound_mail (subject, text_body, kind)
    select concat('Storefront photo needs a look: ', b.name),
           concat('Business: ', b.name, E'\n',
                  'Request: ', p_request_id::text, E'\n',
                  'Model said: ', coalesce(p_verdict ->> 'reason', '(no reason given)'))
      from public.businesses b where b.id = v_row.business_id;
  else
    update public.business_verifications
       set status = 'rejected', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(
             p_verdict ->> 'reason',
             'We could not match those photos to the business. Try again in daylight, with the sign in frame.'
           )
     where id = p_request_id;
  end if;

  insert into public.moderation_events
    (subject_business_id, entity_type, entity_id, action, source, metadata)
  values (v_row.business_id, 'business_verification', p_request_id,
          concat('business_verification_', coalesce(v_action, 'reject')),
          'claude-storefront', p_verdict);
end
$$;

revoke execute on function public.apply_business_verification_verdict(uuid, jsonb)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Renaming or moving costs the badge
-- ---------------------------------------------------------------------------
--
-- The one attack a confirmation step genuinely stops: verify a surf shack,
-- then rename it to the Marriott. Google re-triggers verification on exactly
-- this edit set, and so does this.

create function public.business_rename_resets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name
     or new.city_id is distinct from old.city_id
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    new.verified_at := null;
    if old.state = 'listed' then
      new.state := 'unconfirmed';
      new.listed_at := null;
    end if;
  end if;
  return new;
end
$$;

create trigger businesses_rename_resets
  before update on public.businesses
  for each row execute function public.business_rename_resets();

revoke execute on function public.business_rename_resets() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 3: reports, and the scan on the FIRST one
-- ---------------------------------------------------------------------------

create type public.business_report_reason as enum (
  'not_a_real_place', 'permanently_closed', 'not_this_business',
  'wrong_location', 'spam_or_offensive'
);

create table public.business_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- set null rather than cascade: deleting an account must not delete the
  -- report that account filed.
  reporter_user_id uuid references public.users (id) on delete set null,
  reason public.business_report_reason not null,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

-- One account is one voice. Without this, "the first report triggers a scan"
-- would be "one account can trigger a scan as often as it likes".
create unique index business_reports_one_voice
  on public.business_reports (business_id, reporter_user_id)
  where reporter_user_id is not null;

alter table public.business_reports enable row level security;
revoke all on public.business_reports from anon, authenticated;

comment on table public.business_reports is
  'Google''s reason list, because it is well-worn. The first report from a '
  'given account emails the support inbox AND enqueues a Claude read of the '
  'whole listing; a plausible impersonation verdict darkens it immediately.';

-- The scan queue. Its own table rather than a column on the report, because
-- two reports inside a day share one scan and the queue is what the worker
-- drains.
create table public.business_scans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  trigger_report_id uuid references public.business_reports (id) on delete set null,
  status public.moderation_status not null default 'pending',
  verdict jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index business_scans_pending_idx on public.business_scans (created_at)
  where status = 'pending';

alter table public.business_scans enable row level security;
revoke all on public.business_scans from anon, authenticated;

/**
 * Report a place.
 *
 * SECURITY DEFINER because the reporter must not be able to read the report
 * table afterwards - who reported a business is exactly the thing that would
 * make reporting one risky.
 */
create function public.report_business(
  p_business_id uuid,
  p_reason public.business_report_reason,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if not public.is_visible_business(p_business_id) then
    raise exception 'place not found';
  end if;
  if public.owns_business(p_business_id) then
    raise exception 'that is your own listing';
  end if;

  -- The index is PARTIAL (`where reporter_user_id is not null`), and
  -- inference has to name the predicate or Postgres refuses to match it.
  insert into public.business_reports (business_id, reporter_user_id, reason, note)
  values (p_business_id, v_user, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (business_id, reporter_user_id) where reporter_user_id is not null
  do nothing;
end
$$;

revoke execute on function public.report_business(uuid, public.business_report_reason, text)
from public, anon;

/**
 * What happens on a report: an email, always, and a scan unless one has run
 * in the last day.
 *
 * **[founder]** the scan is on the FIRST report rather than the third. The
 * machine read is cheap, and it is the thing that keeps the queue short
 * enough that "I'll handle the rest by hand" is a real plan rather than a
 * theoretical one.
 */
create function public.on_business_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_city text;
begin
  select b.name, c.name into v_name, v_city
    from public.businesses b join public.cities c on c.id = b.city_id
   where b.id = new.business_id;

  insert into public.outbound_mail (subject, text_body, kind)
  values (
    concat('Reported: ', v_name),
    concat(
      'Business: ', v_name, ' (', coalesce(v_city, 'unknown city'), ')', E'\n',
      'Business id: ', new.business_id::text, E'\n',
      'Reason: ', new.reason::text, E'\n',
      'Note: ', coalesce(new.note, '(none)'), E'\n',
      'Report id: ', new.id::text, E'\n\n',
      'A check of the whole listing has been queued. If it comes back as ',
      'plausible impersonation the listing goes dark straight away and you ',
      'get a second mail; otherwise it stays up and waits for you.'
    ),
    'business_reported'
  );

  -- One scan a day per business. Two people reporting the same bar within an
  -- hour is one question, not two, and the email still goes out for both
  -- because the founder asked to see them.
  if not exists (
    select 1 from public.business_scans
    where business_id = new.business_id and created_at > now() - interval '24 hours'
  ) then
    insert into public.business_scans (business_id, trigger_report_id)
    values (new.business_id, new.id);
  end if;

  return new;
end
$$;

create trigger business_reports_escalate
  after insert on public.business_reports
  for each row execute function public.on_business_report();

revoke execute on function public.on_business_report() from public, anon, authenticated;

/** Write back the impersonation scan. Service role only. */
create function public.apply_business_scan_verdict(p_scan_id uuid, p_verdict jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_scans%rowtype;
  v_name text;
  v_plausible boolean := coalesce((p_verdict ->> 'impersonation_plausible')::boolean, false);
begin
  perform public.assert_service_caller();

  select * into v_row from public.business_scans where id = p_scan_id for update;
  if not found then
    raise exception 'scan not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'scan is not pending';
  end if;

  update public.business_scans
     set status = (case when v_plausible then 'rejected' else 'approved' end)::public.moderation_status,
         verdict = p_verdict, reviewed_at = now()
   where id = p_scan_id;

  select name into v_name from public.businesses where id = v_row.business_id;

  if v_plausible then
    -- Dark immediately, and the badge goes with it. A listing that is
    -- plausibly pretending to be somebody else is the phishing surface this
    -- whole section exists to close.
    update public.businesses
       set state = 'flagged', verified_at = null
     where id = v_row.business_id;

    insert into public.outbound_mail (subject, text_body, kind)
    values (
      concat('Taken down pending review: ', v_name),
      concat('Business: ', v_name, E'\n',
             'Business id: ', v_row.business_id::text, E'\n',
             'The check says impersonation is plausible, so the listing is ',
             'dark and its chat is unjoinable until you say otherwise.', E'\n\n',
             'Reason: ', coalesce(p_verdict ->> 'reason', '(none given)')),
      'business_flagged'
    );
  end if;

  insert into public.moderation_events
    (subject_business_id, entity_type, entity_id, action, source, metadata)
  values (v_row.business_id, 'business_scan', p_scan_id,
          case when v_plausible then 'business_flagged' else 'business_cleared' end,
          'claude-impersonation', p_verdict);
end
$$;

revoke execute on function public.apply_business_scan_verdict(uuid, jsonb)
from public, anon, authenticated;

/**
 * The manual path the founder asked to be left with.
 *
 * Everything above exists to keep this queue short enough that it is a real
 * plan rather than a theoretical one.
 */
create function public.admin_resolve_business_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  perform public.assert_service_caller();

  select business_id into v_business from public.business_reports where id = p_report_id;
  if v_business is null then
    raise exception 'report not found';
  end if;

  if p_action = 'flag' then
    update public.businesses set state = 'flagged', verified_at = null where id = v_business;
  elsif p_action = 'relist' then
    update public.businesses set state = 'listed', listed_at = now() where id = v_business;
  elsif p_action = 'remove' then
    update public.businesses set state = 'removed', active = false where id = v_business;
  elsif p_action = 'unverify' then
    update public.businesses set verified_at = null where id = v_business;
  elsif p_action <> 'dismiss' then
    raise exception 'unknown action';
  end if;

  update public.business_reports
     set resolved_at = now(), resolution = p_action
   where business_id = v_business and resolved_at is null;
end
$$;

revoke execute on function public.admin_resolve_business_report(uuid, text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
--
-- The two new worker branches live inside moderation-worker, which is already
-- on the every-minute schedule, so nothing new is needed for them. The post
-- sweep is new: it is what stops an event last Tuesday still reading as ON,
-- which is worse than no post at all.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'archive-expired-posts',
      '7 * * * *',
      $cron$select public.archive_expired_posts()$cron$
    );
  end if;
end
$$;
