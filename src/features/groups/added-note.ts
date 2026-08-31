import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'samewhere.added.notes.seen.v1';

/**
 * Which "X added you to this group" lines have been read.
 *
 * The note has to be dismissible ONCE, not once per screen. Held in component
 * state it came back on every open, for the life of the membership: the note
 * is driven by room_members.added_by, which never changes, so a fresh mount
 * meant a fresh note. Three weeks later a line about who added you is still
 * wedged between the thread and the composer, putting a destructive Leave one
 * thumb-width above Send - the arrangement the room screen's own comment
 * rejects in as many words.
 *
 * On the device rather than the server, the same call passed.ts makes: who has
 * read a notice is nobody else's business, and a reinstall showing it again is
 * a smaller cost than a column and an RPC to write it down.
 */
export function useAddedNoteSeen(chatId: string | null) {
  const [seen, setSeen] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active) {
          return;
        }
        setSeen(raw ? (JSON.parse(raw) as string[]) : []);
        setLoaded(true);
      })
      .catch(() => {
        // A device that cannot read this shows the note. Showing a note twice
        // is a smaller failure than hiding one somebody has never seen.
        if (active) {
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (chatId == null) {
      return;
    }
    setSeen((current) => {
      if (current.includes(chatId)) {
        return current;
      }
      const next = [...current, chatId];
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [chatId]);

  return {
    // Held back until the read lands, so the note does not flash on every open
    // and then vanish - which reads as a glitch rather than as a notice.
    dismissed: !loaded || (chatId != null && seen.includes(chatId)),
    dismiss,
  };
}
