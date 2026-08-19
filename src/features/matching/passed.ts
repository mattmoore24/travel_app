import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'samewhere.passed.travelers.v1';
/** Someone you skipped comes back around after a fortnight, not forever. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Entry = { id: string; at: number };

/**
 * Who you have already moved past in the one-at-a-time review. Kept on the
 * device rather than the server: skipping is not a signal anyone else should
 * ever see, and it does not need to survive a reinstall.
 */
export function usePassedTravelers() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active || !raw) {
          return;
        }
        const now = Date.now();
        const parsed: Entry[] = JSON.parse(raw);
        setEntries(parsed.filter((e) => now - e.at < TTL_MS));
      })
      .catch(() => {
        // A device that cannot read this simply shows everyone.
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: Entry[]) => {
    setEntries(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const add = useCallback(
    (userId: string) => {
      persist([...entries.filter((e) => e.id !== userId), { id: userId, at: Date.now() }]);
    },
    [entries, persist]
  );

  const reset = useCallback(() => {
    persist([]);
  }, [persist]);

  return {
    has: (userId: string) => entries.some((e) => e.id === userId),
    count: entries.length,
    add,
    reset,
  };
}
