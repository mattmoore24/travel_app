import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { consumeDeliberateSignOut, signOutWasDeliberate } from '@/features/auth/api';
import { appleCredentialSnapshot } from '@/features/auth/apple-revoke';
import { parseRecoveryLink } from '@/features/auth/recovery';
import { sessionIsUnknown } from '@/features/auth/routing';
import { signedOutReason } from '@/features/auth/signed-out-reason';
import { useAuthStore } from '@/features/auth/store';
import { useAccountType } from '@/features/guest/hooks';
import { refreshPushToken } from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';
import { writeDeviceLocale } from '@/lib/device-locale';
import { getEverReached, queryClient, subscribeToReach } from '@/lib/query-client';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * How often to ask auth-js again while the server is reachable and the
 * session is still unknown, and how many times before giving up.
 *
 * Asking again cannot hurry auth-js: it caches a failed refresh for
 * REFRESH_FAILURE_COOLDOWN_MS (60s) and answers from the cache, so most of
 * these tries return the same error in a microsecond. The cadence exists to
 * catch the moment the cache expires without waiting for the 30s refresh
 * ticker to notice, and the limit exists because a reachable server whose
 * auth keeps failing is not a reason to hold the app shut forever.
 */
const SESSION_RETRY_MS = 10_000;
const SESSION_RETRY_LIMIT = 9;

/**
 * The persisted session, into the store, with "could not check" told apart
 * from "none".
 *
 * `{ data, error }` both read, where the error half used to be dropped: for
 * a token inside auth-js's 90s expiry margin (the app closed for an hour or
 * more) getSession() awaits a refresh, and when that refresh cannot reach
 * the server it resolves `{ session: null, error: AuthRetryableFetchError }`
 * while KEEPING the session on disk. Read as signed-out, that put a traveler
 * on a plane onto the guest map. features/auth/routing owns the test.
 */
async function loadSession(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  const store = useAuthStore.getState();
  if (sessionIsUnknown({ session: data.session, error })) {
    store.sessionLookupFailed();
  } else {
    store.setSession(data.session);
  }
}

let sessionRequest: Promise<void> | null = null;

/**
 * Ask for the persisted session again. The offline card's Try again calls
 * this beside its refetch, and the listener below calls it on its own once
 * the server is reachable. Shared so two callers in the same second make one
 * request; auth-js serialises refreshes anyway.
 */
export function retrySession(): Promise<void> {
  if (sessionRequest != null) {
    return sessionRequest;
  }
  // A thrown getSession (storage unreadable) is not a verdict either way;
  // the store keeps whatever it had and the next try asks again.
  const request = loadSession().catch(() => {});
  sessionRequest = request;
  // Released in a continuation registered BEFORE any caller's, so a caller
  // that asks again from its own `.then` gets a fresh request rather than
  // this settled one.
  void request.then(() => {
    if (sessionRequest === request) sessionRequest = null;
  });
  return request;
}

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

    // The store write happens inside retrySession whatever `active` is: the
    // store outlives this effect, and the answer is the same session either
    // way. Only the readiness flip is guarded, so a remount cannot declare
    // the root initialized off a lookup it did not start.
    retrySession().finally(() => {
      if (active) {
        setInitialized();
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION is auth-js re-answering the getSession above through
      // the same loader, and when that loader failed RETRYABLY it answers
      // this event with null (GoTrueClient._emitInitialSession catches the
      // error and emits null) while keeping the session on disk. Written to
      // the store, that null would clear `sessionUnknown` and put the
      // traveler on the guest map, which is the demotion loadSession exists
      // to refuse. The lookup already has its verdict; a null here adds
      // nothing to it. A real sign-out arrives as SIGNED_OUT.
      if (
        event === 'INITIAL_SESSION' &&
        session == null &&
        useAuthStore.getState().sessionUnknown
      ) {
        return;
      }
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

  // The way out of "unknown" that does not depend on anybody tapping.
  //
  // A session can be unknown with the server reachable: the boot probe got
  // through while auth-js was still backing off, or auth answered 503 while
  // PostgREST was fine. With the offline card gone (it leaves the moment
  // anything reaches the server) the hold would be mute and permanent, so
  // this asks again whenever both facts hold: the server has been reached
  // and the session is still unknown. Either fact can arrive second, which
  // is why there are two subscriptions feeding one attempt.
  //
  // After SESSION_RETRY_LIMIT tries on a reachable server it gives up and
  // reads the answer as signed out. auth-js still holds the session on disk
  // and its ticker keeps trying; a later TOKEN_REFRESHED arrives through
  // onAuthStateChange above and remounts the app signed in, which is exactly
  // what happened before this file learned the difference. A belt, not the
  // mechanism.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let live = true;

    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };

    const askAgain = () => {
      clearTimer();
      if (!live || inFlight) return;
      const store = useAuthStore.getState();
      if (!store.sessionUnknown || !getEverReached()) return;
      if (attempts >= SESSION_RETRY_LIMIT) {
        store.setSession(null);
        return;
      }
      attempts += 1;
      inFlight = true;
      void retrySession().then(() => {
        inFlight = false;
        if (!live || !useAuthStore.getState().sessionUnknown) return;
        timer = setTimeout(askAgain, SESSION_RETRY_MS);
        // Node only (jest). A pending retry must not hold a test run open.
        (timer as unknown as { unref?: () => void }).unref?.();
      });
    };

    const unsubscribeReach = subscribeToReach(askAgain);
    const unsubscribeStore = useAuthStore.subscribe((state, previous) => {
      if (state.sessionUnknown && !previous.sessionUnknown) askAgain();
    });

    return () => {
      live = false;
      clearTimer();
      unsubscribeReach();
      unsubscribeStore();
    };
  }, []);
}
