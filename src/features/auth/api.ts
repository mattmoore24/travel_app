import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { PASSWORD_RESET_REDIRECT } from '@/constants/links';
import { clearIconBadge } from '@/features/notifications/badge';
import { forgetPushToken } from '@/features/notifications/push';
import { forgetAppleUser, rememberAppleUser } from '@/lib/apple-user';
import { forgetLastEmail, rememberLastEmail } from '@/lib/last-email';
import { supabase } from '@/lib/supabase';

/**
 * "Somebody on this device asked for this."
 *
 * supabase-js fires one SIGNED_OUT event whether the person tapped Sign out
 * or the server threw the refresh token away, so the auth listener cannot
 * tell a deliberate sign-out from a forced one without being told. It is set
 * here rather than at the six call sites so there is exactly one place to be
 * right about it.
 *
 * BOTH a flag and a window, and the difference matters more than it looks.
 *
 * The flag is what actually answers the question, because auth-js does its
 * network POST to /logout BEFORE it removes the session and emits
 * SIGNED_OUT, and that POST has no client timeout. On hostel wifi the round
 * trip is routinely slower than any window worth calling an echo window, so
 * a window alone tells somebody who just tapped Sign out that their session
 * ended for reasons nobody can name. It is worse on Delete account, where
 * the notice pre-empts the stack and swallows the replace to /join.
 *
 * The window only suppresses the ECHO: a second, unflagged SIGNED_OUT
 * arriving within a second of the one the listener consumed. It is stamped
 * at the moment of that consumption, not at the moment of the request, so it
 * measures the gap between two events rather than the length of a network
 * call.
 *
 * So: the flag survives however long the logout takes, the listener consumes
 * it once, and the window covers the tail. Neither half does this alone.
 */
const ECHO_WINDOW_MS = 1000;
let deliberate = false;
let consumedAt: number | null = null;

function markDeliberateSignOut() {
  deliberate = true;
}

export function signOutWasDeliberate(now = Date.now()): boolean {
  return deliberate || (consumedAt != null && now - consumedAt <= ECHO_WINDOW_MS);
}

/**
 * Called by the auth listener from its SIGNED_OUT branch, once per event.
 * Lowers the flag and starts the echo window in the same move, so the answer
 * to "did somebody ask for this" stays true for the echo and goes false for
 * the next genuine forced sign-out.
 */
export function consumeDeliberateSignOut(now = Date.now()) {
  if (deliberate) {
    deliberate = false;
    consumedAt = now;
  }
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  // Only ever after a success, so a typo is never the address offered back.
  void rememberLastEmail(email);
}

/**
 * Become a guest: a real auth user with no email, so a session exists and
 * everything downstream (RLS, chat membership, message authorship) works
 * with no second identity system behind it.
 *
 * The name is a separate call on purpose. signInAnonymously has to land
 * first, because set_guest_name writes to the profile row the auth trigger
 * creates in response to it.
 */
export async function signInAsGuest(name: string) {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw error;
  }
  const { data, error: nameError } = await supabase.rpc('set_guest_name', { p_name: name });
  if (nameError) {
    // A guest with no name is worse than no guest: they would show up in a
    // room as nobody. Undo the half-made identity rather than leave it. This
    // one IS deliberate: the person asked for a guest account and got no
    // account, which is a failure to report, never a session that vanished.
    markDeliberateSignOut();
    await supabase.auth.signOut().catch(() => {});
    throw nameError;
  }
  return data as string;
}

export async function renameGuest(name: string) {
  const { data, error } = await supabase.rpc('set_guest_name', { p_name: name });
  if (error) {
    throw error;
  }
  return data as string;
}

/**
 * Turn a guest into a member WITHOUT losing anything they have done.
 *
 * updateUser on an anonymous session adds the email to the SAME auth row, so
 * the user id never changes and every chat, membership and message they
 * already have simply belongs to a member now. A fresh signUp would mint a
 * second id and strand all of it, which is the whole reason the guest is an
 * auth user rather than a row in a table of our own.
 */
export async function upgradeGuestToAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.updateUser({ email, password });
  if (error) {
    throw error;
  }
  void rememberLastEmail(email);
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
  void rememberLastEmail(email);
  return data;
}

