import { formatDateRange } from '@/features/trips/dates';

/**
 * The one sentence that says why two travelers are on the same screen.
 *
 * "Both in Lisbon Sep 3 - 8". It is the whole premise of the product, and
 * until this file existed it was written out by hand in three places: the
 * pill over a traveler's photo, the anchor quoted into a first message, and
 * (not at all) the card a hello is answered on. Three copies of one sentence
 * is three chances for the two surfaces to say it differently about the same
 * pair of people, which is exactly the drift the shared builder closes.
 *
 * A city may arrive as "Bangkok, Thailand" (the profile's trip label) or as
 * "Bangkok" (the RPC's city name). Only the city survives: "Both in Bangkok,
 * Thailand Aug 23 - 28" wraps to two lines on a phone.
 *
 * IT STATES EXACT DAYS ABOUT A WINDOW THAT MAY BE A GUESS, and that is
 * recorded here rather than fixed, because fixing it on one surface would be
 * worse than not fixing it. Three surfaces print this sentence and they know
 * different things:
 *
 *   Travelers   get_matches() has no `approximate` OUT column. It was left
 *               without one deliberately - 20260902230000's header records
 *               that whether a rough trip counts for matching at full weight,
 *               is de-ranked, or is excluded from the overlap query at all is
 *               an open founder decision (docs/UX_PACKAGES.md,
 *               prof-rough-trip-dates "Waits on"), and the answer decides how
 *               wide a rough window's read access to other people's trips is.
 *               Adding the column now would answer half of that by implication.
 *   The hello   The request row carries the overlap city and dates and no flag
 *               either, for the same reason.
 *   A profile   ProfileTrip DOES carry it, since traveler_trips() gained the
 *               column.
 *
 * So the only surface that could hedge is the one a reader reaches LAST, and
 * a hedge there alone is the exact drift this file exists to close: the same
 * pair of people told "Both in Lisbon Sep 3 - 8" on the queue and "roughly Sep
 * 3 - 8" on the profile, disagreeing about how much to believe.
 *
 * And even that surface knows only half. The window printed here is an
 * INTERSECTION of two trips, and the reader's own may be the rough one. A
 * hedge needs both flags; one flag would put "roughly" on some exact overlaps
 * and leave it off some guessed ones, which is a worse sentence than the
 * unhedged one because it reads as though it had been checked.
 *
 * Hedge it when get_matches answers the founder question and carries the flag,
 * and hedge all three at once. Tracked in docs/PROGRESS.md.
 */
export function overlapSentence(
  city: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined
): string | null {
  if (!city || !start || !end) {
    return null;
  }
  const place = city.split(',')[0].trim();
  if (!place) {
    return null;
  }
  return `Both in ${place} ${formatDateRange(start, end)}`;
}
