import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { endRevokedSession } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import type { AppleCredential } from '@/features/auth/signed-out-reason';
import { readAppleUser } from '@/lib/apple-user';

/**
 * Notice when somebody tells iOS to stop using their Apple ID with this app.
 *
 * This is the INBOUND half and it has no overlap with the outbound one:
 * supabase/functions/delete-account already calls Apple's revoke endpoint
 * when a person deletes their account here. Nothing was watching the other
 * direction, so somebody who went to Settings, found Samewhere under their
 * Apple ID and stopped it stayed signed in and reachable in chat for as long
 * as the refresh token lived. In a product whose whole story is who can reach
 * you, that is the wrong way round.
 *
 * Apple hands the stable user id back only at sign-in, so it is kept in the
 * keychain, which is what expo-apple-authentication's own documentation asks
 * for. Two triggers, because neither is sufficient alone: addRevokeListener
 * fires while the app is running, and the foreground check catches a revoke
 * that happened in Settings while the app was in the background or closed.
 */

/**
 * The last answer we got. The auth listener reads it when a SIGNED_OUT
 * arrives that nobody asked for, so the notice can name Apple rather than
 * guessing. A module variable rather than store state: it is an input to a
 * decision, never something a screen renders.
 */
let lastKnownState: AppleCredential = Platform.OS === 'ios' ? 'unknown' : 'not-apple';

export function appleCredentialSnapshot(): AppleCredential {
  return lastKnownState;
}

/**
 * Ask Apple about this device's credential. Never throws: the simulator
 * throws from getCredentialStateAsync unconditionally (documented in the
 * installed expo-apple-authentication types), and an app that cannot ask is
 * in exactly the state 'unknown' names.
 */
export async function readAppleCredential(): Promise<AppleCredential> {
  if (Platform.OS !== 'ios') {
    lastKnownState = 'not-apple';
    return lastKnownState;
  }
  const user = await readAppleUser();
  if (!user) {
    lastKnownState = 'not-apple';
    return lastKnownState;
  }
  try {
    const state = await AppleAuthentication.getCredentialStateAsync(user);
    // ONLY revoked means revoked. NOT_FOUND and TRANSFERRED are distinct
    // states in the installed types and Apple answers NOT_FOUND whenever the
    // device has no relationship with this credential at all — most often
    // because somebody signed out of iCloud or switched Apple ID, neither of
    // which is a revocation. Reading NOT_FOUND as 'revoked' would end the
    // session of a traveller who did nothing but sign out of iCloud abroad,
    // and tell her Apple had cut her off. Inconclusive is 'unknown', and
    // 'unknown' never ends a session.
    lastKnownState =
      state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED
        ? 'revoked'
        : state === AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED
          ? 'active'
          : 'unknown';
  } catch {
    lastKnownState = 'unknown';
  }
  return lastKnownState;
}

/**
 * Mounted once at the root, beside useAuthListener.
 *
 * On a revoke it ends the session WITHOUT the deliberate flag, so the auth
 * listener does the one thing it already does with an unasked-for sign out:
 * work out a reason and put the notice up. One writer for the notice, and
 * the reason is Apple's because lastKnownState says so.
 */
export function useAppleRevokeWatch() {
  // The LIVE session's provider, not "is there an Apple id in the keychain".
  // The keychain item outlives an ordinary sign-out and an uninstall, so
  // arming on its presence points the watch at a credential that has nothing
  // to do with whoever is signed in now: person A signs in with Apple and
  // signs out, person B signs in with email on the same phone, A removes the
  // app from their Apple ID, and B's session is ended every launch with a
  // notice about an Apple ID B never used.
  const isAppleSession = useAuthStore((s) => s.session?.user?.app_metadata?.provider === 'apple');

  useEffect(() => {
    if (!isAppleSession || Platform.OS !== 'ios') {
      return;
    }
    let active = true;

    const check = async () => {
      const state = await readAppleCredential();
      if (!active || state !== 'revoked') {
        return;
      }
      await endRevokedSession();
    };

    void check();

    const revoked = AppleAuthentication.addRevokeListener(() => {
      lastKnownState = 'revoked';
      void endRevokedSession();
    });
    const foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void check();
      }
    });

    return () => {
      active = false;
      revoked.remove();
      foreground.remove();
    };
  }, [isAppleSession]);
}
