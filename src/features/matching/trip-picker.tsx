import { ChipRail, type ChipOption } from '@/components/form/chip-rail';
import type { TripWithCity } from '@/features/trips/api';
import { formatDate, formatMonth, formatTripDates, roughWhen } from '@/features/trips/dates';

import type { TripSelection } from '@/features/matching/trip-selection';

/**
 * The row of trip chips at the top of Travelers: which of your trips the
 * queue is built from. "All trips" first, then one chip per upcoming trip
 * in start-date order. The same ChipRail the pin form, add-trip and the map
 * filter use, so it is a control the person has already tapped.
 *
 * "All trips" is a zero state, not a tick on everything: from it, one tap
 * on a city narrows the queue to that one trip, which is the case the
 * founder described ("which city is showing in the traveler section").
 *
 * The chip says the city and nothing else. People think in cities; the
 * dates are spoken to VoiceOver and shown on the empty wall, and a second
 * line on every chip would put the rail's height above every face. When
 * two upcoming trips share a city the chips carry the start month, and the
 * day when the month repeats too.
 *
 * DELIBERATELY NOT HERE, from the design panel that chose this shape:
 * - a sheet or picker: a trip needs no second line of explanation, and a
 *   sheet turns a glance-and-tap into open, pick, close;
 * - an "All" chip that lights together with every trip: that makes "just
 *   Lisbon" cost N-1 taps, which is the founder's own case;
 * - dates or people counts on the visible chips: people think in cities,
 *   and a number on a dark chip is a promise made before the tap;
 * - a "now" or "here" mark on a trip in progress: a presence claim the app
 *   cannot verify (rule 2);
 * - automatic widening when a new trip is added while narrowed: the new
 *   chip is visible next to the lit ones, and the wall says the scope.
 */
export const ALL_TRIPS = 'all';

/** Every sentence a chip says, in one place, so a test can read the real ones. */
export const TRIP_CHIP_STRINGS = {
  all: 'All trips',
  allHint: 'Shows travelers for every trip.',
  /** From All trips: a tap narrows to this one, which hides the others. */
  narrowHint: 'Looks at just this trip.',
  dropHint: 'Stops looking at this trip.',
  addHint: "Adds this trip to the ones you're looking at.",
} as const;

/** Chip labels by trip id: the city, disambiguated only as far as it has to be. */
export function tripChipLabels(trips: readonly TripWithCity[]): Map<string, string> {
  const byCity = new Map<string, TripWithCity[]>();
  for (const trip of trips) {
    const list = byCity.get(trip.cities.name) ?? [];
    list.push(trip);
    byCity.set(trip.cities.name, list);
  }
  const labels = new Map<string, string>();
  for (const [city, list] of byCity) {
    if (list.length === 1) {
      labels.set(list[0].id, city);
      continue;
    }
    const byMonth = new Map<string, TripWithCity[]>();
    for (const trip of list) {
      const month = formatMonth(trip.start_date);
      byMonth.set(month, [...(byMonth.get(month) ?? []), trip]);
    }
    for (const [month, sameMonth] of byMonth) {
      for (const trip of sameMonth) {
        labels.set(
          trip.id,
          sameMonth.length === 1 ? `${city} · ${month}` : `${city} · ${formatDate(trip.start_date)}`
        );
      }
    }
  }
  return labels;
}

/** What VoiceOver says for a chip: the city and when, with no day invented for rough dates. */
export function tripSpokenLabel(trip: TripWithCity): string {
  const when = trip.approximate
    ? `sometime ${roughWhen(trip.start_date, trip.end_date)}`
    : formatTripDates(trip.start_date, trip.end_date);
  return `${trip.cities.name}, ${when}`;
}

export function TripPicker({
  trips,
  selected,
  onToggle,
  onAll,
}: {
  trips: readonly TripWithCity[];
  /** null is every trip. */
  selected: TripSelection;
  onToggle: (tripId: string) => void;
  onAll: () => void;
}) {
  const labels = tripChipLabels(trips);
  const options: ChipOption<string>[] = [
    {
      value: ALL_TRIPS,
      label: TRIP_CHIP_STRINGS.all,
      accessibilityHint: TRIP_CHIP_STRINGS.allHint,
      testID: 'trip-chip-all',
    },
    ...trips.map((trip) => ({
      value: trip.id,
      label: labels.get(trip.id) ?? trip.cities.name,
      accessibilityLabel: tripSpokenLabel(trip),
      // Said by state, because the same tap does three different things:
      // from All trips it narrows to this one (and so hides the others),
      // on a lit chip it drops this trip, on a dark one it adds it. Each
      // sentence is true for exactly the tap it describes, and none can be
      // heard as deleting the trip.
      accessibilityHint:
        selected == null
          ? TRIP_CHIP_STRINGS.narrowHint
          : selected.includes(trip.id)
            ? TRIP_CHIP_STRINGS.dropHint
            : TRIP_CHIP_STRINGS.addHint,
      testID: `trip-chip-${trip.id}`,
    })),
  ];
  return (
    <ChipRail
      multi
      options={options}
      selected={selected == null ? [ALL_TRIPS] : selected}
      onToggle={(value) => (value === ALL_TRIPS ? onAll() : onToggle(value))}
    />
  );
}
