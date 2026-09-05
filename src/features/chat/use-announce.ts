import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Say the state change out loud.
 *
 * Skeletons are correctly hidden from VoiceOver, and nothing used to
 * announce anything — so a blind user on the Chat or Travelers tab heard
 * silence while a screen loaded, silence when it resolved to empty, and
 * silence when it failed. The three outcomes were indistinguishable without
 * re-exploring the screen by hand, on precisely the screens where the
 * difference matters most: is my archive gone, or did the ask fail.
 *
 * Pass `null` while the screen has nothing settled to say, and the settled
 * sentence once it does ("6 chats", "No chats yet"). The announcement fires
 * ONCE per settle — on the null-to-sentence transition, never on data
 * identity — because an announcement that fires on every render is worse
 * than silence. Failures are announced by LoadError itself (it mounts
 * exactly when a failure is on screen), so screens pass their success
 * sentence here and leave the failure sentence to it.
 *
 * `announceForAccessibility` is the PRIMARY mechanism, not the fallback:
 * `accessibilityLiveRegion` and `accessibilityRole="alert"` are Android-only
 * in React Native and are no-ops on this app's platform. The screen-reader
 * guard keeps it from doing any work when VoiceOver is off.
 */
export function useAnnounce(message: string | null): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const previous = last.current;
    last.current = message;
    if (message == null || previous != null) {
      return;
    }
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (on && live) {
          AccessibilityInfo.announceForAccessibility(message);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [message]);
}
