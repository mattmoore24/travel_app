import { create } from 'zustand';

/**
 * Which surface the hello left from.
 *
 * `useSendRequest` is the only send path in the app and it serves three of
 * them — the map's pin card, a stranger's profile, and Travelers — while
 * only Travelers ever clears this store. Without the stamp, saying hi from
 * the map and opening Travelers an hour later showed a strip claiming you
 * had just said hi there.
 */
export type SaidHiOrigin = 'travelers' | 'profile' | 'pin';

type SaidHiState = {
  /**
   * Who the first message just went to, until the strip is dismissed.
   *
   * `at` is what settles the slot the strip shares with the undo bar: two
   * transient bars float on the same number above the action bar, and the
   * newer act owns it. Comparing timestamps in render is how that stays a
   * derivation rather than one effect reaching in to cancel the other. It is
   * also the age guard — a stamp older than the strip's own screen time can
   * never paint, whatever cleared or failed to clear it.
   */
  sentTo: { name: string; at: number; origin: SaidHiOrigin } | null;
  /** Record a delivered-or-queued first message, and where it left from. */
  note: (name: string, origin: SaidHiOrigin) => void;
  clear: () => void;
};

/**
 * Who you just said hi to, for the one beat after the composer closes.
 *
 * Travelers has no other way to know. The composer is a modal on its own
 * route, `router.back()` carries nothing, and by the time the tab re-renders
 * the recipient has already been filtered out of the queue — so the moment
 * of highest intent in the whole product ended with a stranger's face
 * silently taking the page and no trace anywhere that anything had happened.
 *
 * In memory, not on disk. It is a beat, not a record: the record is the row
 * in Chat under "You said hi".
 */
export const useSaidHi = create<SaidHiState>((set) => ({
  sentTo: null,
  // A second one replaces the first rather than queueing. Two strips would
  // have to wait for each other, and the older one is the less interesting.
  note: (name, origin) => set({ sentTo: { name, at: Date.now(), origin } }),
  clear: () => set({ sentTo: null }),
}));
