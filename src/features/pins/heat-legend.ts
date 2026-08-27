import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'samewhere.heat.legend.v1';
const PLACES_KEY = 'samewhere.places.legend.v1';

/**
 * Whether the "what are these glowing patches" chip still needs showing.
 *
 * The heat layer is the one thing on the map with no label, no marker and no
 * tap target, so the first time somebody sees it they have to guess. One
 * sentence, once, then never again — a legend that keeps reappearing is
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

function useOneShotLegend(storageKey: string, active: boolean) {
  // null while storage is being read: a legend that flashes and vanishes is
  // worse than one that arrives a beat late.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (live) {
          setDismissed(value === '1');
        }
      })
      .catch(() => {
        // Storage unavailable: treat as dismissed rather than nagging.
        if (live) {
          setDismissed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(storageKey, '1').catch(() => {});
  }, [storageKey]);

  return { visible: active && dismissed === false, dismiss };
}
