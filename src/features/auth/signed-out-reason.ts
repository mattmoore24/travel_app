/**
 * Why the session ended, when nobody on this device asked for it.
 *
 * supabase-js emits one SIGNED_OUT event whether the person tapped Sign out
 * or the server refused the refresh token, so the app used to answer both the
 * same way: reset analytics, clear the cache, and become the signed-out app
 * with no word said. Chats, pins and the avatar simply went, which reads as
 * data loss rather than as a session ending.
 *
 * Kept as a pure function so the mapping has a test. The listener supplies
 * the two facts it holds (did anybody ask, and what does Apple say about this
 * device's credential) and gets back either a reason to show or null.
 */

/** What `getCredentialStateAsync` last told us, plus the two absences. */
export type AppleCredential = 'revoked' | 'active' | 'not-apple' | 'unknown';

export type SignedOutReason = 'revoked' | 'apple-revoked' | 'unknown';

export function signedOutReason(
  event: string,
  userInitiated: boolean,
  appleState: AppleCredential
): SignedOutReason | null {
  if (event !== 'SIGNED_OUT') {
    return null;
  }
  // Getting this wrong in the other direction is worse than the bug it
  // closes: a deliberate sign out answered with "you have been signed out"
  // reads as a fault in the app.
  if (userInitiated) {
    return null;
  }
  if (appleState === 'revoked') {
    return 'apple-revoked';
  }
  // 'not-apple' is as informative as 'active' here: both say the credential
  // this device signs in with is intact, so it was the session that went.
  if (appleState === 'active' || appleState === 'not-apple') {
    return 'revoked';
  }
  return 'unknown';
}

/**
 * One line naming the likely cause. It never claims more than the event
 * supports, which is why the 'unknown' case says nothing about a device.
 */
export function signedOutNoticeCopy(reason: SignedOutReason): { title: string; body: string } {
  if (reason === 'apple-revoked') {
    return {
      title: "You're signed out",
      body: 'Your Apple ID stopped being used with Samewhere, so this device signed out.',
    };
  }
  if (reason === 'revoked') {
    // Two causes, and the line names both rather than picking one: an
    // account signed out on another device, and an account that is gone
    // (deleted, or a guest the 30 day sweep collected). Promising that
    // nothing is lost would be a lie to the second person.
    return {
      title: "You're signed out",
      body: 'Your session ended on this device. That happens when an account is signed out somewhere else, or closed.',
    };
  }
  return {
    title: "You're signed out",
    body: 'Your session ended on this device, and we cannot say why from here.',
  };
}
