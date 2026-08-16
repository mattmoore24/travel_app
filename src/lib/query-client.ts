import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Travel data (trips, pins, heatmap) tolerates short staleness; screens
      // that need realtime freshness (chat) will use Supabase Realtime instead.
      staleTime: 30_000,
      retry: 2,
    },
  },
});
