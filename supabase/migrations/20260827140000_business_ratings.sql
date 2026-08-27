-- Business accounts, part 5: ratings, Beli-style
-- ===========================================================================
--
-- docs/BUSINESS_ACCOUNTS.md §3.10. This reverses a refusal in the first
-- draft, and the reason it reverses is specific: the extortion lever in
-- reviews is the TEXT. "Give me a free room or I post that the staff were
-- rude" only works if there is somewhere to post it, and there is no free
-- text anywhere in this design. What a disgruntled traveler can do is place
-- one hostel below another inside their own private list, which moves an
-- aggregate by a fraction.
--
-- **[founder]** "Anyone can rate any place, Samewhere shouldn't gate keep
-- this. People may have been there before and just not entered the trip on
-- Samewhere." So there is no verified-only gate and no presence requirement.
-- Guests still cannot, for the same reason they cannot write anything else:
-- an anonymous session is not an identity, and a rating from one is a rating
-- from nobody.

create type public.rating_bucket as enum ('not_for_me', 'fine', 'loved');

/**
 * Fixed vocabulary, no free entry.
 *
 * This is what replaces a review box, and the fixed list is the whole point:
 * there is nothing to moderate and nothing to extort with.
 */
create type public.rating_tag as enum (
  'good_for_meeting_people', 'cheap', 'quiet', 'lively', 'late',
  'good_coffee', 'worth_the_trip'
);

