import { MutationCache, QueryClient, focusManager } from '@tanstack/react-query';
import { Alert, AppState, Platform } from 'react-native';

import { saveFailureMessage } from '@/lib/failure-message';

// Typed once here so every useMutation can carry `meta: { failureTitle }`
// without a cast. React Query reads this Register interface for the meta
// types across the app.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /**
       * The title of the failure alert, said in the mutation's own verb —
       * "Couldn't send that", "Could not block them" — so the alert names
       * the act that failed instead of the generic "Could not save".
       */
      failureTitle?: string;
    };
  }
}

export const queryClient = new QueryClient({
  // Mutations that individual screens don't handle still surface to the user
  // instead of failing silently (review finding: onboarding saves swallowed
  // network errors). Screens keep flow control via try/catch around
  // mutateAsync; this cache handler owns the messaging.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Duck-typed, not instanceof: PostgREST hands back a plain object, so
      // an instanceof check discarded every message the database sent and
      // showed "Something went wrong." for all of them. Real Error
      // subclasses (AuthError, StorageError) carry .message too.
      //
      // What the message must never be is the raw string. saveFailureMessage
      // owns the vocabulary (UX_PLAN.md D3: the database may not write
      // user-facing copy): a stable hint code or a known fragment gets a
      // written sentence, a real sentence the database wrote passes through,
      // and everything else — the transport's own words included — becomes
      // the generic one.
      const message = saveFailureMessage(error);
      const title = mutation.meta?.failureTitle ?? 'Could not save';
      if (Platform.OS === 'web') {
        // react-native-web's Alert is a silent no-op; use the browser dialog.
        (globalThis as { alert?: (msg: string) => void }).alert?.(`${title}: ${message}`);
      } else {
        Alert.alert(title, message);
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Travel data (trips, pins, heatmap) tolerates short staleness; screens
      // that need realtime freshness (chat) will use Supabase Realtime instead.
      staleTime: 30_000,
      retry: 2,
    },
  },
});

// React Query's "window focus" doesn't exist in RN — wire it to AppState so
// errored/stale queries (profile fetch, signed photo URLs) refetch when the
// app foregrounds.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}
