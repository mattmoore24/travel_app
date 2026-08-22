-- The daily spotlight
-- ===========================================================================
--
-- One traveler at the top of the Travelers tab each day — and, crucially,
-- shown to BOTH people the same day. That mutual visibility is the whole
-- mechanism: a recommendation only one side can see is a recommendation
-- nobody acts on, because the person who acts has no reason to expect a
-- warmer reception than usual. Surfaced to both, it is a shared prompt.
--
-- Ranked on overlap length, shared languages, how complete both profiles
-- are, and whether both are verified. Never on appearance, and there is no
-- photo input anywhere in the score.

create table public.daily_spotlights (
  day date not null default current_date,
  -- Canonically ordered (user_a < user_b) so a pair can only ever exist
  -- once per day, whichever side asked first.
  user_a uuid not null references public.users (id) on delete cascade,
  user_b uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (day, user_a, user_b),
  constraint daily_spotlights_ordered check (user_a < user_b)
);

-- One spotlight per person per day, from either side of the pair.
create unique index daily_spotlights_a_idx on public.daily_spotlights (day, user_a);
create unique index daily_spotlights_b_idx on public.daily_spotlights (day, user_b);

alter table public.daily_spotlights enable row level security;
revoke all on public.daily_spotlights from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
--
-- Symmetric by construction: every term is a fact about the PAIR or a sum
-- over both profiles, so score(a,b) = score(b,a). That is what lets the same
-- pairing be the right answer for whichever of the two asks first.

create function public.spotlight_score(
  p_overlap_days int,
  p_shared_languages int,
  p_both_verified boolean,
  p_completeness int
)
returns int
language sql
immutable
as $$
  select
    -- Time together is the thing that actually produces a meeting, so it
    -- carries the most weight — capped, because three weeks and three months
    -- are not meaningfully different for arranging one coffee.
    least(p_overlap_days, 21) * 4
    + least(p_shared_languages, 3) * 6
    + case when p_both_verified then 12 else 0 end
    + p_completeness
$$;

comment on function public.spotlight_score(int, int, boolean, int) is
  'Symmetric pair score for the daily spotlight. No appearance input, by '
  'design and by review.';

-- ---------------------------------------------------------------------------
-- The spotlight itself
-- ---------------------------------------------------------------------------
--
-- Volatile: the FIRST of the two to ask creates the pairing, and the other
-- one inherits it. That is what makes it mutual without a stable-matching
-- pass — and the unique indexes above are what make the race safe, since a
-- concurrent second insert simply loses and re-reads.

create function public.daily_spotlight()
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  languages text[],
  bio text,
  occupation text,
  city_name text,
  overlap_start date,
  overlap_end date,
  photo_path text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Already paired today, from either side.
  select case when s.user_a = v_me then s.user_b else s.user_a end
  into v_other
  from public.daily_spotlights s
  where s.day = current_date and (s.user_a = v_me or s.user_b = v_me);

  if v_other is null then
    select m.user_id into v_other
    from public.get_matches() m
    join public.profiles p on p.user_id = m.user_id
    join public.profiles me on me.user_id = v_me
    where
      -- Never somebody already spoken for today, on either side.
      not exists (
        select 1 from public.daily_spotlights s
        where s.day = current_date and (s.user_a = m.user_id or s.user_b = m.user_id)
      )
      -- Never somebody there is nothing left to start.
      and not public.has_accepted_chat(m.user_id)
      and not exists (
        select 1 from public.message_requests r
        where r.sender_id = v_me and r.recipient_id = m.user_id
      )
    order by
      public.spotlight_score(
        (m.overlap_end - m.overlap_start + 1)::int,
        (select count(*)::int from unnest(p.languages) l
          where l = any(me.languages)),
        p.verified and me.verified,
        (case when p.bio is not null then 4 else 0 end)
          + (case when me.bio is not null then 4 else 0 end)
          + (case when p.occupation is not null then 2 else 0 end)
          + (case when me.occupation is not null then 2 else 0 end)
      ) desc,
      -- Deterministic, and different every day, so a tie does not pin the
      -- same person to the top of the tab all week.
      md5(least(v_me::text, m.user_id::text) || greatest(v_me::text, m.user_id::text)
          || current_date::text)
    limit 1;

    if v_other is null then
      return;
    end if;

    begin
      insert into public.daily_spotlights (day, user_a, user_b)
      values (current_date, least(v_me, v_other), greatest(v_me, v_other));
    exception when unique_violation then
      -- Somebody claimed one of us in the moment between the select and the
      -- insert. Re-read rather than guess; there may now be no pairing at
      -- all today, which is a legitimate answer.
      select case when s.user_a = v_me then s.user_b else s.user_a end
      into v_other
      from public.daily_spotlights s
      where s.day = current_date and (s.user_a = v_me or s.user_b = v_me);
      if v_other is null then
        return;
      end if;
    end;
  end if;

  -- Read back through get_matches so the row carries the same overlap the
  -- rest of the tab shows, and so a pairing whose trip has since been
  -- cancelled quietly returns nothing instead of a stale card.
  return query
  select
    m.user_id, m.display_name, m.age, m.verified, m.languages, m.bio,
    m.occupation, m.city_name, m.overlap_start, m.overlap_end, m.photo_path
  from public.get_matches() m
  where m.user_id = v_other
  order by m.overlap_start
  limit 1;
end;
$$;

revoke execute on function public.daily_spotlight() from public, anon;
grant execute on function public.daily_spotlight() to authenticated;

-- Yesterday's pairings are dead weight; the sweep runs with the other
-- expiries rather than as its own schedule.
create or replace function public.expire_daily_spotlights()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with gone as (
    delete from public.daily_spotlights
    where day < current_date - 7
    returning 1
  )
  select count(*)::int from gone
$$;

revoke execute on function public.expire_daily_spotlights() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-daily-spotlights', '15 3 * * *',
                          'select public.expire_daily_spotlights()');
  end if;
end
$$;
