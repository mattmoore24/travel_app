import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { consumeDeliberateSignOut, signOutWasDeliberate } from '@/features/auth/api';
import { appleCredentialSnapshot } from '@/features/auth/apple-revoke';
import { parseRecoveryLink } from '@/features/auth/recovery';
import { signedOutReason } from '@/features/auth/signed-out-reason';
import { useAuthStore } from '@/features/auth/store';
import { refreshPushToken } from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';
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
  const recoveryStarted = useAuthStore((s) => s.recoveryStarted);
  const recoveryReady = useAuthStore((s) => s.recoveryReady);
  const recoveryFailed = useAuthStore((s) => s.recoveryFailed);
  const signedOutUnasked = useAuthStore((s) => s.signedOutUnasked);

  // Password-recovery links, which nothing else would pick up: the client
  // runs with detectSessionInUrl:false (correct for a native app — there is
  // no browser URL to watch), so the tokens Supabase mails have to be taken
  // out of the link by hand and turned into a session here.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }
    let active = true;
    const handle = (url: string | null) => {
      const link = parseRecoveryLink(url);
      if (!active || link == null) {
        return;
      }
      if (link.kind === 'error') {
        recoveryFailed(link.message);
        return;
      }
      // The flag goes up BEFORE the session lands, so the guards never get a
      // frame in which this looks like an ordinary sign-in.
      recoveryStarted();
      supabase.auth
        .setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        .then(({ error }) => {
          if (!active) {
            return;
          }
          if (error) {
            recoveryFailed('That link did not work. Ask for a new one.');
          } else {
            recoveryReady();
          }
        });
    };

    Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [recoveryStarted, recoveryReady, recoveryFailed]);

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
      if (session?.user.id) {
        analytics.identify(session.user.id);
      }
      // The PKCE/web path establishes the session itself and announces it
      // with this event, so there is nothing to wait for.
      if (event === 'PASSWORD_RECOVERY') {
        recoveryReady();
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        // Refresh, never request. This used to call the requesting version,
        // so the OS permission dialog fired the instant an account existed —
        // mid-signup, before the person had sent a single message, with
        // nothing on screen to say what they would be notified about. Asking
        // now happens in the primer, at the first moment there is an answer
        // worth waiting for.
        refreshPushToken();
      }
      // Drop all cached server state on sign-out so the next account (or a
      // fresh sign-in) never sees the previous user's data or errored queries.
      if (event === 'SIGNED_OUT') {
        analytics.reset();
        queryClient.clear();
        // ...and say so when nobody on this device asked. supabase-js emits
        // this same event for a tapped Sign out, for a refresh token the
        // server has thrown away, for a global sign-out from another device,
        // and for the guest janitor's sweep. Only the first of those is
        // something the person already knows about; the rest used to be the
        // app silently becoming the signed-out app, chats and pins and all.
        const wasDeliberate = signOutWasDeliberate();
        // Consume before deciding anything else: this is the one event the
        // flag was raised for, and lowering it here is what makes the flag
        // survive a slow /logout without also surviving into the NEXT
        // sign-out, which may be a real one.
        consumeDeliberateSignOut();
        const reason = signedOutReason(event, wasDeliberate, appleCredentialSnapshot());
        if (reason != null) {
          signedOutUnasked(reason);
        }
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [setSession, setInitialized, recoveryReady, signedOutUnasked]);
}
