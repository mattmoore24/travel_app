/**
 * What the three within-trip clocks say.
 *
 * The strings themselves are composed in SQL, because the clocks run on a
 * schedule with no app anywhere near them (20260902040000). They are written
 * here as well for one reason: a sentence that lands on a lock screen is copy,
 * and copy in this project is reviewed against the design brief before it
 * ships. src/features/notifications/__tests__/trip-clocks-copy.test.ts holds
 * these to the same vocabulary rules as every other user-facing string AND
 * asserts that the migration still says exactly this, so the two cannot drift.
 *
 * Three rules they all obey, beyond the banned words:
 *
 *   1. NO PRESENCE CLAIM. "there on your dates" is about a city on a date
 *      range, which is what this app knows. "near you" and "here now" are
 *      claims it must never make (hard rule 2).
 *   2. NO INVENTED PRECISION. A pin carries a date and not a time, so the
 *      plan clock says "today" and never "at 8".
 *   3. THE COUNT IS GATED. tripStartsTomorrow takes the count only when the
 *      city's heat_k allows it; the caller that decides is the SQL, and the
 *      no-number sentence below is what it sends otherwise. Hard rule 6 is
 *      about a disclosure, not about a rendering.
 */

/** Title for the trip clock: the city, and when. */
export function tripStartsTomorrowTitle(city: string): string {
  return `${city} tomorrow`;
}

/**
 * Body for the trip clock.
 *
 * `overlap` is null whenever the count is below the city's k-threshold, and
 * the sentence then carries no number at all. Not a smaller number, not "a
 * few": either the count clears the floor or population is not mentioned.
 */
export function tripStartsTomorrowBody(overlap: number | null): string {
  if (overlap == null) {
    return 'Your trip starts tomorrow. See who else has the same dates.';
  }
  return `${overlap} travelers are there on your dates.`;
}

/** How many people are in a plan, in the one phrasing both clocks use. */
function peopleIn(going: number): string {
  return going === 1 ? '1 person is in.' : `${going} people are in.`;
}

/** Body for the plan clock, a few hours before the evening it is about. */
export function planIsSoonBody(going: number): string {
  return `Happening today. ${peopleIn(going)}`;
}

/**
 * Body for the last call, four hours before the pin expires.
 *
 * `closesAt` is the city's own wall clock as HH:MM, the same longitude
 * approximation the business hours line already ships with.
 */
export function lastCallBody(closesAt: string, going: number): string {
  return `Closing at ${closesAt}. ${peopleIn(going)}`;
}
