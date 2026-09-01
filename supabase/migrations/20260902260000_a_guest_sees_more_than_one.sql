-- A guest sees three travelers, and none of them claims a date nobody entered
-- ===========================================================================
--
-- The Travelers tab's whole job on launch day is answering "are there people
-- here on my dates". One face cannot answer it, and dead cities are this
-- category's number one killer, so the guest branch of
-- src/app/(tabs)/travelers.tsx renders a lead card plus two rows. It has been
-- rendering them against a function that ends in `limit 1`: a screen built for
-- three, a server that has only ever returned one, and a jest suite green over
-- the gap because it handed the screen three rows itself.
--
-- THIS IS A REAL WIDENING. Three strangers' faces now reach a signed-out
-- device where one did. So every guard the previous definition carried is
-- restated here unchanged, one guard is ADDED, and what each row carries
-- shrinks:
--
--   * the approved position-0 photo `exists()`, so nobody is featured who has
--     not put a face on their own profile;
--   * `viewer_is_business()`, so a business account still reads no traveler
--     discovery surface at all (rule 8);
--   * `discovery_pair_ok(auth.uid(), t.user_id)`, which is the audience
--     setting in both directions and the one definition of "these two may see
--     each other";
--   * `is_blocked_pair(t.user_id)`, new here and explained below;
--   * `u.status = 'active'` and `p.onboarding_completed_at is not null`;
--   * the window - in town, or in town within a fortnight.
--
-- THREE THINGS THE COUNT BREAKS THAT ONE DID NOT, all fixed below.
--
-- 1. ONE PERSON COULD FILL ALL THREE SLOTS. `trips` has no unique constraint
--    on (user_id, city_id) and the cap is five active trips
--    (20260831140000:58), so a traveler with three Lisbon windows inside the
--    fortnight was three rows. Invisible under `limit 1` and fatal under
--    `limit 3`: the screen would answer "are there people here" with the same
--    face three times. Hence `distinct on (t.user_id)` in a subquery, taking
--    each traveler's soonest window. It has to be a subquery because
--    `distinct on` requires its expressions to lead the ORDER BY, and the
--    ranking below is a different order entirely (the traps skill).
--
-- 2. THE ORDER HAD NO TIEBREAK, and two callers have to agree on the SET.
--    The card and the photo are TWO separate calls to this function: the
--    client's RPC, and `featured-photo`'s own call, which it makes with the
--    CALLER's own JWT and then signs a URL for each row it gets back. (It
--    holds the service role back for the signing alone. An admin call has no
--    `sub`, so auth.uid() is null inside here and every guard below answers
--    for nobody - which is how the block filter came to be off for exactly
--    one of the two calls.) Under `limit 1` a tie could only swap which
--    single person was featured. Under `limit 3` a tie
--    between two calls means the two calls return different PEOPLE - a fourth
--    eligible traveler displaces a third - and the screen then has a card it
--    can find no face for and a face belonging to nobody on screen. The
--    seeded launch content inserts its demo trips in single statements, so
--    identical `created_at` values are the common case, not a freak. Adding
--    `f.user_id` last makes the order total, so the two calls cut the same
--    three people, and it discloses nothing: the client already receives
--    every returned user_id.
--
--    The photos are keyed BY user_id, not by list position - see
--    supabase/functions/featured-photo/index.ts. That is what keeps a face
--    off the wrong name when the two calls disagree anyway (they are seconds
--    apart, and somebody can be banned or reach the end of a trip in
--    between); this tiebreak is what keeps them from disagreeing in the first
--    place.
--
-- 3. A ROUGH TRIP WAS ABOUT TO BE PRINTED AS A FACT. See below.
--
-- WHY `is_blocked_pair` IS HERE NOW. `discovery_pair_ok` is the audience pair
-- only (20260823040000:78) and has never referred to `blocks`, so blocking
-- somebody has never taken them off this surface - and three screens promise,
-- in the user's own words, "They're gone from the map and Travelers". Under
-- `limit 1` that was one slot a blocked traveler could occupy on the one
-- Travelers surface a guest account is shown; under `limit 3` it is three.
-- The reason it was deferred was the old positional photo contract. That
-- contract is gone for bundles carrying this change - `featured-photo` now
-- returns a user_id with every URL - and NOT for the bundles already on
-- phones, which is precisely why that function still emits `urls` as well. A
-- phone reading by index is out there for at least one more launch, and on it
-- a row set one shorter than the other call's is a stranger's face under a
-- name. Two things close it, and only one of them is the new field: the photo
-- call now runs AS THE CALLER, so both calls apply this filter to the same
-- auth.uid() and cannot disagree about a block by construction; keying by
-- user_id catches whatever is left, on the bundles that have it. `blocks` is
-- caller-scoped through auth.uid(), so a signed-out visitor (uid null) is
-- unaffected and a guest ACCOUNT gets the promise the confirmation makes.
--
-- WHAT EACH ROW CARRIES, which is less than it did. Three faces was the
-- change; three of everything was not. The screen prints a bio for the lead
-- card only, and prints `languages` nowhere at all, so:
--
--   * `languages` is dropped from the signature outright. It was being handed
--     to a device with no account and read by nothing.
--   * `bio` comes back only on the FIRST row. The rows under the lead render
--     as a face, a name, an age, a seal and dates, and this makes the
--     transport say the same thing the pixels do. A screen that wants three
--     bios is a decision to hand three strangers' bios to a signed-out
--     device, and it has to come back here and make it on purpose.
--
-- HOW THE LEAD IS PICKED, and why `limit 3` is gone. A `row_number()` window
-- carrying the ranking is the function's ONE ordering now: `slot <= 3` is the
-- cut, `order by g.slot` is the order the rows come back in, and `slot = 1` is
-- the lead. The first draft of this kept `order by ... limit 3` as well and
-- repeated the ranking inside the window, so the same clause appeared twice
-- and a reader had to check both to know what the order was. One ordering,
-- written once.
--
-- WHAT THE ORDER ITSELF DISCLOSES, and why it is left as it is. Three rows in
-- a fixed order, on a function granted to `anon`, is a channel: the anon key
-- ships inside the app, so anybody can ask this for a city, get three named
-- strangers with their user_ids, and poll it. `f.hellos` leads the ranking, so
-- that order is a partial order on how many hellos each of the three received
-- in the last 30 days, and a reorder between two polls implies somebody wrote
-- to one of them.
--
-- It is not opened here. The previous definition ranked by the same count and
-- ended in `limit 1` (20260830000000:283-289), so "the most-written-to
-- traveler in this city, right now" was already being published to a
-- signed-out device and was already pollable. Three rows WIDEN a channel that
-- shipped; they do not create one. What leaves is still an order and nothing
-- else: no count, no sender, no content, no timing finer than the poll
-- interval, never who wrote to whom, and nothing at all about the person
-- looking. It is not a reciprocal-interest reveal and it is not "see who liked
-- you" (§7 rule 1) - both of those are about the viewer, and this is about
-- other people - and the order is confounded by three further keys, one of
-- which (the badge) is already on the card and two of which (the trip's
-- created_at, the user_id) carry no behaviour at all.
--
-- Widening it further is not accepted, and this is the line. The moment this
-- surface carries a COUNT, a rate, or anything a sender could recognise as
-- their own hello, the order stops being an order and becomes a score - and a
-- per-person score built from other people's behaviour is a rating of a
-- person, which §6 of the brief already rules out in as many words for the
-- meet answer. The remedy if that day comes is one line, and it is written
-- down here rather than taken: `(f.hellos > 0) desc` in place of `f.hellos
-- desc` keeps "somebody this city is actually writing to" and leaves the ORDER
-- carrying only the badge and how recently the trip was posted. It is not
-- taken today because it changes WHICH three people the launch surface
-- features, which is a product decision about the one screen whose failure
-- mode is looking empty, and that is the founder's to make rather than a
-- review round's.
--
-- Nothing here is a behavioural test of the tiebreak, and it turns out
-- nothing can be: a Postgres sort handed rows that compare equal returns them
-- in the order it received them, which is the `distinct on` subquery's
-- `order by t.user_id` - the same order `f.user_id` asks for. Deleting the
-- tiebreak changes no answer this project can produce from one session, at any
-- fixture size tried. So 10_rooms_guest_mode.test.sql asserts it against
-- pg_get_functiondef instead, and the note there says why.
--
-- ---------------------------------------------------------------------------
-- What a rough trip does here
-- ---------------------------------------------------------------------------
--
-- 20260902230000 added `trips.approximate` and wrote the rule on the column
-- itself: "anything that would state one of those dates as a FACT to another
-- person has to consult this first". It then listed featured_traveler() among
-- the readers it left untouched, because whether a rough trip counts for
-- MATCHING is a live founder question.
--
-- Both of those are still true, and they are about different things. This
-- function feeds a line that reads "In Lisbon from Sep 3" on a signed-out
-- device: one specific day, stated as a fact, about a window whose owner told
-- the app they were guessing. That is the sentence the column exists to
-- prevent, and it is already on screen.
--
-- So: the flag becomes an OUT column, and THE FLAG moves nobody. It is
-- selected and returned; it is in no predicate and in no ORDER BY, so who is
-- featured is what it would have been without it. Ranking and membership DO
-- change in this migration - twice, both above, and neither for a rough-trip
-- reason. The block filter is one. `distinct on (t.user_id)` is the other and
-- the larger: a traveler with two windows in this city was two rows and is now
-- one, so membership changes for them, and the row that survives is their
-- SOONEST window, so the `created_at` the ranking reads is that window's
-- rather than whichever of their rows would have won. Whether a rough trip is
-- matchable stays the founder's open question, and this is not the place to
-- answer it by accident. What
-- changes is that the card can say "Around Sep 3" instead of "from Sep 3",
-- which is the same choice traveler_trips() made in the same migration for the
-- same reason. Excluding rough trips instead would have been a matching
-- decision wearing a copy decision's clothes, and on the one surface whose
-- failure mode is looking empty.
--
-- Changing the OUT columns of a `RETURNS TABLE` function needs `drop function`
-- first - `create or replace` is refused, and refused after everything earlier
-- in the file has already applied (AGENTS.md, the traps skill). The drop takes
-- the grants with it, so the grant is restated below. The `distinct on`
-- subquery is the previous definition's body,
-- 20260830000000_a_business_is_served_no_travelers.sql:234-289, plus the block
-- filter; everything wrapped around it is new.

