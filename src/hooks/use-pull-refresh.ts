import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A RefreshControl that spins only for a pull.
 *
 * Travelers and Chat fed their RefreshControl `query.isFetching`, and
 * isFetching is true for EVERY fetch: the refocus refetch on a tab return,
 * the interval, a mutation's invalidation. So the list dipped and showed a
 * spinner every time somebody came back to the tab, for a fetch they had
 * not asked for and that the rows were already showing the answer to. The
 * spinner is a promise that a pull is being honoured; anything else is
 * background work, and background work is silent.
 *
 * `refreshing` here is set by the pull and cleared when the refetch it
 * started settles, whatever the outcome. A refetch that fails is the query's
 * failure to show (its error state, the LoadError on the screen), not this
 * hook's: swallowing it keeps the spinner from sticking on a bad wifi, which
 * is the one thing worse than spinning too often.
 */
export function usePullRefresh(refetch: () => Promise<unknown> | void): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  // Pulls in flight, so a second pull landing while the first settles does
  // not stop the spinner early, and an unmounted list is not set on.
  const inFlight = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(async () => {
    inFlight.current += 1;
    setRefreshing(true);
    try {
      await refetch();
    } catch {
      // The query owns its error; see above.
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0 && mounted.current) {
        setRefreshing(false);
      }
    }
  }, [refetch]);

  return { refreshing, onRefresh };
}
