import { useEffect } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { queryClient } from '@/lib/query-client';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Mounted once in the root layout: restores the persisted session and tracks
 * every subsequent auth state change into the zustand store the route guards
 * read from.
 */
export function useAuthListener() {
  const setSession = useAuthStore((s) => s.setSession);
  const setInitialized = useAuthStore((s) => s.setInitialized);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitialized();
      return;
    }

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setSession(data.session);
        }
      })
      .finally(() => {
        if (active) {
          setInitialized();
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // Drop all cached server state on sign-out so the next account (or a
      // fresh sign-in) never sees the previous user's data or errored queries.
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [setSession, setInitialized]);
}
