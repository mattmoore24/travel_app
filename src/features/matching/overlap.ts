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
