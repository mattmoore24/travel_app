import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { consumeDeliberateSignOut, signOutWasDeliberate } from '@/features/auth/api';
import { appleCredentialSnapshot } from '@/features/auth/apple-revoke';
import { parseRecoveryLink } from '@/features/auth/recovery';
import { signedOutReason } from '@/features/auth/signed-out-reason';
import { useAuthStore } from '@/features/auth/store';
import { useAccountType } from '@/features/guest/hooks';
import { refreshPushToken } from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';
import { writeDeviceLocale } from '@/lib/device-locale';
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
  const accountType = useAccountType();
  const isGuest = accountType === 'guest' || accountType === 'signed_out';

  // The account kind, on every event from here on (docs/DASHBOARD.md).
  //
  // Here rather than at each capture() because there are about fifty call
  // sites and only one of them would ever have been given it. It rides in
  // the analytics context instead, which every event merges, and which
  // analytics.reset() empties on sign-out so the next account on this device
  // cannot inherit it.
  //
  // It re-runs as the answer sharpens: 'unknown' while useOwnBusiness is
  // still in flight, then the real kind a beat later. Events fired in that
  // window carry 'unknown' on purpose — see useAccountType.
  useEffect(() => {
    analytics.setContext({ account_type: accountType, is_guest: isGuest });
  }, [accountType, isGuest]);

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
      // NO identify() HERE, and the missing call is deliberate.
      //
      // This used to hand PostHog the raw Supabase auth uid, which made the
      // analytics distinct_id a join key into our own database: anybody
      // holding a PostHog export and the database could reconstruct who
      // talked to whom and when, inside a third-party processor, for a
      // product whose whole positioning is that it does not collect that,
      // and whose users are disproportionately EU travelers. It also fired
      // on INITIAL_SESSION at every cold start and on every token refresh,
      // so it re-identified an id that had not changed several times a day.
      //
      // The settled answer is a SALTED HASH, salted from a server-side
      // secret — and there is no such secret the client can reach. Nothing
      // in the bundle is a secret: an EXPO_PUBLIC_ salt ships inside the app
      // and protects against nobody, and a hash whose salt the attacker has
      // is the same join key with extra steps. So until the server mints
      // that id (see docs/DASHBOARD.md), the distinct_id is PostHog's own
      // per-install random one, which is what it generates when nothing
      // identifies. That id joins to nothing, which is strictly the outcome
      // the hash was for; the only thing it costs is looking one person's
      // session up from a support ticket, and that half needs the secret
      // anyway.
      //
      // analytics.identify() still exists, guarded so an unchanged id fires
      // nothing, and is what the server-minted id gets handed to.
      // The PKCE/web path establishes the session itself and announces it
      // with this event, so there is nothing to wait for. So does the typed
      // six-digit code: auth-js emits PASSWORD_RECOVERY rather than
      // SIGNED_IN for verifyOtp({ type: 'recovery' }) (features/auth/api,
      // verifyRecoveryCode), and this branch runs in the same synchronous
      // callback as the setSession above it, so the guards never see a
      // frame in which a recovery looks like an ordinary sign-in.
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
        // And the phone's own language, beside it, for the same reason it is
        // here: this is the one place that fires once per sign-in and has a
        // user id in hand. It is what lets the moderation worker answer a
        // refused selfie or a refused storefront in a language the person
        // reads (src/lib/device-locale.ts). Fire and forget - nothing on
        // screen waits for it, and a failure costs an English sentence.
        //
        // It writes on every launch, unconditionally, and that is not an
        // oversight: `profiles.locale` carries no select grant, so the client
        // has nothing to compare against and cannot skip a redundant write.
        // A once-per-launch write to profiles is a presence signal unless the
        // database says otherwise, and 20260903020000 is where it says so -
        // the updated_at trigger stamps only for columns somebody EDITED.
        // Anything else added to this branch that writes a row a stranger can
        // read needs the same question asked of it.
        void writeDeviceLocale(session.user.id);
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
