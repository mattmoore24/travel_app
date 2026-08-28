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