/**
 * Send a "set a new password" link. The link opens the app through the
 * scheme registered in app.json, which lands on /reset-password with a
 * recovery session already established by the SDK's deep-link handler.
 *
 * Callers must NOT report whether the address had an account: that answer
 * turns this into an oracle anybody could use to learn who is on here.
 */
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: PASSWORD_RESET_REDIRECT,
  });
  if (error) {
    throw error;
  }
}

/** Finish a recovery: only works while the recovery session is live. */
export async function setNewPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw error;
  }
  // Make the sentence on the reset screen true. It promises "signed out
  // everywhere else", which no code in this repo set until now — it depended
  // on a dashboard toggle nobody here controls. scope 'others' revokes every
  // OTHER session and, per the installed @supabase/auth-js types, "there is
  // no sign-out event fired on the current session" — so the person who just
  // saved stays signed in here. Best effort: the password change is the
  // security event, and it already succeeded.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
}

/**
 * Change the password from inside the app, with the current one checked.
 *
 * supabase.auth.updateUser({ password }) does NOT verify the old password, so
 * anybody holding an unlocked phone could change it and lock the owner out.
 * The check is a real signInWithPassword against the session's own address,
 * which is why a few wrong tries reach the rate limiter and why the caller
 * has to tell "wait" apart from "wrong" (see credentialsFailure).
 *
 * The re-sign-in mints a fresh session for the same user, so nothing is lost
 * and no route changes underneath the person doing it. A failed one does not
 * touch the session that already exists.
 */
export async function changePassword(current: string, next: string) {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) {
    throw new Error('This account has no email address to check the password against.');
  }
  const { error: checkFailed } = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });
  if (checkFailed) {
    throw checkFailed;
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    throw error;
  }
  // The same thing setNewPassword does, for the same reason: a password
  // change is the remedy after a phone is taken, and it is only a remedy if
  // it ends the sessions that phone is holding. 'others' leaves this one
  // alone (per the installed @supabase/auth-js types), so the person who just
  // saved stays where they are.
  //
  // The RESULT is returned rather than swallowed, and the caller says which
  // happened. auth-js returns { error } instead of throwing for API failures,
  // so a bare .catch() discards it twice over — and the screen then told
  // somebody whose phone was stolen that the thief's session was dead when a
  // network blip had left it live until the refresh token expired. A security
  // claim may only be made by the code that knows it is true.
  const { error: othersFailed } = await supabase.auth
    .signOut({ scope: 'others' })
    .catch(() => ({ error: new Error('unreachable') }));
  return { othersSignedOut: othersFailed == null };
}

/**
 * Start an email change. GoTrue sends a confirmation link and the address
 * does NOT move until it is opened, so nothing here writes the new address
 * anywhere: the old one stays the sign-in address, and stays the one
 * last-email offers back, until the round trip finishes.
 */
export async function changeEmail(next: string) {
  const { error } = await supabase.auth.updateUser({ email: next.trim() });
  if (error) {
    throw error;
  }
}

/**
 * Sign out THIS DEVICE, which is what every button that says "Sign out"
 * means. The library's own default is 'global' (verified against the
 * installed @supabase/auth-js GoTrueClient.d.ts), which revokes every
 * refresh token the account holds — so the escape hatch on a flaky cold
 * start was signing a traveler out on their iPad, and Cancel on the
 * password-reset screen meant sign out everywhere. 'global' survives only as
 * the explicit "Sign out on all devices" row on the profile.
 *
 * The push token goes first, while the session the delete-own policy checks
 * is still live. forgetPushToken never throws, so it can never hold the door
 * shut — and auth-js removes the local session even when the revoke call
 * fails on hostel wifi, so neither can the network.
 */
