-- Did you two actually meet? Asked once, answered privately, read by nobody
-- but the founder, in aggregate.
-- ===========================================================================
--
-- §6 counts hellos and accepts. Those two numbers can move in opposite
-- directions, and the one that decides whether the product works - did anyone
-- get a coffee out of it - is not collected anywhere. This is that number's
-- only source.
--
-- IT IS ALSO THE MOST §7-SENSITIVE THING IN THE SCHEMA SINCE SOCIAL HANDLES,
-- because "did you two meet" is one keystroke away from being a rating of a
-- person. Whatever either traveler answers must never reach the other, in any
-- form: not as an answer, not as a count, not as a badge, not as a changed
-- ordering, and not by its ABSENCE. That last one is the reciprocal-interest
-- reveal rule (§1: no blind mutual-swipe requirement, no "who liked you"),
-- and it is the one an obvious implementation gets wrong - a prompt that
-- stopped being due once the OTHER person answered would publish their answer
-- perfectly, in a boolean, without ever naming it.
--
-- So every read below is scoped to auth.uid()'s OWN row and the shared trip
-- dates both travelers already know about. Nothing in meet_prompt_due()
-- touches the other participant's answer. The pgTAP file asserts that from
-- both sides (61_did_you_two_actually_meet.test.sql).
--
-- AND THE WRITE PUBLISHES NOTHING SIDEWAYS. 20260902220000 is the cautionary
-- tale: touch_last_seen() wrote a DATE to an ungranted column and still
-- leaked a presence feed, because the write tripped profiles' updated_at
-- trigger and updated_at is client-readable. So this insert goes to a table
-- of its own, with no trigger of any kind on it, referencing chats and users
-- by foreign key only (a foreign key fires nothing on the parent). It never
-- touches chats, profiles or messages, my_chats() does not join it, and it is
-- deliberately NOT added to the supabase_realtime publication - a broadcast
-- on insert would be a live tell to anybody watching the chat's channel.
--
-- One appearance and a permanent dismissal, enforced here rather than in the
-- client: there is no update policy and no delete policy, and no grant for
-- either verb. The first answer stands forever. This is the first thing in
-- the app that asks a traveler for something rather than offering something,
-- and it gets exactly one ask.

create type public.meet_answer as enum ('yes', 'no', 'unsure');

