import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'samewhere.heat.legend.v1';

/**
 * Whether the "what are these glowing patches" chip still needs showing.
 *
 * The heat layer is the one thing on the map with no label, no marker and no
 * tap target, so the first time somebody sees it they have to guess. One
 * sentence, once, then never again — a legend that keeps reappearing is
 * furniture, not an explanation.
 */
export function useHeatLegend(hasHeat: boolean) {
  // null while storage is being read: a legend that flashes and vanishes is
  // worse than one that arrives a beat late.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((value) => {
        if (active) {
          setDismissed(value === '1');
        }
      })
      .catch(() => {
        // Storage unavailable: treat as dismissed rather than nagging.
        if (active) {
          setDismissed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(KEY, '1').catch(() => {});
  }, []);

  return { visible: hasHeat && dismissed === false, dismiss };
}