export async function signOut({ scope = 'local' }: { scope?: 'local' | 'global' } = {}) {
  // The race is a fence against any future edit making forgetPushToken slow
  // again: today it is one bounded delete from a cached token, but sign-out
  // must never wait on the network regardless.
  await Promise.race([forgetPushToken(), new Promise<void>((r) => setTimeout(r, 4000))]);
  // A shared phone must not carry this account's waiting count onto the next
  // person's home screen, and nothing else would clear it until they opened
  // the Chat tab. Alongside the token, for the same reason.
  await clearIconBadge();
  // Immediately before the call that fires the event, never before the race:
  // the flag's window is a second wide and the race is allowed four.
  markDeliberateSignOut();
  const { error } = await supabase.auth.signOut({ scope });
  if (error) {
    // auth-js removes the LOCAL session before returning a network error, so
    // a dead revoke call on hostel wifi is not a failed sign-out: the person
    // is signed out of this device either way, and an alert saying "Sign out
    // failed" over the sign-in screen would be wrong twice. Only a survivor
    // session makes the error real. (signOutEverywhere keeps throwing on any
    // error: a global revoke that died genuinely did not do its job.)
    const { data } = await supabase.auth.getSession();
    if (data.session != null) {
      throw error;
    }
  }
  // The Apple credential belongs to the session that just ended, not to the
  // phone. Keeping it would arm the revoke watch against a stale id for
  // whoever signs in next. The remembered EMAIL is the opposite case and
  // deliberately survives this (D39): it is an address to offer back, not a
  // credential to act on.
  await forgetAppleUser();
}

/**
 * The lost-phone remedy, behind the one button that says so. A named export
 * rather than a scope argument at the call site, so "which sign-outs are
 * global" stays answerable by searching for this name — no call site outside
 * this file passes a scope.
 */
export async function signOutEverywhere() {
  await signOut({ scope: 'global' });
  // "All devices" includes this one becoming somebody else's. Founder
  // decision D39 keeps the remembered address across an uninstall and clears
  // it at the two moments that mean the phone may not be yours any more.
  await forgetLastEmail();
  await forgetAppleUser();
}

/**
 * End a session nobody asked to end.
 *
 * The Apple-revoke watch is the one caller: the person told iOS to stop using
 * their Apple ID with this app, so the session has to go, and the auth
 * listener must be free to say so. Deliberately does NOT mark the sign-out,
 * which is the whole difference between this and signOut() — everything else
 * about it is the same, including the push token going first while the
 * delete-own policy can still see auth.uid().
 */
export async function endRevokedSession() {
  await Promise.race([forgetPushToken(), new Promise<void>((r) => setTimeout(r, 4000))]);
  await clearIconBadge();
  // Local: revoking the credential is Apple's business with this device, and
  // a global revoke would sign the person out of a phone they still hold.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  // The credential we just acted on is dead. Forgetting it here is what stops
  // the loop: without this, the next sign-in on this phone — by anybody, with
  // any method — re-arms the watch against the same revoked id and is ended
  // again, every launch, blaming an Apple ID the new session never used.
  await forgetAppleUser();
}

/**
 * Native Sign in with Apple. Requires the entitlement, so it works in EAS
 * builds but not in Expo Go — callers should gate on appleSignInAvailable().
 */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return false;
  }
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Hand the authorization code to the server, which exchanges it for the
 * refresh token that lets delete-account call Apple's revoke endpoint.
 *
 * Fire and log, never throw. Apple gives the code once per sign-in and it is
 * good for five minutes, so this is the only moment it can be captured — but
 * an account that could not be signed in is worse than one whose revoke has
 * to be done by hand later, and the store call must never reach the sign-in
 * path's error handler. Until the Sign in with Apple key is provisioned the
 * function answers `stored: false` and this is a logged no-op.
 */
async function storeAppleAuthorizationCode(code: string | null) {
  if (!code) {
    return;
  }
  try {
    const { error } = await supabase.functions.invoke('store-apple-token', {
      body: { code },
    });
    if (error) {
      console.warn('Could not store the Apple token:', error.message);
    }
  } catch (e) {
    console.warn('Could not store the Apple token:', e);
  }
}

export async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) {
    throw error;
  }
  // After the session exists, so the edge function can authenticate the
  // caller, and deliberately not awaited: nothing about signing in waits on a
  // round trip to Apple.
  void storeAppleAuthorizationCode(credential.authorizationCode);
  // Apple returns the stable user id only at sign-in, and it is the only
  // handle getCredentialStateAsync accepts. Keychain, per Apple's own
  // guidance and expo-apple-authentication's docs.
  void rememberAppleUser(credential.user);
}
