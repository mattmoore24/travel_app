-- Words a traveler would rather not see, and what happens to a hello that
-- uses one.
--
-- The classifier is tuned by the platform for everyone, and it is tuned
-- conservatively on purpose, because a false positive silences a legitimate
-- hello. That leaves each traveler with no way to set their own line, and the
-- only control they have today arrives after the fact: the "Does this feel
-- off? Tell us." link, which is reachable once the message has already been
-- read.
--
-- THIS SITS ON TOP OF THE SERVER PIPELINE AND NEVER REPLACES IT. Hard rule 5
-- still holds exactly as before: every first message is classified by the
-- moderation worker before it is delivered, and nothing here is consulted on
-- that path. This is a per-user layer applied at RENDER, after delivery.
-- Nothing is deleted, nothing is gated, no verdict changes, and the sender is
-- never told - not that a word matched, not that the message was folded, not
-- that a list exists. On the recipient's screen the sender's profile, the
-- report link, Decline and Accept all stay exactly where they were.
--
-- Recorded founder question, still open (docs/UX_PACKAGES.md
-- `chat-words-i-would-rather-not-see`): is it worth a table, a screen and a
-- settings row for a product with no users yet? FOR - the platform classifier
-- is deliberately conservative, the travelers this marketplace cannot afford
-- to lose are the ones with the most specific lines, and it stays free and
-- gates nothing. AGAINST - the same effort spent on the classifier itself
-- helps everyone rather than the few who find the setting. Built under the
-- blanket approval to implement every remaining package; the question is
-- recorded here so the decision stays visible.

create table public.user_muted_words (
  user_id uuid not null references public.users (id) on delete cascade,
  -- Stored already folded: lower case, trimmed, single-spaced. The primary
  -- key is the whole point of that - without it 'Ass', 'ass ' and 'ass' are
  -- three rows that all do the same thing, and a list that shows a word twice
  -- reads as broken. The client folds with normalizeMutedWord(); this check
  -- is what makes the client's version unnecessary to trust.
  word text not null
    check (char_length(word) between 1 and 40)
    check (word = lower(word))
    check (word ~ '^[^[:space:]]+( [^[:space:]]+)*$'),
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);

alter table public.user_muted_words enable row level security;

-- THREE VERBS, NOT FOUR, and the missing one is the point.
--
-- A row here is (user_id, word) plus a created_at nobody sets - the whole row
-- IS the key. There is no field an update could change that a delete and an
-- insert do not express better, and nothing in the app tries: the editor
-- diffs the list and sends inserts and deletes (src/features/profile/
-- muted-words.ts), and src/lib/database.types.ts declares this table's
-- `Update` as `never`. A granted UPDATE would be a verb the schema allows, the
-- types forbid and no code uses - on a safety table, where the gap between
-- what a client MAY do and what it DOES is the whole attack surface. So the
-- grant, the policies and the types now say the same thing.
--
-- Written as three policies rather than one `for all`, because `for all` is
-- what silently re-permits UPDATE the day somebody restores the grant, and
-- because the verbs genuinely differ: select and delete are decided by `using`
-- (which rows you can see and remove), insert by `with check` (what you may
-- write). The `with check` is what refuses an insert naming somebody else's
-- user_id rather than letting it land quietly. All three are scoped `to
-- authenticated` the way every other policy in this schema is: an unscoped
-- policy is evaluated for anon as well, and it is the revoke below that
-- actually keeps anon out.
create policy user_muted_words_select_own on public.user_muted_words
  for select to authenticated
  using (user_id = auth.uid());

create policy user_muted_words_insert_own on public.user_muted_words
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_muted_words_delete_own on public.user_muted_words
  for delete to authenticated
  using (user_id = auth.uid());

-- REVOKE FIRST, AND REVOKE UPDATE BY NAME. Supabase's hosted project grants
-- default privileges on new public tables to anon and authenticated, so a
-- table that only ever GRANTS leans on RLS alone for a role that should not
-- reach it at all - and, for a verb simply left OUT of the grant list, on
-- nothing whatsoever. Dropping `update` from the grant below would have
-- changed nothing on the hosted project: the default privilege had already
-- handed it over. Only this revoke takes it back.
revoke all on public.user_muted_words from public, anon;
revoke update, truncate, references, trigger
  on public.user_muted_words from authenticated;
grant select, insert, delete on public.user_muted_words to authenticated;

comment on table public.user_muted_words is
  'A per-account list of words whose presence folds a first message behind a '
  'tap on the reader''s own screen. Read only by its owner (RLS on '
  'auth.uid()). It is NOT a moderation input: no server path consults it, no '
  'verdict changes because of it, and the sender is never told it exists. '
  'Hard rule 5 is unaffected - every first message is still classified before '
  'delivery, and this layer runs after.';

comment on column public.user_muted_words.word is
  'Lower case, trimmed, single-spaced. Matched by the client '
  '(src/features/profile/muted-words.ts) on WORD BOUNDARIES in any script '
  'that has letter case, because a naive includes() folds "assist" for "ass" '
  'and reads as the app censoring people, which is worse than the problem it '
  'solves. In a script with NO letter case (Chinese, Japanese, Korean, Thai, '
  'Arabic, Hebrew, Devanagari) there is no boundary the matcher can see, so '
  'it falls through to a plain substring: right for the ones that do not '
  'space their words at all, and wider than asked for in the ones that do. '
  'The screen says both halves of that in its own hint.';
