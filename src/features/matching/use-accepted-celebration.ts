import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { useMyChats, useSentRequests } from '@/features/matching/hooks';

const KEY = 'samewhere.celebrated.requests.v1';

export type AcceptedMatch = {
  requestId: string;
  chatId: string;
  name: string;
  photoPath: string | null;
};

/**
 * Finds a message request that has been accepted since the last time we
 * looked. The sender never sees a decline, so an accept is the one piece of
 * genuinely good news the app can deliver, and it deserves a moment.
 *
 * On the very first run every already-accepted request is marked as seen, so
 * an existing user does not get a burst of celebrations for old news.
 */
export function useAcceptedCelebration() {
  const { data: sent = [] } = useSentRequests();
  const { data: chats = [] } = useMyChats();
  const [seen, setSeen] = useState<Set<string> | null>(null);

  const accepted = sent.filter((r) => r.state === 'accepted' && r.chat_id != null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active) {
          return;
        }
        if (raw != null) {
          setSeen(new Set(JSON.parse(raw) as string[]));
          return;
        }
        // First run: everything already accepted counts as old news.
        const ids = accepted.map((r) => r.id);
        setSeen(new Set(ids));
        AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
      })
      .catch(() => {
        if (active) {
          setSeen(new Set());
        }
      });
    return () => {
      active = false;
    };
    // Runs once: later accepts are compared against the stored set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = seen == null ? null : (accepted.find((r) => !seen.has(r.id)) ?? null);
  const chat = pending ? chats.find((c) => c.chat_id === pending.chat_id) : undefined;

  const dismiss = useCallback(() => {
    if (!pending || seen == null) {
      return;
    }
    const next = new Set(seen);
    next.add(pending.id);
    setSeen(next);
    AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
  }, [pending, seen]);

  const match: AcceptedMatch | null =
    pending && pending.chat_id
      ? {
          requestId: pending.id,
          chatId: pending.chat_id,
          name: chat?.title ?? 'this traveler',
          photoPath: chat?.photo_path ?? null,
        }
      : null;

  return { match, dismiss };
}
