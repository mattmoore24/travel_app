import { addDays, formatDate, toISODate } from '@/features/trips/dates';

/**
 * How far out the picker opens when there is no trip to take the answer from.
 *
 * Thirty days is the number the two group screens already used. It is a
 * placeholder and it always was — it means nothing to anybody — which is
 * exactly why the trip is preferred over it whenever there is one.
 */
export const FALLBACK_END_DAYS = 30;

/**
 * The least a trip has to carry for this to work.
 *
 * Structural on purpose: `useMyTrips()` hands back a whole row joined to its
 * city, and none of the rest of it is any of this function's business.
 */
export type TripSeed = {
  start_date: string;
  end_date: string;
  cities?: { name: string } | null;
};

export type EndDateSeed = {
  /** YYYY-MM-DD, ready for the picker and for toISODate's round trip. */
  iso: string;
  /**
   * The city the day came from, or null when it came from the fallback. The
   * row is labelled with the city when there is one, because "Lisbon, Mar 9"
   * reads as an answer and a bare "Mar 9" reads as a guess.
   */
  cityName: string | null;
};

/**
 * The day to open "Pick a day" on: the end of the trip you are on, or of the
 * next one you have planned.
 *
 * A group is nearly always trip-shaped — the dorm you are in, the hike on
 * Sunday, the people you met on Tuesday — so the end of the trip is the answer
 * most groups actually want, and it costs one tap instead of a scroll through
 * a picker from a number nobody chose.
 *
 * This changes the OFFER only. "No end date" stays selected and stays the
 * default; all this decides is what the other option is prefilled with.
 *
 * Trips already finished are ignored: `useMyTrips` filters them out server
 * side, and a helper that trusted its input to be filtered would seed a group
 * with a day in the past the first time somebody passed it a raw list.
 */
export function seedEndDate(trips: TripSeed[] | undefined, today = new Date()): EndDateSeed {
  const iso = toISODate(today);
  const live = trips?.filter((trip) => trip.end_date >= iso) ?? [];
  // The trip you are on wins over the trip you are going on next, and the
  // sort makes "next" mean next rather than whatever the query returned
  // first. String comparison is safe and exact here: these are ISO dates.
  const sorted = [...live].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const current = sorted.find((trip) => trip.start_date <= iso);
  const chosen = current ?? sorted[0];
  if (!chosen) {
    return { iso: toISODate(addDays(today, FALLBACK_END_DAYS)), cityName: null };
  }
  return { iso: chosen.end_date, cityName: chosen.cities?.name ?? null };
}

/**
 * What the "Pick a day" row says once a day is on it.
 *
 * With a city, the row says where the day came from; without one it is just
 * the day. Never the word "trip" — the sentence has to work when the group is
 * not about the trip at all, and the city and the date already say enough.
 */
export function endDateLabel(seed: EndDateSeed | null): string {
  if (!seed) {
    return 'Pick a day';
  }
  const day = formatDate(seed.iso);
  return seed.cityName ? `${seed.cityName}, ${day}` : day;
}
