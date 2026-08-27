-- Top priorities
-- ===========================================================================
--
-- Up to six very short things a traveler wants to do out there. Founder
-- request; design in docs/TOP_PRIORITIES.md.
--
-- Why this is its own table and not another prompt: everything else on a
-- profile describes a PERSON, and trips describe a PLACE AND A WINDOW. This is
-- the only section that describes a PLAN, and a plan is the one thing a
-- stranger can say yes to without having to be charming first. Each entry is a
-- tappable RSVP that opens the composer anchored to it.
--
-- Modelled on profile_prompts down to the slot column, because that table has
-- already answered every question this one raises.

create table public.profile_priorities (
  user_id uuid not null references public.users (id) on delete cascade,
  -- Six, and the cap is enforced by the PRIMARY KEY rather than by a count
  -- trigger or by the client. There is no sequence of inserts that produces a
  -- seventh row, which is a stronger guarantee than any check the app makes.
  slot int not null check (slot between 0 and 5),
  -- A few words. Forty admits every real entry ("hike the Seven Hanging
  -- Valleys" is thirty) and refuses the shortest complete sentence ("I really
  -- want to see the old town at night" is forty-three). It is also the width
  -- that keeps a chip readable: the chip wraps rather than truncates, because
  -- half a plan is worse than no plan.
  text text not null check (char_length(text) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index profile_priorities_user_idx on public.profile_priorities (user_id);

alter table public.profile_priorities enable row level security;
revoke all on public.profile_priorities from anon;
revoke truncate, references, trigger on public.profile_priorities from authenticated;

-- Visible exactly where the profile is. Same helper as prompts and photos, so
-- a block, a suspension, a shadowban or the audience filter hides the list
-- along with everything else rather than leaving six plans behind.
create policy profile_priorities_select_own
  on public.profile_priorities for select to authenticated
  using (user_id = auth.uid());

create policy profile_priorities_select_visible
  on public.profile_priorities for select to authenticated
  using (public.is_visible_owner(user_id));

create policy profile_priorities_write_own
  on public.profile_priorities for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Broadcast text, so it goes through the same filter the bio and the prompts
-- do. Forty characters is plenty of room for a handle, a phone number or an
-- invitation off-platform, so this is not ceremony.
create function public.screen_priority_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(new.text) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger profile_priorities_screen
  before insert or update on public.profile_priorities
  for each row execute function public.screen_priority_text();

revoke execute on function public.screen_priority_text() from public, anon, authenticated;

comment on table public.profile_priorities is
  'Up to six short plans per profile, ordered by slot. Cascade-deleted with '
  'the user; visible exactly where the profile is; screened like the bio. '
  'One list per profile, not per trip (docs/TOP_PRIORITIES.md D1) - a '
  'nullable trip_id can be added later with no backfill.';
