/**
 * The domains people actually mistype, and what they meant.
 *
 * Email confirmation is off for v1 (docs/LAUNCH_RUNBOOK.md), so a typo at
 * signup produces a working account that never receives a single piece of
 * mail revealing the mistake - and password reset is deliberately oracle-free,
 * so the account is then unrecoverable, including through support. The
 * validator on the field is only a shape check: `a@gmial.com` passes it
 * perfectly.
 *
 * A near-miss list rather than a distance function on purpose. Edit distance
 * would "correct" real addresses at real domains nobody here has heard of,
 * and this is a nudge under a field, not a gate: the person can ignore it and
 * carry on, so it must never be wrong about an address that works.
 */
const LOOKALIKES: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'yahho.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com',
  'icloud.co': 'icloud.com',
  'icloud.con': 'icloud.com',
  'iclould.com': 'icloud.com',
  'protonmai.com': 'protonmail.com',
};

/**
 * The address somebody probably meant, or null when there is nothing to say.
 *
 * Deliberately silent on `yahoo.co.uk`, `gmail.com.au` and every other real
 * address that merely looks like one of the keys: the match is on the WHOLE
 * domain, not on a prefix.
 */
export function likelyEmailTypo(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  const meant = LOOKALIKES[domain];
  return meant ? `${local}@${meant}` : null;
}
