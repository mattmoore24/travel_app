-- A hello says where and when
--
-- The card a recipient decides on carried a face, a name, an age, an anchor
-- and 500 characters of message, and not one word about the thing the whole
-- product is built on: the city the two of you share and the dates you share
-- it. That fact was already on the sender's side of the screen (Travelers
-- prints "Both in Lisbon 3 to 8 Sep" on the very card the hello was sent
-- from) and it was thrown away in transit.
--
-- incoming_requests() gains three OUT columns. Three, not one, so the client
-- can build the same sentence Travelers builds instead of a second, drifting
-- one.
--
-- Two rules govern the shape of this:
--
--   * OUT columns cannot be added with `create or replace` on a
--     `RETURNS TABLE` function. Postgres refuses, and it refuses AFTER the
--     earlier statements of the migration have applied. So: drop first, and
--     restate the revoke the drop took with it.
--   * The function stays SECURITY INVOKER. It is the recipient's own
--     credentials that read the sender's trips, so `trips_select_overlap`
--     (20260816200000_trips_matching.sql) is the gate: a genuine city+date
--     overlap with one of the reader's own active trips, an owner who is
--     discoverable, and no block either way. A hello that came from a pin
--     rather than a trip match therefore returns three nulls, the card draws
--     no chip, and nothing about the sender's travel plans leaks. That is the
--     correct answer, not a gap.

drop function public.incoming_requests();

create function public.incoming_requests()
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
  order by r.created_at desc
$$;

-- The drop took the grants with it. Restate exactly what
-- 20260816200000_trips_matching.sql:728-734 said: nobody signed out, and the
-- default privilege the authenticated role already holds.
revoke execute on function public.incoming_requests() from public, anon;
