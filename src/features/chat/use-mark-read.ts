import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { useMarkChatRead } from '@/features/matching/hooks';

/**
 * Keep a thread marked read for as long as it is the screen you are looking
 * at: once when it opens, and again each time a message lands while you are
 * still there. That second half is the difference between an unread dot that
 * feels alive and one that reappears the moment you leave a conversation you
 * were in the middle of.
 *
 * Deliberately keyed on the newest message rather than a timer. Nothing is
 * sent while a thread sits idle, and re-reading the same thread is free
 * because the RPC is idempotent and never moves the mark backwards.
 */
export function useMarkReadWhileOpen(chatId: string | null, newestMessageAt: string | null) {
  // The mutation RESULT is a new object every render; `mutate` itself is
  // stable, which is what keeps this effect from re-firing on every pass.
  const { mutate: markRead } = useMarkChatRead();
  const marked = useRef<string | null>(null);
  const key = `${chatId ?? ''}|${newestMessageAt ?? ''}`;

  useFocusEffect(
    useCallback(() => {
      if (chatId == null || marked.current === key) {
        return;
      }
      marked.current = key;
      markRead(chatId);
    }, [chatId, key, markRead])
  );
}
