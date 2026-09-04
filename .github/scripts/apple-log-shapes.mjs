// The exact strings `delete-account` and `store-apple-token` can write to the
// log, and what each one means for the question "did the Apple revoke run?".
//
// Split out of read-apple-revoke-log.mjs so it can be tested. That is not a
// formality: this file is a mirror of two Edge Functions, and a mirror drifts.
// If somebody edits a log string in supabase/functions and not this list, the
// reader silently reclassifies a real answer as "(unrecognised shape,
// withheld)" and the run reports nothing while looking like it worked - the
// same failure the reader exists to catch, one level up.
// `.github/scripts/__tests__/apple-log-shapes.test.ts` reads those two
// functions and fails when a string they can emit is not recognised here.
//
// Pure by construction: no I/O, no environment, no side effects on import.

import { createHash } from 'node:crypto';

/** A stable name for a value, so two occurrences can be compared without either being printed. */
export function bucket(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/**
 * Scrub a diagnostic detail before it is allowed anywhere near the log.
 *
 * These details come from Apple, from Postgres and from thrown errors, and
 * none of them is supposed to carry personal data. "Supposed to" is not the
 * standard a public log gets held to, so anything shaped like an identifier
 * goes first and the remainder is capped.
 */
export function scrub(detail) {
  return detail
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '(uuid)')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '(email)')
    .replace(/eyJ[\w-]{8,}\.[\w-]+\.[\w-]+/g, '(jwt)')
    .replace(/[A-Za-z0-9_-]{40,}/g, '(token)')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Every line either function can emit, in the order the code tries them.
// `verdict` is what the line means for the question this script asks:
//   pass    Apple was contacted and agreed
//   fail    the revoke definitely did not happen
//   quiet   nothing went wrong, and nothing is proven either
export const SHAPES = [
  {
    match: /^apple revoke: ok \((\d{3})\)$/,
    name: 'delete-account: Apple accepted the revoke',
    verdict: 'pass',
    capture: (m) => `HTTP ${m[1]} from appleid.apple.com/auth/revoke`,
  },
  {
    match: /^apple revoke: no token for this account, nothing to revoke$/,
    name: 'delete-account: no stored Apple token, nothing was revoked',
    verdict: 'quiet',
    capture: () => 'either the account never used Apple, or the sign-in stored nothing',
  },
  {
    match: /^apple revoke: Sign in with Apple key not provisioned; token NOT revoked$/,
    name: 'delete-account: the key is missing, the grant is still live',
    verdict: 'fail',
    capture: () => 'one of the four APPLE_* function secrets is unset',
  },
  {
    match: /^apple revoke: failed \((\d{3})\): ([\s\S]*)$/,
    name: 'delete-account: Apple refused the revoke',
    verdict: 'fail',
    capture: (m) => `HTTP ${m[1]}, Apple said: ${scrub(m[2])}`,
  },
  {
    match: /^apple revoke: could not read token: ([\s\S]*)$/,
    name: 'delete-account: the stored token could not be read',
    verdict: 'fail',
    capture: (m) => scrub(m[1]),
  },
  {
    match: /^apple revoke: threw: ([\s\S]*)$/,
    name: 'delete-account: the revoke threw',
    verdict: 'fail',
    capture: (m) => scrub(m[1]),
  },
  {
    match: /^store-apple-token: Sign in with Apple key not provisioned; nothing stored$/,
    name: 'store-apple-token: the key was missing at sign-in, so nothing was stored',
    verdict: 'fail',
    capture: () => 'this sign-in can never be revoked; only a later sign-in can be',
  },
  {
    match: /^store-apple-token: exchange threw: ([\s\S]*)$/,
    name: 'store-apple-token: the code exchange threw',
    verdict: 'fail',
    capture: (m) => scrub(m[1]),
  },
  {
    match: /^store-apple-token: exchange (\d{3}): ([\s\S]*)$/,
    name: 'store-apple-token: Apple refused the code exchange',
    verdict: 'fail',
    capture: (m) => `HTTP ${m[1]}, Apple said: ${scrub(m[2])}`,
  },
  {
    match: /^store-apple-token: upsert failed: ([\s\S]*)$/,
    name: 'store-apple-token: the token could not be stored',
    verdict: 'fail',
    capture: (m) => scrub(m[1]),
  },
];

/**
 * The Apple part of a log row, with anything the platform wrapped around it
 * removed.
 *
 * The shapes below anchor at `^`, and an anchor is a bet that `event_message`
 * carries the console line and nothing else. That bet is probably right and is
 * not worth a CI run to find out, so the line is trimmed to the first marker
 * first. What sits before the marker is dropped, never printed, so this makes
 * the reader more tolerant without making it less careful.
 */
export function appleLine(message) {
  const marks = ['apple revoke:', 'store-apple-token:']
    .map((mark) => message.indexOf(mark))
    .filter((at) => at >= 0);
  return marks.length === 0 ? message : message.slice(Math.min(...marks)).trim();
}

export function classify(rawMessage) {
  const message = appleLine(rawMessage);
  for (const shape of SHAPES) {
    const found = shape.match.exec(message);
    if (found) {
      return { name: shape.name, verdict: shape.verdict, detail: shape.capture(found) };
    }
  }
  // The allowlist held. A line this file has never seen does not get to print
  // itself just because it matched the SQL prefix.
  return {
    name: '(unrecognised shape, withheld)',
    verdict: 'quiet',
    detail: `sha256 ${bucket(message)}, ${message.length} characters`,
  };
}
