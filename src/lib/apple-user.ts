import * as SecureStore from 'expo-secure-store';

/**
 * Apple's stable user id for this device, which is the only handle
 * `getCredentialStateAsync` accepts.
 *
 * Apple hands it back at sign-in and never again, so it has to be kept —
 * expo-apple-authentication's own documentation asks for exactly this. It
 * lives in its own module rather than beside the watch that reads it because
 * the sign-in path writes it and the watch calls back into the sign-in
 * module: one shared leaf keeps that from being an import cycle.
 *
 * Cleared with the remembered address, at the two moments that mean this
 * phone may not be yours any more (founder decision D39).
 */
const APPLE_USER_KEY = 'apple_user';

export async function rememberAppleUser(user: string): Promise<void> {
  if (user.length === 0) {
    return;
  }
  try {
    await SecureStore.setItemAsync(APPLE_USER_KEY, user);
  } catch {
    // Without it the credential watch answers 'not-apple', which is exactly
    // the behaviour the app had before it existed.
  }
}

export async function readAppleUser(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(APPLE_USER_KEY);
  } catch {
    return null;
  }
}

export async function forgetAppleUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(APPLE_USER_KEY);
  } catch {
    // A failed clear must not break the delete it is part of.
  }
}
