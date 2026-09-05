import type { ProfileTrip } from '@/features/profile/profile-view';
import type { TripWithCity } from '@/features/trips/api';
import type { MatchRow, TravelerTripRow } from '@/lib/database.types';

/**
 * The three ways a trip reaches a profile card, in one place.
 *
 * There were five copies of this mapping written out by hand - the traveler's
 * profile, your own profile, two on the Travelers queue and signup's review
 * step - and nothing held them to the same set of fields. This is not a bug
 * report: `approximate` has never shipped, and the copies were replaced in the
 * same change that added the column, before any of them could drop it. It is
 * the reason the copies went, which is the near miss rather than the crash.
 *
 * The near miss is worth naming precisely, because it is the shape this file
 * exists to make impossible. `traveler_trips()` gains an OUT column in
 * 20260902230000; ProfileTrip carries it; a stranger's card reads "Around Sep
 * 1 - 30" instead of printing a guess as a fact. Five hand-written mappings is
 * five places to remember that, and a card that quietly kept the old shape
 * would not have failed - it would have read as a claim about somebody's
 * dates, on somebody else's screen, with nothing to show it was wrong.
 *
 * Adding a field here reaches every screen at once, which is the property
 * that was missing.
 */

/** A row from traveler_trips(): somebody's plans as a reader is shown them. */
export function profileTripFromTravelerRow(row: TravelerTripRow): ProfileTrip {
  return {
    id: row.trip_id,
    cityId: row.city_id,
    cityLabel: `${row.city_name}, ${row.city_country}`,
    startDate: row.start_date,
    endDate: row.end_date,
    approximate: row.approximate,
  };
}

/** A row from fetchMyTrips(): your own plans, read straight off the table. */
export function profileTripFromOwnTrip(trip: TripWithCity): ProfileTrip {
  return {
    id: trip.id,
    cityId: trip.city_id,
    cityLabel: `${trip.cities.name}, ${trip.cities.country_name}`,
    startDate: trip.start_date,
    endDate: trip.end_date,
    approximate: trip.approximate,
  };
}

/**
 * A row from get_matches(): the queue's own answer, shown for the beat before
 * `traveler_trips` replies.
 *
 * The fifth copy, and the one that read as an exception because it is one.
 * `MatchRow` has no `approximate` column - get_matches was left untouched by
 * 20260902230000 on purpose, because whether a rough trip counts for matching
 * at all is a founder decision that has not been made (docs/UX_PACKAGES.md,
 * "Waits on") - and there is no way to invent the flag here from a column that
 * does not exist. So it is absent rather than false: a rough window reads
 * exact for one render and then corrects itself when the real answer lands,
 * instead of being asserted from nothing.
 *
 * It lives here anyway, and that is the point of the file. A mapping written
 * out at the call site is a mapping the next column will not reach.
 */
export function profileTripFromMatchRow(match: MatchRow): ProfileTrip {
  return {
    id: match.trip_id,
    cityId: match.city_id,
    cityLabel: `${match.city_name}, ${match.city_country}`,
    startDate: match.their_start,
    endDate: match.their_end,
    approximate: undefined,
  };
}
