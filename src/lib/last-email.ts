import * as SecureStore from 'expo-secure-store';

/**
 * The address this device last signed in with.
 *
 * Sign-in deliberately refuses to say whether the address or the password was
 * wrong (see (auth)/email.tsx), which is the right answer for an account
 * oracle and the wrong one for somebody who simply cannot remember which of
 * their two addresses they used. Remembering it turns a reinstall, and the
 * forced-sign-out notice, into one tap.
 *
 * Founder decision D39: it stays in the keychain ACROSS an uninstall, because
 * the returning traveler is the person this exists for. The cost is that
 * keychain items outlive the app on a resold phone, so it is cleared
 * explicitly at the two moments that mean "this device is not mine any more":
 * Delete account, and "Sign out on all devices".
 *
 * An address is not a credential, so it lives in SecureStore whole rather
 * than through SecureSessionStore's split-key ceremony, and every call
 * swallows its own failure: a keychain that will not answer must never be
 * able to stop somebody signing in.
 */
const LAST_EMAIL_KEY = 'last_email';

export async function rememberLastEmail(email: string): Promise<void> {
  const address = email.trim();
  if (address.length === 0) {
    return;
  }
  try {
    await SecureStore.setItemAsync(LAST_EMAIL_KEY, address);
  } catch {
    // Prefilling is a convenience. Losing it is not worth an error anybody sees.
  }
}

export async function readLastEmail(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function forgetLastEmail(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_EMAIL_KEY);
  } catch {
    // Same reason: a failed clear must not break the delete it is part of.
  }
}
