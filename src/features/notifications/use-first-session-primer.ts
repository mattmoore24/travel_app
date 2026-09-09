import { useEffect, useRef } from 'react';

import { useIsGuest } from '@/features/guest/hooks';
import { usePushPrimer } from '@/features/notifications/primer-store';
import { useOwnProfile } from '@/features/profile/hooks';
import { justOnboarded } from '@/features/profile/just-onboarded';

/**
 * Ask about notifications once, at the end of signup, in our own words.
 *
 * Founder, 2026-09-09: ask on first run, primed rather than cold. The three
 * moments that existed before this all needed something to have happened
 * first, and two of them were outbound, so the window between finishing a
 * profile and the first hello arriving was silent by construction — and the
 * first hello, the one notification this product exists to deliver, could
 * never reach a phone, because nobody had been asked before it.
 *
 * PRIMED IS THE WHOLE POINT. iOS shows its permission alert exactly once per
 * install, and once it has been declined only Settings can change the answer.
 * Nothing here touches it: this raises OUR sheet, where "Not now" costs the
 * account one of its two asks and leaves the system dialog unspent. The
 * expensive permission is only ever put to somebody who already said yes to
 * the cheap one.
 *
 * Never for a guest. A signed-out visitor has no account for anything to
 * arrive at, so asking them for a permission we could not use would spend the
 * install's one alert on nothing.
 *
 * The same shape as useHelloReceivedPrimer, and for the same reasons: an
 * effect over the query's DATA rather than an onSuccess (which fires on every
 * background refetch), a ref for once-per-session, and the store's own
 * per-reason key for once-per-account. It renders nothing and presents
 * nothing — PushPrimer owns the three facts a data-driven modal has to wait
 * for, and there must not be a second presentation path.
 */
export function useFirstSessionPrimer(): void {
  const { data: profile } = useOwnProfile();
  const isGuest = useIsGuest();
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || isGuest || !justOnboarded(profile?.onboarding_completed_at)) {
      return;
    }
    asked.current = true;
    void usePushPrimer.getState().ask('first-session');
  }, [profile, isGuest]);
}
