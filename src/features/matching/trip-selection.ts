import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * Which of a person's own trips the Travelers tab is looking at.
 *
 * Founder, 2026-09-04: "users should be able to select one, multiple, or all
 * of their planned trips to be shown in the travelers section ... this is
 * just to help people narrow down where they are looking." So this is a
 * VIEW preference and nothing more: it narrows the queue the server computes
 * (get_matches takes the ids), and it changes nothing about who can see the
 * person. Their profile is shown to everyone the audience setting allows,
 * on every trip, whichever trips they are looking at.
 *
 * `null` means every trip, which is what a person gets until they choose,
 * and what they get back when their choice no longer names a trip that
 * exists. Kept on the device per account rather than in the profile row:
 * a phone-side preference has no reason to travel, and a column would have
 * been one more thing the profile's writers could get wrong.
 */
const KEY = 'samewhere.travelers.trips.v1';

export type TripSelection = string[] | null;

function keyFor(userId: string) {
  return `${KEY}:${userId}`;
}

/**
 * The selection after a tap on one trip's chip. All the way round:
 * everything -> just this one; adding the last missing one -> everything
 * again (a full hand-picked set IS every trip, and saying so keeps "All
 * trips" lit); untapping the only one left -> everything, because a queue of
 * nothing is never what a tap meant.
 */
export function toggleTrip(
  selected: TripSelection,
  tripId: string,
  allIds: string[]
): TripSelection {
  if (selected == null) {
    return [tripId];
  }
  const next = selected.includes(tripId)
    ? selected.filter((id) => id !== tripId)
    : [...selected, tripId];
  if (next.length === 0) {
    return null;
  }
  const every = allIds.every((id) => next.includes(id));
  return every ? null : next;
}

/**
 * The selection the queue should actually use: the stored ids that still
 * name one of the trips on screen. A trip that ended or was deleted drops
 * out silently, and a selection with nothing left in it is every trip.
 */
export function effectiveSelection(selected: TripSelection, allIds: string[]): TripSelection {
  if (selected == null) {
    return null;
  }
  const kept = selected.filter((id) => allIds.includes(id));
  if (kept.length === 0 || allIds.every((id) => kept.includes(id))) {
    return null;
  }
  return kept;
}

export function useTripSelection(userId: string | null) {
  // The account the stored value belongs to travels with it, so a sign-out
  // and sign-in as somebody else can never read the first person's choice:
  // until the read for THIS account lands, the answer is every trip.
  const [state, setState] = useState<{ userId: string; selected: TripSelection } | null>(null);

  useEffect(() => {
    if (userId == null) {
      return;
    }
    let active = true;
    AsyncStorage.getItem(keyFor(userId))
      .then((raw) => {
        if (!active) {
          return;
        }
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        setState({
          userId,
          selected:
            Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : null,
        });
      })
      .catch(() => {
        // A device that cannot read starts on every trip, which is the
        // default anyway.
        if (active) {
          setState({ userId, selected: null });
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const hydrated = userId == null || state?.userId === userId;
  const selected = userId != null && state?.userId === userId ? state.selected : null;

  const persist = useCallback(
    (next: TripSelection) => {
      if (userId == null) {
        return;
      }
      setState({ userId, selected: next });
      const write =
        next == null
          ? AsyncStorage.removeItem(keyFor(userId))
          : AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
      write.catch(() => {});
    },
    [userId]
  );

  // From the EFFECTIVE selection, which is what the chips show: a stored
  // set that covers every remaining trip lights "All trips", and a tap on a
  // city from there must narrow to it, not knock it out of a set nobody can
  // see.
  const toggle = useCallback(
    (tripId: string, allIds: string[]) =>
      persist(toggleTrip(effectiveSelection(selected, allIds), tripId, allIds)),
    [persist, selected]
  );
  const selectAll = useCallback(() => persist(null), [persist]);

  return { selected, hydrated, toggle, selectAll };
}
