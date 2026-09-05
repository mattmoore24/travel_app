import * as Linking from 'expo-linking';
import { Share } from 'react-native';

import { UNIVERSAL_LINKS_LIVE, WEB_ORIGIN } from '@/constants/links';

/**
 * A business listing, as something an owner can hand to somebody.
 *
 * The map was the only route to a business page, so a hostel that wanted "we're
 * on Samewhere" on the wall behind reception, in a booking confirmation or on
 * Instagram had nothing to point at. §2.6's whole go-to-market is hostel
 * partnerships and creator marketing, and both of those are links.
 *
 * WHY THIS IS A CUSTOM-SCHEME LINK AND NOT AN HTTPS ONE
 * ----------------------------------------------------
 * Founder ruling, this batch: no universal links yet. `UNIVERSAL_LINKS_LIVE`
 * stays false. An apple-app-site-association file on a domain we do not serve a
 * listing page from is a broken link rather than a half-working one, and
 * flipping it costs an EAS build. So today the link is `samewhere://place/<id>`
 * and the QR at the counter is the case it is good at: somebody is standing in
 * front of the square with a phone, and the phone either has the app or is one
 * install away.
 *
 * The https spelling is written down here anyway, behind the same flag the
 * password-reset redirect uses, so turning it on later is a flag flip plus one
 * build rather than an archaeology exercise. Before that flag can be true, the
 * four preconditions in src/constants/links.ts have to hold for THIS path as
 * well: a `/place/*` (or `/b/*`) component in web/.well-known/
 * apple-app-site-association, a hosted page answering it, a route in the app
 * that already exists (src/app/place/[id].tsx, registered outside every guard),
 * and a builder on `WebLinks` rather than the local one below.
 *
 * The group invite is the other half of this story: features/share/share-link
 * owns the QR and the share sheet, and this module owns the words and the URL a
 * business puts through them.
 */

/** The path a listing answers on, in the app and (later) on the web. */
const LISTING_PATH = (id: string) => `/place/${encodeURIComponent(id)}`;

/**
 * The link to one business's page.
 *
 * `Linking.createURL` reads the scheme out of the app config rather than
 * hardcoding it, which is why this file never spells `samewhere://` out: the
 * scheme is app.json's to change.
 */
export function listingUrl(id: string): string {
  return UNIVERSAL_LINKS_LIVE
    ? `${WEB_ORIGIN}${LISTING_PATH(id)}`
    : Linking.createURL(LISTING_PATH(id));
}

/**
 * What the share sheet sends: one string, so it lands intact in a text message,
 * an email or the clipboard.
 *
 * It is a statement about a business, never an invitation to a person - an
 * owner is putting their own listing somewhere public, not asking anybody to
 * meet them. The word is "business" in every string anybody reads (design
 * brief, founder 2026-08-28), and there is no presence claim in it: a listing
 * is a permanent marker on a map, and nothing here says who is at it.
 *
 * The last line is the honest half. While the link is a custom scheme it opens
 * nothing at all for a recipient without the app, and grey unlinkified text
 * with no explanation is how a share reads as broken. An https link needs no
 * such apology, so the line goes when the flag flips.
 */
export function listingShareMessage({ id, name }: { id: string; name: string }): string {
  const url = listingUrl(id);
  // The same clause the group invite uses to introduce the app to somebody who
  // has never heard of it, word for word: two different sentences describing
  // one product to the same stranger is how a product ends up with two names.
  const intro = `${name} is on Samewhere, a free app for meeting other travelers.`;
  return UNIVERSAL_LINKS_LIVE
    ? `${intro}\n\n${url}`
    : `${intro}\n\n${url}\n\nThat link opens in the Samewhere app.`;
}

/**
 * Hand the listing over through the system share sheet.
 *
 * The sheet IS the text/email/copy chooser, so there is no second menu to
 * build, and dismissing it is not an error - the same shape features/share/
 * share-link uses, kept identical so the two cannot drift.
 */
export async function shareListing({ id, name }: { id: string; name: string }): Promise<void> {
  try {
    await Share.share({ message: listingShareMessage({ id, name }) });
  } catch {
    // Dismissing the share sheet is not an error.
  }
}

/**
 * The words both surfaces use for the same act, in one place.
 *
 * The listing page and the My business tab are two doors onto one link, and a
 * button named differently on each is the "one name for one act" bug the design
 * brief has already paid for twice.
 */
export const LISTING_SHARE_LABEL = 'Share this business';

/**
 * Under the square on My business: somebody is holding a phone up to a
 * counter.
 *
 * It says "in the app" for the same reason the shared message's last line
 * does. While UNIVERSAL_LINKS_LIVE is false the square encodes a custom
 * scheme, which resolves to nothing at all on a phone that has never
 * installed Samewhere - and an owner who taped this to a counter on the
 * promise that it "opens the page" would be finding that out from a guest.
 * The sentence goes back to the shorter one when the flag flips, alongside
 * the message's own apology line.
 */
export const LISTING_QR_CAPTION = UNIVERSAL_LINKS_LIVE
  ? 'Point a camera at this to open the page.'
  : 'Point a camera at this to open the page in the Samewhere app.';