create table public.business_ratings (
  user_id uuid not null references public.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Copied at write time so comparisons stay within a category even if the
  -- business later recategorises itself. "Did you prefer this hostel or this
  -- cocktail bar" is not a question with an answer.
  category public.business_category not null,
  bucket public.rating_bucket not null,
  /**
   * Where it sits inside the bucket, 0 (bottom) to 1 (top).
   *
   * The client runs the binary search over the caller's own ranked list -
   * tens of rows, all their own data - and sends back the midpoint it
   * arrived at. The server validates the range and derives the score, so a
   * hand-made request can move one place inside its bucket and can never
   * put a 10 on something it marked "not for me".
   */
  rank double precision not null check (rank >= 0 and rank <= 1),
  score numeric(3, 1) not null,
  tags public.rating_tag[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create index business_ratings_business_idx on public.business_ratings (business_id);
create index business_ratings_mine_idx on public.business_ratings (user_id, category, score desc);

alter table public.business_ratings enable row level security;
revoke all on public.business_ratings from anon, authenticated;
grant select on public.business_ratings to authenticated;

-- Your own row and nobody else's. A business must never be able to reach
-- user_id from its own id, which is the anti-retaliation control and the
-- reason there is no policy here that reads business_id alone.
create policy business_ratings_select_own
  on public.business_ratings for select to authenticated
  using (user_id = auth.uid());

/** Each bucket owns a band of the 0-10 scale; rank picks the point inside it. */
create function public.rating_score(p_bucket public.rating_bucket, p_rank double precision)
returns numeric
language sql
immutable
as $$
  select round((
    case p_bucket
      when 'not_for_me' then 0.0 + 3.3 * p_rank
      when 'fine' then 3.4 + 3.2 * p_rank
      else 6.7 + 3.3 * p_rank
    end
  )::numeric, 1)
$$;

/**
 * Rate a place, or move one you already rated.
 *
 * Nothing here asks whether you were in the city. Somebody who stayed in a
 * hostel in 2024, before they had this app, has a better-informed opinion
 * than somebody who joined its chat yesterday, and the app should not be in
 * the business of refusing that.
 */
create function public.rate_business(
  p_business_id uuid,
  p_bucket public.rating_bucket,
  p_rank double precision,
  p_tags public.rating_tag[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_category public.business_category;
  v_score numeric;
  v_today int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_guest_account(v_user) then
    raise exception 'make an account first' using errcode = '42501';
  end if;
  -- Rule 8, and the specific thing it stops here: a bar ranking a rival down.
  if public.is_business_account(v_user) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'place not found';
  end if;
  if p_rank < 0 or p_rank > 1 then
    raise exception 'that is not a position in the list';
  end if;
  if array_length(p_tags, 1) > 3 then
    raise exception 'three tags is plenty';
  end if;

  select count(*) into v_today from public.business_ratings
   where user_id = v_user and updated_at > now() - interval '24 hours';
  if v_today >= 20 then
    raise exception 'that is as many places as you can rate today';
  end if;

  select category into v_category from public.businesses where id = p_business_id;
  v_score := public.rating_score(p_bucket, p_rank);

  insert into public.business_ratings
    (user_id, business_id, category, bucket, rank, score, tags)
  values (v_user, p_business_id, v_category, p_bucket, p_rank, v_score, coalesce(p_tags, '{}'))
  on conflict (user_id, business_id) do update
    set category = excluded.category,
        bucket = excluded.bucket,
        rank = excluded.rank,
        score = excluded.score,
        tags = excluded.tags,
        updated_at = now();

  return jsonb_build_object('score', v_score);
end
$$;

revoke execute on function
  public.rate_business(uuid, public.rating_bucket, double precision, public.rating_tag[])
from public, anon;

/**
 * The caller's own ranked list in one category, which is what the
 * head-to-head cards are drawn from.
 *
 * Their own data, tens of rows, so the binary search runs client-side and
 * the server only validates where it landed.
 */
create function public.my_ratings(p_category public.business_category)
returns table (business_id uuid, name text, bucket public.rating_bucket, score numeric)
language sql
stable
security definer
set search_path = public
as $$
  select r.business_id, b.name, r.bucket, r.score
  from public.business_ratings r
  join public.businesses b on b.id = r.business_id
  where r.user_id = auth.uid() and r.category = p_category
  order by r.score desc
$$;

revoke execute on function public.my_ratings(public.business_category) from public, anon;

/**
 * What a place's page shows.
 *
 * SECURITY DEFINER and returning NULLS below the threshold, rather than the
 * client hiding a number it was given: a count gate the client enforces is a
 * count gate anybody can read around. Five raters, mirroring the heatmap's
 * k-threshold instinct - a 9.2 from one person is noise wearing a number.
 *
 * The business sees its score, its count and its tags through this same
 * function, and nothing anywhere returns WHO rated it.
 */
create function public.business_rating_summary(p_business_id uuid)
returns table (average numeric, rater_count int, top_tags public.rating_tag[])
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select * from public.business_ratings where business_id = p_business_id
  ),
  counted as (select count(*)::int as n from r)
  select
    case when (select n from counted) >= 5
      then round(avg(r.score), 1) else null end,
    (select n from counted),
    case when (select n from counted) >= 5 then (
      select array_agg(t.tag order by t.uses desc, t.tag)
      from (
        select tag, count(*) as uses
        from r, unnest(r.tags) as tag
        group by tag
        order by uses desc, tag
        limit 3
      ) t
    ) else null end
  from r
$$;

grant execute on function public.business_rating_summary(uuid) to anon, authenticated;

comment on function public.business_rating_summary(uuid) is
  'Average, count and top three tags, with the average and tags NULL below '
  'five raters. Definer and null-returning rather than client-filtered, '
  'because a threshold the client enforces is one anybody can read around.';

/**
 * Somebody's best places in a city, for their profile.
 *
 * The pair with Top priorities is the point: been, against want.
 */
create function public.top_rated_by(p_user_id uuid, p_city_id int default null)
returns table (business_id uuid, name text, category public.business_category, score numeric)
language sql
stable
security definer
set search_path = public
as $$
  select r.business_id, b.name, b.category, r.score
  from public.business_ratings r
  join public.businesses b on b.id = r.business_id
  where r.user_id = p_user_id
    and r.bucket = 'loved'
    and public.is_visible_business(b.id)
    and (p_city_id is null or b.city_id = p_city_id)
    -- Exactly where the profile is visible, never more: a shadowbanned or
    -- blocked traveler's shelf goes with the rest of their page.
    and (p_user_id = auth.uid() or public.is_visible_owner(p_user_id))
  order by r.score desc
  limit 5
$$;

revoke execute on function public.top_rated_by(uuid, int) from public, anon;
