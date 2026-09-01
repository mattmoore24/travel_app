-- Three replies an owner writes once, and taps into a chat later
-- ===========================================================================
--
-- A bar mid-service either answers a traveler in three taps or does not
-- answer at all, and the public rating that judges a business is largely a
-- responsiveness score. Messages to a business go through with no accept gate
-- (20260827130000_business_inbound.sql), so every "do you have beds tonight"
-- arrives as a fresh conversation with a blank composer.
--
-- These are PRIVATE NOTES, not messages. Nothing here is ever delivered to
-- anybody: the owner taps one into their composer, reads it, edits it if they
-- want, and presses send, at which point it becomes an ordinary message on
-- the ordinary path. That is why they are not a granted column on
-- `businesses`, whose select grant already reaches anon for the listed
-- columns - a traveler must never be able to read the script the other side
-- is answering from.
--
-- No moderation trigger, deliberately, and this is the half worth reading
-- twice. Hard rule 5 is about a FIRST message from a stranger, and
-- message_business() is where it is enforced: that function screens
-- p_first_message, which is the TRAVELER's, and refuses a business caller
-- outright (rule 8). The owner's side of that chat has never been a first
-- message and has never been screened. A saved reply is the owner's own words
-- about their own opening hours, stored where only they can read them, so
-- screening it here would be screening a private note nobody receives - and
-- screen_first_message is a flirt-and-harassment classifier, which is the
-- wrong question to ask of "Beds tonight, yes. Come by after six."
--
-- Three, and exactly three. Not a list that grows: the whole value is that
-- the row of chips fits above a keyboard and is read at a glance.

create table public.business_saved_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  position int not null check (position between 0 and 2),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, position)
);

-- No index of its own: the unique constraint above already leads with
-- business_id, which is the only way anything reads this table.

create trigger business_saved_replies_updated_at
  before update on public.business_saved_replies
  for each row execute function public.set_updated_at();

-- Grants and policies -------------------------------------------------------
--
-- anon gets nothing at all, not even a policy to fail against: there is no
-- reader of this table who is not signed in as the owner of the row.
--
-- One policy per verb rather than one `for all`. They carry the same
-- expression today, and writing them apart is what makes a later change to
-- one of them visible as a change to one of them.

alter table public.business_saved_replies enable row level security;
revoke all on public.business_saved_replies from anon, authenticated;
grant select, insert, update, delete on public.business_saved_replies to authenticated;

create policy business_saved_replies_select_own
  on public.business_saved_replies for select to authenticated
  using (public.owns_business(business_id));

create policy business_saved_replies_insert_own
  on public.business_saved_replies for insert to authenticated
  with check (public.owns_business(business_id));

create policy business_saved_replies_update_own
  on public.business_saved_replies for update to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

create policy business_saved_replies_delete_own
  on public.business_saved_replies for delete to authenticated
  using (public.owns_business(business_id));

comment on table public.business_saved_replies is
  'An owner''s three private answer templates. Never delivered, never read by anybody but the owner.';
