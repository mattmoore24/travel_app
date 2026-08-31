import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';

// v2: the value is a TIMESTAMP and the key carries the account. v1 stored a
// bare '1' under a device-wide key, which made "re-arm after 60 days"
// inexpressible and let a guest-then-signup on one phone inherit the other
// identity's dismissals. Old v1 values are simply orphaned: everyone reads
// each legend once more, which is the cheaper wrong.
const KEY = 'samewhere.heat.legend.v2';
const PLACES_KEY = 'samewhere.places.legend.v2';
const EMPTY_KEY = 'samewhere.heat.empty.v2';

/** A dismissal older than this has been forgotten anyway; say it again. */
export const LEGEND_REARM_MS = 60 * 24 * 3_600_000;

/** The stored key for one legend, scoped to whoever is signed in. */
export function legendKey(base: string, userId: string | null): string {
  return `${base}.${userId ?? 'anon'}`;
}

/**
 * Whether a stored dismissal still holds. A timestamp inside the re-arm
 * window does; an older one has expired; an unreadable value counts as never
 * dismissed, which costs one extra read and then overwrites itself.
 */
export function legendDismissed(stored: string | null, nowMs: number): boolean {
  if (stored == null) {
    return false;
  }
  const at = Date.parse(stored);
  if (Number.isNaN(at)) {
    return false;
  }
  return nowMs - at < LEGEND_REARM_MS;
}

/**
 * Whether the "what are these glowing patches" chip still needs showing.
 *
 * The heat layer is the one thing on the map with no label, no marker and no
 * tap target, so the first time somebody sees it they have to guess. One
 * sentence, once per five dozen days — a legend that keeps reappearing is
 * furniture, not an explanation.
 */
export function useHeatLegend(hasHeat: boolean) {
  return useOneShotLegend(KEY, hasHeat);
}

/**
 * The same one-shot chip for the place markers.
 *
 * They arrived on an existing map as a family of unexplained grey dots
 * underneath the amber pins, with no callout, no name and no legend, so the
 * first time somebody opened the app after the release there was nothing at
 * all telling them what they were looking at.
 */
export function usePlacesLegend(hasPlaces: boolean) {
  return useOneShotLegend(PLACES_KEY, hasPlaces);
}

/**
 * The honest third state: the heat query SETTLED and came back empty. Its
 * own key, separate from the glow explanation — somebody who dismisses "not
 * busy enough yet" on a quiet Tuesday has not read the sentence that
 * explains an actual glow, and must still get that one when it first shows.
 */
export function useHeatEmptyLegend(active: boolean) {
  return useOneShotLegend(EMPTY_KEY, active);
}

function useOneShotLegend(storageKey: string, active: boolean) {
  // Scoped to the signed-in account (guests have an anonymous user id of
  // their own), so two people on one phone each get their own single read.
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const key = legendKey(storageKey, userId);
  // dismissed is null while storage is being read: a legend that flashes and
  // vanishes is worse than one that arrives a beat late. The key rides in
  // the same state so an identity switch resets DURING render (the
  // sanctioned adjust-state-in-render pattern) rather than from an effect.
  const [state, setState] = useState<{ key: string; dismissed: boolean | null }>({
    key,
    dismissed: null,
  });
  if (state.key !== key) {
    setState({ key, dismissed: null });
  }

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .then((value) => {
        if (live) {
          setState({ key, dismissed: legendDismissed(value, Date.now()) });
        }
      })
      .catch(() => {
        // Storage unavailable: treat as dismissed rather than nagging.
        if (live) {
          setState({ key, dismissed: true });
        }
      });
    return () => {
      live = false;
    };
  }, [key]);

  const dismiss = useCallback(() => {
    setState({ key, dismissed: true });
    AsyncStorage.setItem(key, new Date().toISOString()).catch(() => {});
  }, [key]);

  return { visible: active && state.key === key && state.dismissed === false, dismiss };
}