create table public.chat_meet_answers (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  answer public.meet_answer not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- No index of its own: the primary key leads with chat_id, which is the only
-- way anything reads this table. No updated_at column and no updated_at
-- trigger, because there are no updates.

comment on table public.chat_meet_answers is
  'One traveler''s private answer to "did you two end up meeting". Readable '
  'only by its author, never by the other participant, never an input to '
  'visibility or ranking. See 20260902240000.';

-- Grants and policies -------------------------------------------------------
--
-- anon gets nothing at all, not even a policy to fail against. select and
-- insert only: an answer cannot be edited or taken back, which is what makes
-- "asked once" a fact about the database rather than a hope about the client.

alter table public.chat_meet_answers enable row level security;
revoke all on public.chat_meet_answers from anon, authenticated;
grant select, insert on public.chat_meet_answers to authenticated;

-- Your own row and nothing else. Not "rows in chats I am in" - that would
-- hand each traveler the other's answer directly.
create policy chat_meet_answers_select_own
  on public.chat_meet_answers for select to authenticated
  using (user_id = auth.uid());

-- THE ATTACK THIS REFUSES is an insert for a chat the caller is not in: the
-- row would be unreadable by them afterwards, but it would occupy the primary
-- key, and a stranger could then silence a traveler's prompt from the outside
-- (or, with a `do nothing` client, probe whether one had already answered).
-- is_chat_member() binds auth.uid() internally and takes no viewer parameter.
create policy chat_meet_answers_insert_own
  on public.chat_meet_answers for insert to authenticated
  with check (user_id = auth.uid() and public.is_chat_member(chat_id));

-- Is the question due for the caller, in this chat? ---------------------------
--
-- Definer because it reads the other participant's trips, which no traveler
-- can select directly, and caller-scoped with no viewer parameter for the
-- reason every helper in 20260816190000 carries: PostgREST exposes every
-- executable function, so a viewer argument would let any client probe
-- arbitrary pairs.
--
-- The window: the day after the last date the two of you shared, and for
-- thirty days after that. `max(least(...))` rather than an `exists` over each
-- overlapping pair, because two travelers can share more than one window and
-- the question is only fair once the LAST of them has ended - an `exists`
-- would ask somebody mid-trip about a fortnight they shared in the spring.
-- The thirty-day tail is the other half: without an upper bound, the day this
-- ships every chat any traveler ever had lights up at once, which is the
-- burst useAcceptedCelebration already paid for in a different costume.
--
-- NEVER AFTER A BAD MOMENT. A block closes the chat (sever_on_block,
-- 20260816200000), so `status = 'active'` covers it. A report does not close
-- anything, so the caller's own report of the other participant silences the
-- caller's own prompt here. Scoped to reporter_id = auth.uid() on purpose:
-- the OTHER person's report must not change what this caller sees, or the
-- prompt's absence becomes a tell that they were reported.
--
-- kind = 'direct' keeps a business out of it entirely (rule 8). A business is
-- never asked, and a traveler is never asked about one.

create function public.meet_prompt_due(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants me
      on me.chat_id = c.id and me.user_id = auth.uid()
    join public.chat_participants them
      on them.chat_id = c.id and them.user_id <> auth.uid()
    where c.id = p_chat_id
      and c.kind = 'direct'
      and c.status = 'active'
      and not exists (
        select 1 from public.reports r
        where r.reporter_id = auth.uid()
          and r.reported_user_id = them.user_id
      )
      -- The caller's OWN answer, and only ever the caller's. Reading the
      -- other participant's row here - even as a `not exists` - is how this
      -- feature would become a reciprocal-interest reveal.
      and not exists (
        select 1 from public.chat_meet_answers a
        where a.chat_id = c.id and a.user_id = auth.uid()
      )
      and (
        select max(least(mine.end_date, theirs.end_date))
        from public.trips mine
        join public.trips theirs
          on theirs.city_id = mine.city_id
         and theirs.user_id = them.user_id
         and theirs.start_date <= mine.end_date
         and mine.start_date <= theirs.end_date
        where mine.user_id = auth.uid()
          and mine.status = 'active'
          and theirs.status = 'active'
      ) between current_date - 30 and current_date - 1
  )
$$;

revoke execute on function public.meet_prompt_due(uuid) from public, anon;
grant execute on function public.meet_prompt_due(uuid) to authenticated;

comment on function public.meet_prompt_due(uuid) is
  'Whether to show the caller the meet question in this chat. Reads the '
  'caller''s own answer and the shared trip dates only - never the other '
  'participant''s answer, in either direction.';

-- Answering -------------------------------------------------------------------
--
-- SECURITY INVOKER, deliberately, so the policies above are the enforcement
-- layer and the client's write goes through exactly the door the pgTAP file
-- attacks. A definer wrapper here would have made the policy decorative.
--
-- `on conflict do nothing` is what makes a second tap a no-op instead of an
-- error, and it is safe from the usual RLS side channel for one reason worth
-- stating: the primary key is (chat_id, user_id) and the with-check pins
-- user_id to auth.uid(), so a conflicting row is ALWAYS the caller's own and
-- always visible to them. There is no arrangement in which a suppressed
-- insert reports something about somebody else.
--
-- The boolean it answers is "this is the first time", for the client's
-- analytics event. It is never a fact about the other person.

create function public.answer_meet_prompt(p_chat_id uuid, p_answer text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_rows int;
begin
  insert into public.chat_meet_answers (chat_id, user_id, answer)
  values (p_chat_id, auth.uid(), p_answer::public.meet_answer)
  on conflict (chat_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end
$$;

revoke execute on function public.answer_meet_prompt(uuid, text) from public, anon;
grant execute on function public.answer_meet_prompt(uuid, text) to authenticated;

comment on function public.answer_meet_prompt(uuid, text) is
  'Records the caller''s one answer for this chat. Answers true the first '
  'time and false every time after, and never says anything about the other '
  'participant.';

-- The reader, so this is not a table nobody reads --------------------------
--
-- Counts and months, never a chat and never a pair: the founder's question is
-- "does the product produce meetings", which is a rate, and a per-chat view
-- would be a log of who met whom. Service-role only, like every other admin_
-- view in this schema - a view recreated or created without its revoke is
-- readable by every signed-in client.
--
-- `people` alongside `answers` because one traveler answering both sides of
-- their trip is not two meetings.

create view public.admin_meet_answers as
  select
    date_trunc('month', created_at)::date as month,
    answer,
    count(*)::int as answers,
    count(distinct user_id)::int as people
  from public.chat_meet_answers
  group by 1, 2;

revoke all on public.admin_meet_answers from anon, authenticated;

comment on view public.admin_meet_answers is
  'Monthly meet answers in aggregate. Never a chat, never a pair, never a '
  'name - the rate is the metric, the row is not.';

notify pgrst, 'reload schema';
