/**
 * The rules behind "Email and password", as pure functions with tests.
 *
 * The only route to a password change used to be "Forgot your password?" on
 * the signed-out screen, so a traveler whose phone was taken had to give up
 * her session, remember which address she had used, leave for a mail app on
 * hostel wifi and come back through a deep link. There was no route to an
 * email change at all, which made losing an inbox the same as losing the
 * account.
 */
export const PASSWORD_MIN = 8;

/** Same shape the sign-up screen uses, deliberately: one rule, two doors. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Everything wrong with a password change, in the order a person meets it.
 * Null means it can be sent.
 *
 * `provider` is `session.user.app_metadata.provider`. An account made through
 * Sign in with Apple has no password at all, so the honest answer is a
 * sentence rather than a form that can never succeed.
 */
export function credentialsProblem({
  current,
  next,
  provider,
}: {
  current: string;
  next: string;
  provider: string | undefined;
}): string | null {
  if (provider === 'apple') {
    return 'This account signs in with Apple, so there is no password to change here.';
  }
  if (current.length === 0) {
    return 'Type the password you use now.';
  }
  if (next.length < PASSWORD_MIN) {
    return `A new password needs at least ${PASSWORD_MIN} characters.`;
  }
  if (next === current) {
    return 'That is the password you already have.';
  }
  return null;
}

/**
 * The same for an email change. `currentAddress` is the address the session
 * is under, so the screen can refuse the no-op before spending a round trip
 * and a rate-limit slot on it.
 */
export function emailChangeProblem(next: string, currentAddress: string | null): string | null {
  const address = next.trim();
  if (address.length === 0) {
    return 'Type the address you want to use.';
  }
  if (!EMAIL_PATTERN.test(address)) {
    return 'Check that address and try again.';
  }
  if (currentAddress != null && address.toLowerCase() === currentAddress.trim().toLowerCase()) {
    return 'That is the address you already use.';
  }
  return null;
}

/**
 * Turn what GoTrue says into something a person can act on.
 *
 * Re-checking the current password is a real sign-in attempt, so a few wrong
 * tries reach the rate limiter. That answer has to read as "wait", never as
 * "wrong password", or somebody who typed it right the fourth time is told
 * they typed it wrong.
 */
export function credentialsFailure(e: unknown): string {
  const raw = (e as { message?: unknown })?.message;
  const text = typeof raw === 'string' ? raw : '';
  if (/for security purposes|rate limit|too many/i.test(text)) {
    return 'Too many tries just now. Wait a minute and go again.';
  }
  if (/invalid login credentials|invalid_credentials/i.test(text)) {
    return 'That is not the password on this account.';
  }
  if (/already been registered|already registered|already exists/i.test(text)) {
    return 'There is already an account on that address.';
  }
  if (/same(_| )password|should be different/i.test(text)) {
    return 'That is the password you already have.';
  }
  return 'That did not go through. Try again in a moment.';
}
