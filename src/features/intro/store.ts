import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'samewhere.intro.seen.v1';

/**
 * Whether the first-run tour has been shown. Deliberately AsyncStorage and
 * not the account: the tour explains the app to someone who has no account
 * yet, and it should not reappear just because they browse signed out.
 */
export function useIntroState() {
  // null = still reading storage; showing nothing beats flashing the tour at
  // someone who already dismissed it.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((value) => {
        if (active) {
          setSeen(value === '1');
        }
      })
      .catch(() => {
        // Storage unavailable: treat as seen rather than trapping someone in
        // a tour that can never be dismissed.
        if (active) {
          setSeen(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = () => {
    setSeen(true);
    AsyncStorage.setItem(KEY, '1').catch(() => {});
  };

  return { seen, dismiss };
}
