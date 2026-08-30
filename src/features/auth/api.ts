import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { PASSWORD_RESET_REDIRECT } from '@/constants/links';
import { supabase } from '@/lib/supabase';

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
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
    // room as nobody. Undo the half-made identity rather than leave it.
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
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
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
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
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
}