drop function if exists public.featured_traveler(int);

create function public.featured_traveler(p_city_id int)
returns table (
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  bio text,
  city_name text,
  their_start date,
  their_end date,
  photo_path text,
  approximate boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.user_id,
    g.display_name,
    g.age,
    g.verified,
    -- The lead card's bio, and nobody else's.
    case when g.slot = 1 then g.bio end as bio,
    g.city_name,
    g.their_start,
    g.their_end,
    g.photo_path,
    g.approximate
  from (
    select
      f.*,
      -- ONE ordering for the whole function: it picks the three, it names the
      -- lead, and it is the order the rows come back in. `f.user_id` last is
      -- what makes it total, so the client's call and featured-photo's cut the
      -- same three people; 10_rooms_guest_mode.test.sql asserts it is still
      -- written here, because no query this fixture can run detects its
      -- absence.
      row_number() over (
        order by f.hellos desc, f.verified desc, f.created_at desc, f.user_id
      ) as slot
    from (
      -- One row per traveler, and it is their soonest window in this city.
      select distinct on (t.user_id)
        t.user_id,
        p.display_name,
        p.age,
        p.verified,
        p.bio,
        c.name as city_name,
        t.start_date as their_start,
        t.end_date as their_end,
        (select pp.storage_path from public.profile_photos pp
          where pp.user_id = t.user_id and pp.moderation_status = 'approved'
          order by pp.position limit 1) as photo_path,
        t.approximate,
        t.created_at,
        -- The ranking: who this city is actually writing to. Computed once
        -- here rather than inside the window's ORDER BY so it is not re-run
        -- per comparison.
        (select count(*) from public.message_requests r
          where r.recipient_id = t.user_id
            and r.created_at > now() - interval '30 days') as hellos
      from public.trips t
      join public.profiles p on p.user_id = t.user_id
      join public.cities c on c.id = t.city_id
      join public.users u on u.id = t.user_id
      where t.city_id = p_city_id
        and t.status = 'active'
        and u.status = 'active'
        and p.onboarding_completed_at is not null
        and t.end_date >= current_date - 1
        and t.start_date <= current_date + 14
        and not public.viewer_is_business()
        and exists (
          select 1 from public.profile_photos pp
          where pp.user_id = t.user_id
            and pp.moderation_status = 'approved'
            and pp.position = 0
        )
        and public.discovery_pair_ok(auth.uid(), t.user_id)
        and not public.is_blocked_pair(t.user_id)
      order by t.user_id, t.start_date, t.id
    ) f
  ) g
  where g.slot <= 3
  order by g.slot
$$;

grant execute on function public.featured_traveler(int) to anon, authenticated;

comment on function public.featured_traveler(int) is
  'Up to three travelers a signed-out visitor may be shown for a city, one '
  'row each, ordered by who this city is writing to. Only the first row '
  'carries a bio. Carries whether each window is a guess, so no card states a '
  'date its owner did not.';

notify pgrst, 'reload schema';
