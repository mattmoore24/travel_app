import { useEffect, useRef } from 'react';

/**
 * Re-arming `refetchInterval` on a focus flip never fires an immediate tick,
 * and a kept-mounted tab emits no mount or window-focus event React Query can
 * see — so "coming back to the tab refetches at once" has to be done by hand
 * or it simply does not happen, and expired pins sit tappable for a full
 * interval after every tab return.
 *
 * Fires exactly once per blur → focus transition, and only when the data is
 * already stale, so a quick tab bounce inside staleTime costs nothing.
 */
export function useRefetchOnRefocus(
  focused: boolean,
  query: { isStale: boolean; refetch: () => unknown }
) {
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && query.isStale) {
      query.refetch();
    }
    wasFocused.current = focused;
    // Deliberately only the focus flip: depending on isStale would re-run
    // the effect every staleTime and tighten the polling it exists to relax.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
}
