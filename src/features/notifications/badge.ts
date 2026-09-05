import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { pushPossible } from '@/features/notifications/push';

/**
 * Put the waiting count on the home-screen icon.
 *
 * The other half of the badge, and the half that works while the app is in
 * the foreground: the push worker sends a `badge` with every notification,
 * which is what a phone in a pocket needs, and this is what corrects the
 * number the moment somebody reads a thread. One source for both, so the
 * icon and the Chat tab's own badge cannot disagree.
 *
 * Silent where push is impossible at all (a simulator, Expo Go, a build with
 * no EAS project id): there is no icon badge to set there and the call is a
 * no-op that only muddies the logs. Failures are swallowed for the same
 * reason the count is a courtesy rather than a fact: a badge that cannot be
 * written is not worth an error in front of anybody.
 */
export function useIconBadge(count: number | null): void {
  useEffect(() => {
    // NULL means "not known yet", and it is not the same as zero. Both
    // queries behind the count default to an empty array while they are
    // pending and nothing persists them, so every cold launch passes through
    // 0 on its way to the truth. Writing that 0 to the SYSTEM badge wipes the
    // number off the home screen of somebody who opened the app with no
    // signal, and nothing puts it back until a fetch succeeds.
    if (count == null || !pushPossible()) {
      return;
    }
    void Notifications.setBadgeCountAsync(count).catch(() => {});
  }, [count]);
}

/**
 * Wipe the icon clean.
 *
 * Called on sign-out: a shared phone must not carry the previous account's
 * count into the next person's home screen, and nothing else would clear it
 * until that person happened to open the Chat tab.
 */
export async function clearIconBadge(): Promise<void> {
  if (!pushPossible()) {
    return;
  }
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Nothing to do, and nothing worth saying to anybody signing out.
  }
}
