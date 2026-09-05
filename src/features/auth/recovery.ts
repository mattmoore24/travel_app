import { isOffline } from '@/lib/failure-message';

/**
 * Reading a Supabase recovery mail, both ways it can arrive.
 *
 * THE LINK. The client is configured with `detectSessionInUrl: false`, which
 * is right for a native app — there is no browser URL to watch — but it
 * means nothing picks the tokens out of the link Supabase mails.
 * `parseRecoveryLink` does. Supabase puts them in the URL FRAGMENT on the
 * implicit flow (`samewhere://reset-password#access_token=...&type=recovery`)
 * and in the query string on some clients, so both are read. A fragment
 * never reaches a server, which is the point of putting them there.
 *
 * THE CODE. Six digits typed into app/(auth)/reset-code and checked by
 * `verifyRecoveryCode` (features/auth/api). The two constants and the two
 * sentence-pickers below are the code path's share of this file; they are
 * pure so the screen's states can be tested as the sentences they are.
 */

/** Six, which is Supabase's default OTP length and the number every sentence about the code says. */
export const RECOVERY_CODE_LENGTH = 6;

/**
 * How long a recovery code is good for: GoTrue's default OTP expiry (3600s,
 * Authentication → Sign In / Providers → Email → "Email OTP expiration"),
 * and the hour the sign-in screen has always promised for the link. The
 * screen flips its own copy at this age rather than waiting for a refusal,
 * the way the business code screen does with its twenty minutes.
 */
export const RECOVERY_CODE_TTL_MS = 60 * 60 * 1000;

/**
 * What the code box says when the server refused the digits.
 *
 * One sentence for wrong AND expired, because GoTrue sends one answer for
 * both (403 `otp_expired`, "Token has expired or is invalid"): pretending to
 * know which would be wrong half the time. A rate limiter answering must
 * never read as a wrong code, which is the same rule `identityProblem` and
 * `credentialsFailure` keep for the password forms.
 */
export function recoveryCodeProblem(e: unknown): string {
  if (isOffline(e)) {
    return 'No connection. Checking the code needs the internet.';
  }
  const raw = (e as { message?: unknown })?.message;
  const text = typeof raw === 'string' ? raw : '';
  const code = (e as { code?: unknown })?.code;
  if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(text)) {
    return 'Too many tries just now. Wait a minute and go again.';
  }
  if (code === 'otp_expired' || /expired|invalid/i.test(text)) {
    return 'That code is not right, or it has run out. Check the digits, or send yourself a new one.';
  }
  return 'Could not check that code. Try again in a moment.';
}

/**
 * What "Send it again" says afterwards.
 *
 * Optimistic on purpose for everything the sender could not have caused:
 * telling somebody "no account with that address" is an account-existence
 * oracle, so a refusal for that reason reads as 'sent' here exactly as it
 * does on the sign-in screen. Two refusals ARE worth naming, because neither
 * leaks anything: GoTrue's per-address send throttle ("For security
 * purposes, you can only request this after N seconds"), which means a code
 * is already on its way, and no connection at all, which means nothing left
 * the phone.
 */
export function resendOutcome(e: unknown): 'sent' | 'wait' | 'offline' {
  if (e == null) {
    return 'sent';
  }
  if (isOffline(e)) {
    return 'offline';
  }
  const raw = (e as { message?: unknown })?.message;
  const text = typeof raw === 'string' ? raw : '';
  const code = (e as { code?: unknown })?.code;
  if (code === 'over_email_send_rate_limit' || /for security purposes|rate limit/i.test(text)) {
    return 'wait';
  }
  return 'sent';
}

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

function paramsFrom(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  // Everything after the first '#' is the fragment; everything between the
  // first '?' and that is the query. Both are 'k=v&k=v'.
  const hash = url.indexOf('#');
  const fragment = hash >= 0 ? url.slice(hash + 1) : '';
  const beforeHash = hash >= 0 ? url.slice(0, hash) : url;
  const question = beforeHash.indexOf('?');
  const query = question >= 0 ? beforeHash.slice(question + 1) : '';
  for (const part of [query, fragment]) {
    if (part.length === 0) {
      continue;
    }
    for (const [key, value] of new URLSearchParams(part)) {
      merged.set(key, value);
    }
  }
  return merged;
}

/**
 * Null for any link that is not a password recovery — including ordinary
 * deep links into the app, which must pass through untouched.
 */
export function parseRecoveryLink(url: string | null | undefined): RecoveryLink | null {
  // Both spellings, deliberately. The scheme link is samewhere://reset-password;
  // the hosted page is link.samewhere.io/reset, with no `-password` in it. This
  // hook sees the raw URL before the router does, so if a universal link ever
  // hands the app the hosted spelling — a forwarded mail, a link-rewriting
  // gateway, a stale copy of the association file on Apple's CDN — the token
  // is caught here instead of being spent on +not-found. A recovery token is
  // single use: a link this function fails to recognise is not bounced, it is
  // burned. The trailing class keeps `/reset` from matching a path that merely
  // starts with those letters.
  if (!url || !/\/reset(-password)?(?:[/#?]|$)/.test(url)) {
    return null;
  }
  const params = paramsFrom(url);

  // An expired or already-used link comes back as an error, and saying so is
  // the whole difference between "try again" and a screen that does nothing.
  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    return { kind: 'error', message: humanize(error) };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }
  return null;
}

function humanize(raw: string): string {
  const text = raw.replace(/\+/g, ' ');
  if (/expired|invalid/i.test(text)) {
    return 'That link has expired. Ask for a new one and open it within the hour.';
  }
  return 'That link did not work. Ask for a new one.';
}
