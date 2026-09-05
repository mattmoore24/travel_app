-- A message to support says which kind it is.
--
-- One free-text box served an appeal against a closed account, a bug report,
-- and "a man I met from this app followed me back to my hostel". Nothing let
-- the sender mark which, so nothing let a one-person support queue triage,
-- and on a one-person queue that difference is measured in hours.
--
-- The category is a TRIAGE HINT and never an authorisation. It is declared by
-- the sender, so nothing in this database may branch on it beyond ordering
-- and what the push says: a safety label buys attention, never a privilege.
--
-- The overload trap is the whole risk in this file, and it is worse than the
-- RETURNS TABLE one AGENTS.md warns about. `create or replace` with an extra
-- parameter does not replace anything: it makes a SECOND function, and every
-- already-installed build calling the two-argument version then resolves
-- ambiguously ("function is not unique") on the app's only route to a human.
-- So: drop first, create with the third parameter DEFAULTED so an old bundle
-- keeps working through the OTA gap, and restate the grant the drop removed.
--
-- DEPLOY ORDER: THIS MIGRATION FIRST, THE OTA UPDATE SECOND. The defaulted
-- parameter buys the old-bundle-against-a-new-database direction, and only
-- that one. The reverse is not survivable, and this batch makes the reverse
-- certain: the contact form now REQUIRES the category chip before Send is
-- available, so every send from the new bundle passes p_category, and a
-- project that has not taken this migration answers "Could not find the
-- function public.submit_support_message(p_body, p_category, p_reply_to)".
-- That is the app's only route to a human, and the appeal route for somebody
-- who has just been locked out of their account. Recorded again in
-- docs/PROGRESS.md: a deploy note that lives only inside the thing being
-- deployed is a note nobody reads first.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table public.support_messages
  add column category text
    check (category is null or category in ('safety', 'account', 'other'));

comment on column public.support_messages.category is
  'What the sender said this is about: safety, account, or other. Null for '
  'anything written by a build that predates the chip row. A triage hint '
  'only: it orders the queue and names the push, and nothing else may read '
  'it as permission.';

-- The insert grant is restated with the new column. submit_support_message is
-- SECURITY DEFINER and does not need it, but the grant is the documentation
-- of what a client may write, and a column missing from it reads as a column
-- clients must not set.
grant insert (user_id, reply_to, body, category)
  on public.support_messages to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

drop function if exists public.submit_support_message(text, text);

create function public.submit_support_message(
  p_reply_to text,
  p_body text,
  p_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.support_messages (user_id, reply_to, body, category)
  values (auth.uid(), p_reply_to, p_body, p_category)
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function public.submit_support_message(text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The notification
-- ---------------------------------------------------------------------------

-- Body copied from 20260821150000_support_delivery.sql:82, with the category
-- ahead of the address. Triage has to be possible from a lock screen, and
-- "Safety: someone@example.com" answers that in one glance where
-- "Support: someone@example.com" does not.
create or replace function public.enqueue_support_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The address goes in the title so it can be read off a lock screen without
  -- opening anything, and the body is the message, truncated the same way
  -- every other push in this schema is.
  insert into public.push_queue (user_id, title, body, data)
  select d.id,
         case new.category
           when 'safety' then 'Safety: '
           when 'account' then 'Account: '
           else 'Support: '
         end || new.reply_to,
         left(new.body, 140),
         jsonb_build_object('type', 'support', 'support_message_id', new.id)
  from public.support_duty_user_ids() as d(id)
  where d.id is distinct from new.user_id;

  return new;
end
$$;

revoke execute on function public.enqueue_support_push() from public, anon, authenticated;
