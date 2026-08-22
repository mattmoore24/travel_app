import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
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
    redirectTo: 'samewhere://reset-password',
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
