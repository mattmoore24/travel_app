import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Telling somebody the app moved their conversations.
 *
 * `archive_idle_chats` runs at 03:30 and archives any chat with nothing said
 * in it for fourteen days. That is a defensible window and the founder has
 * kept it. What was not defensible was the silence: the only route to
 * /archived-chats was a row that appeared once something had been archived,
 * so the first time anybody found out was when they went looking for a name
 * they remembered and could not find it. An auto-archive that announces
 * itself and is one tap to reverse is housekeeping; the same thing unsaid is
 * the app losing your friend.
 *
 * The comparison is a stamp, not a flag: the last time this person was TOLD,
 * against when each chat was archived. Nothing new to store server-side,
 * because chat_prefs already records the moment.
 */

const KEY = 'samewhere.archive.notice.v1';

/** The stamp is per account: two people on one phone get their own. */
export function archiveStampKey(userId: string | null): string {
  return `${KEY}.${userId ?? 'anon'}`;
}

/**
 * How many of these archives are news.
 *
 * A missing stamp counts NOTHING, which is the whole first-run rule: an
 * account that has been running for months would otherwise be met with
 * "14 quiet chats moved to Archived" on the launch after this ships, about
 * chats it has long since stopped thinking about. The stamp is written on
 * that first pass and the notice starts working from then on.
 *
 * Strictly after, so a chat somebody archived by hand cannot count: the hand
 * archive writes the stamp itself, and it writes it after the server has
 * stamped archived_at.
 */
export function newlyArchived(
  rows: { archived_at: string | null }[],
  stamp: string | null
): number {
  if (stamp == null) {
    return 0;
  }
  const since = Date.parse(stamp);
  if (Number.isNaN(since)) {
    return 0;
  }
  return rows.filter((row) => {
    if (row.archived_at == null) {
      return false;
    }
    const at = Date.parse(row.archived_at);
    return !Number.isNaN(at) && at > since;
  }).length;
}

/**
 * Mark everything archived up to now as read.
 *
 * Called both when the notice is dismissed and, importantly, the moment
 * somebody archives a chat themselves — without that, the next launch tells
 * the person the app moved a conversation they moved.
 */
export async function stampArchiveNoticeRead(userId: string | null): Promise<void> {
  const at = new Date().toISOString();
  // BOTH, and the in-memory half is the one that matters inside a live
  // session. Writing only to AsyncStorage left the running hook holding the
  // stamp it read on mount, so a chat somebody archived by hand was still
  // newer than that stamp and the notice announced it back at them a moment
  // later — precisely the failure the spec's Risk paragraph names. Storage is
  // what survives a relaunch; the store is what the current screen reads.
  liveStamp.set(archiveStampKey(userId), at);
  notifyStampWatchers();
  await AsyncStorage.setItem(archiveStampKey(userId), at).catch(() => {});
}

/**
 * The stamp as the running app sees it, keyed the same way storage is.
 *
 * A module-level map plus a subscriber set rather than a store file: this is
 * one value read by one hook, and useSyncExternalStore is exactly the shape
 * for "something outside React changed".
 */
const liveStamp = new Map<string, string>();
const stampWatchers = new Set<() => void>();

function notifyStampWatchers() {
  stampWatchers.forEach((fn) => fn());
}

function subscribeToStamp(fn: () => void): () => void {
  stampWatchers.add(fn);
  return () => {
    stampWatchers.delete(fn);
  };
}

async function fetchArchivedAt(): Promise<{ archived_at: string | null }[]> {
  // chat_prefs_rw_own is caller-scoped, so this returns this person's rows
  // and cannot be pointed at anybody else's.
  const { data, error } = await supabase
    .from('chat_prefs')
    .select('archived_at')
    .not('archived_at', 'is', null);
  if (error) {
    throw error;
  }
  return (data ?? []) as { archived_at: string | null }[];
}

/**
 * The one-line notice above the inbox, and the write that closes it.
 *
 * `count` is 0 until the stamp has been read AND the rows have arrived, so
 * the notice never flashes on a cold start. A failure anywhere returns 0:
 * this is a courtesy, and a courtesy that throws an error banner at somebody
 * is worse than no courtesy.
 */
export function useArchiveNotice(enabled: boolean) {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const key = archiveStampKey(userId);
  // Null while storage is being read, so the count cannot be computed against
  // a stamp that has not arrived. The key rides in state so an identity
  // switch resets DURING render rather than from an effect.
  const [state, setState] = useState<{ key: string; stamp: string | null; read: boolean }>({
    key,
    stamp: null,
    read: false,
  });
  if (state.key !== key) {
    setState({ key, stamp: null, read: false });
  }

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .then((value) => {
        if (!live) {
          return;
        }
        setState({ key, stamp: value, read: true });
        if (value == null) {
          // First run on this account: start the clock rather than reporting
          // every archive that ever happened.
          void stampArchiveNoticeRead(userId);
        }
      })
      .catch(() => {
        // Storage unavailable. Say nothing rather than say it wrongly.
        if (live) {
          setState({ key, stamp: null, read: true });
        }
      });
    return () => {
      live = false;
    };
  }, [key, userId]);

  const { data: rows = [] } = useQuery({
    queryKey: ['archived-at'],
    queryFn: fetchArchivedAt,
    enabled: enabled && isSupabaseConfigured && state.read,
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => {
    setDismissed(true);
    void stampArchiveNoticeRead(userId);
  }, [userId]);

  // The live stamp wins over the one read at mount: it is only ever NEWER
  // (both are written by stampArchiveNoticeRead, and it writes the store
  // first), so taking the later of the two is safe and is what makes a hand
  // archive silent without waiting for a remount.
  const live = useSyncExternalStore(
    subscribeToStamp,
    () => liveStamp.get(key) ?? null,
    () => null
  );
  const stamp = live ?? state.stamp;

  // `enabled` false means 0, rather than "0 because the query has not run".
  // isBusiness resolves a round trip late, so a business account briefly had
  // enabled true, and the gate has to hold at the value as well as the fetch.
  const count =
    !enabled || dismissed || !state.read || state.key !== key ? 0 : newlyArchived(rows, stamp);
  return { count, dismiss };
}
