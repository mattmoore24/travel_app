import type { BusinessLinkJson, BusinessLinkKind } from '@/lib/database.types';

/**
 * Where a handle lives, for the kinds a place may store as a bare handle.
 *
 * TikTok keeps the @ in its own URLs; the others do not, so the value's own
 * leading @ is stripped and each base puts back whatever it needs.
 */
const HANDLE_BASE: Partial<Record<BusinessLinkKind, string>> = {
  instagram: 'https://instagram.com/',
  tiktok: 'https://tiktok.com/@',
  facebook: 'https://facebook.com/',
  x: 'https://x.com/',
};

/**
 * Where a link actually goes.
 *
 * The scheme fallback is the one that matters: a place types "example.com"
 * into its own listing, and `openURL` on a string with no scheme does
 * nothing at all - which on the screen is indistinguishable from a dead
 * button.
 *
 * Two kinds are not web addresses at all and were being treated as if they
 * were. A WhatsApp link is stored as a PHONE NUMBER - the database insists on
 * it and rejects a wa.me URL outright - so every one of them was becoming
 * `https://+34 600 123 456`, which iOS happily percent-encodes and opens in
 * Safari on a dead host. And a social handle is invited as "@yourplace" by
 * the editor's own placeholder, which became `https://@yourplace`.
 */
export function hrefFor(link: BusinessLinkJson): string {
  const value = link.value.trim();
  if (link.kind === 'phone') {
    return `tel:${value.replace(/\s/g, '')}`;
  }
  if (link.kind === 'email') {
    return `mailto:${value}`;
  }
  if (link.kind === 'whatsapp') {
    // wa.me wants digits only, country code included and no plus.
    return `https://wa.me/${value.replace(/\D/g, '')}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }
  const base = HANDLE_BASE[link.kind];
  return base ? `${base}${value.replace(/^@+/, '')}` : `https://${value}`;
}

/**
 * Which link kinds open INSIDE the app, in an SFSafariViewController with a
 * Done button, rather than throwing the reader out to Safari.
 *
 * Only the two that are pure reading: a business's own site and its menu.
 * Everything else is deliberately left to `Linking.openURL`, and each for its
 * own reason:
 *
 * - `phone`, `email`, `whatsapp` are not web addresses at all. `tel:` and
 *   `mailto:` have nothing to render, and wa.me is claimed by WhatsApp.
 * - `instagram`, `tiktok`, `facebook`, `x` are https URLs the native apps
 *   claim as universal links. An in-app browser intercepts that and shows a
 *   signed-out web view instead of the app the person is already logged into.
 * - `reservations` and `tickets` end in somebody typing a card number. That
 *   belongs in the browser that has their autofill and their password
 *   manager, not in a web view inside a travel app.
 * - `other` is unknown by definition, so it gets the conservative path.
 */
export function opensInAppBrowser(kind: BusinessLinkKind): boolean {
  return kind === 'website' || kind === 'menu';
}

/**
 * The hosts that exist to hide a destination.
 *
 * A shortener defeats every check anybody could make on a business's link,
 * including the classifier the label already goes through: whatever is
 * reviewed is `bit.ly/x3f9`, and what opens is decided later by somebody
 * else's redirect. A denylist is a denylist and will be out of date the week
 * it ships. It raises the cost of the lazy version without claiming to stop
 * the determined one, so nothing here says a link is SAFE - only that this
 * one is hiding where it goes.
 */
const SHORT_LINK_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'goo.gl',
  'rb.gy',
  'cutt.ly',
  'shorturl.at',
  'ow.ly',
]);

/** Where a handle-bearing kind is supposed to land, derived from HANDLE_BASE. */
const HANDLE_HOST: Partial<Record<BusinessLinkKind, string>> = {
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
  facebook: 'facebook.com',
  x: 'x.com',
};

/**
 * The host a link will really open, or null when it is not a web address at
 * all.
 *
 * Read from `hrefFor`, never from `link.value`, so it cannot disagree with
 * what the tap actually does - a handle and a full URL for the same account
 * have to answer the same way.
 *
 * The part after the LAST `@` is the host. `https://casaazul.com@evil.test/`
 * is a valid URL whose host is `evil.test`, and reading it left to right is
 * the oldest way to make a link look like somewhere it is not.
 */
export function hostOf(link: BusinessLinkJson): string | null {
  const href = hrefFor(link);
  const match = /^https?:\/\/([^/?#]+)/i.exec(href);
  if (!match) {
    return null;
  }
  const authority = match[1];
  const afterUserInfo = authority.slice(authority.lastIndexOf('@') + 1);
  // A bracketed IPv6 literal keeps its brackets; everything else loses a port.
  const host = afterUserInfo.startsWith('[')
    ? afterUserInfo.slice(0, afterUserInfo.indexOf(']') + 1)
    : afterUserInfo.split(':')[0];
  return host.toLowerCase() || null;
}

/** A host that is a bare address rather than a name somebody registered. */
function isBareAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

/** Whether a link goes through one of the hosts that hide their destination. */
export function isShortLink(link: BusinessLinkJson): boolean {
  const host = hostOf(link);
  return host != null && SHORT_LINK_HOSTS.has(host);
}

/**
 * What to tell a reader about a link whose destination its label cannot be
 * trusted against, in one sentence, or null when there is nothing to say.
 *
 * This is the only place in the app where content somebody typed sends a
 * traveler to an arbitrary address, and the row that does it wears
 * Samewhere's chrome. The database screens a link's LABEL through the same
 * classifier a message goes through, which catches a label that says
 * something vile and cannot say a word about where the link ends up.
 *
 * So the reader gets the destination instead of a promise about it. Three
 * cases and no more, because a caution on every row is a caution nobody
 * reads:
 *
 * - a shortener, where nothing on this screen can know the end of it;
 * - a bare IP address, which no real business publishes;
 * - a social link that leaves the platform it is filed under, which is the
 *   value saying something different from the kind.
 *
 * Deliberately NOT a refusal. These rows are already in the database, the
 * check that should have stopped them belongs at write time, and an app that
 * silently drops a bar's booking link is worse than one that says where it
 * goes.
 */
export function linkCaution(link: BusinessLinkJson): string | null {
  const host = hostOf(link);
  if (host == null) {
    return null;
  }
  if (SHORT_LINK_HOSTS.has(host)) {
    return "Short link, so we can't show you where it ends up.";
  }
  if (isBareAddress(host)) {
    return `Goes to ${host}.`;
  }
  const expected = HANDLE_HOST[link.kind];
  if (expected != null && host !== expected && !host.endsWith(`.${expected}`)) {
    return `Goes to ${host}.`;
  }
  return null;
}
