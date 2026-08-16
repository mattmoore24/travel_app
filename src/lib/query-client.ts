import { MutationCache, QueryClient, focusManager } from '@tanstack/react-query';
import { Alert, AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  // Mutations that individual screens don't handle still surface to the user
  // instead of failing silently (review finding: onboarding saves swallowed
  // network errors). Screens keep flow control via try/catch around
  // mutateAsync; this cache handler owns the messaging.
  mutationCache: new MutationCache({
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      if (Platform.OS === 'web') {
        // react-native-web's Alert is a silent no-op; use the browser dialog.
        (globalThis as { alert?: (msg: string) => void }).alert?.(`Could not save: ${message}`);
      } else {
        Alert.alert('Could not save', message);
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
