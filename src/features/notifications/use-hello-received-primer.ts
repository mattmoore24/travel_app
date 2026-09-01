import { useEffect, useRef } from 'react';

import { useIncomingRequests } from '@/features/matching/hooks';
import { usePushPrimer } from '@/features/notifications/primer-store';

/**
 * Ask about notifications the first time somebody writes to you.
 *
 * Both of the other moments are outbound - you sent a hello, you posted a
 * pin - so a person who finishes signup and then reads for a week is never
 * asked at all, and the one notification this product exists to deliver
 * lands in silence. This is the inbound moment, and it is the first thing on
 * the account that a notification would genuinely have been useful for.
 *
 * Deliberately an effect over the query's DATA rather than an onSuccess
 * inside it: onSuccess fires on every background refetch, so the same
 * unanswered hello would re-ask on every focus for as long as it sat there.
 * The ref makes it once per session; the store's own per-reason key makes it
 * once per account.
 *
 * It renders nothing and presents nothing. The sheet is PushPrimer, which
 * owns the three facts a data-driven modal has to wait for (tabs focused, no
 * native modal registered, the settle delay) - the exact guard the traps
 * skill demands, and the reason there must not be a second presentation path.
 */
export function useHelloReceivedPrimer(): void {
  const { data: requests } = useIncomingRequests();
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || requests == null || requests.length === 0) {
      return;
    }
    asked.current = true;
    void usePushPrimer.getState().ask('hello-received');
  }, [requests]);
}
