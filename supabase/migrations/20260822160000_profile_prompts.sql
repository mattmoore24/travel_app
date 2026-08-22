-- Travel prompts
-- ===========================================================================
--
-- The single highest-leverage thing the research turned up. A bio is a
-- paragraph people either write badly or skip; a prompt is a question with a
-- shape, and an answer to one is a thing another traveler can reply TO. The
-- comparable finding from Hinge's own data is that prompt likes convert to
-- real meetings far better than photo likes do — and this app's whole point
-- is the meeting, not the match.
--
-- Deliberately its own table rather than columns on `profiles`: the set of
-- prompts will change, three of them is not a fixed schema, and an answer is
-- a thing that gets its own reply chip, its own moderation and its own
-- lifetime.

create table public.profile_prompts (
  user_id uuid not null references public.users (id) on delete cascade,
  -- Where it sits on the page. Three is the cap, and the cap is the point:
  -- a profile that answers ten questions is a form, not a person.
  slot int not null check (slot between 0 and 2),
  -- Which question, from a list the CLIENT owns. Kept as text rather than an
  -- enum so retiring a prompt is a client release rather than a migration,
  -- and old answers stay readable either way.
  prompt_key text not null check (char_length(prompt_key) between 1 and 40),
  answer text not null check (char_length(answer) between 1 and 240),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index profile_prompts_user_idx on public.profile_prompts (user_id);

alter table public.profile_prompts enable row level security;
revoke all on public.profile_prompts from anon;
revoke truncate, references, trigger on public.profile_prompts from authenticated;

-- Visible exactly where the profile is. Same helper, so a block, a
-- suspension or a shadowban hides the prompts along with everything else
-- rather than leaving three sentences behind.
create policy profile_prompts_select_own
  on public.profile_prompts for select to authenticated
  using (user_id = auth.uid());

create policy profile_prompts_select_visible
  on public.profile_prompts for select to authenticated
  using (public.is_visible_owner(user_id));

create policy profile_prompts_write_own
  on public.profile_prompts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Broadcast text, so it goes through the same filter the bio does. Without
-- this, prompts would have been a hole straight around profile screening.
create function public.screen_prompt_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(new.answer) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger profile_prompts_screen
  before insert or update on public.profile_prompts
  for each row execute function public.screen_prompt_answer();

revoke execute on function public.screen_prompt_answer() from public, anon, authenticated;

-- Deleting an account takes its prompts with it. The cascade above does the
-- work; this comment exists so the next person auditing deletion coverage
-- does not have to re-derive it.
comment on table public.profile_prompts is
  'Up to three answered prompts per profile. Cascade-deleted with the user; '
  'visible exactly where the profile is; screened like the bio.';
