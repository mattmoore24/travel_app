import fs from 'node:fs';
import path from 'node:path';

import { Share } from 'react-native';

import { UNIVERSAL_LINKS_LIVE } from '@/constants/links';
import {
  LISTING_QR_CAPTION,
  LISTING_SHARE_LABEL,
  listingShareMessage,
  listingUrl,
  shareListing,
} from '@/features/business/share-listing';

/**
 * The one thing a hostel can point at.
 *
 * `Linking.createURL` reads the scheme out of the expo-constants manifest,
 * which does not exist under Jest ("expo-linking needs access to the
 * expo-constants manifest"), so it is stubbed with what the real function does
 * for a custom-scheme production build: drop the leading slash and hang the
 * path off `<scheme>://`. What is pinned here is the PATH and the words, which
 * is the half this module owns; the scheme itself is app.json's.
 */
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `samewhere://${path.replace(/^\//, '')}`,
}));

const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

beforeEach(() => {
  shareSpy.mockClear();
});

describe('the link to a listing', () => {
  it('points at the business page route the app already answers', () => {
    // src/app/place/[id].tsx, registered at the root outside every guard so a
    // scanned link lands on a real screen rather than a sign-up wall.
    expect(listingUrl('abc-123')).toContain('/place/abc-123');
  });

  it('escapes an id rather than pasting it into a path', () => {
    expect(listingUrl('a b/c')).toContain('/place/a%20b%2Fc');
  });

  it('is the custom scheme while universal links are off', () => {
    // Founder ruling, this batch: no apple-app-site-association for a listing
    // path we do not serve. If this flag ever flips, the four preconditions in
    // src/constants/links.ts have to hold for /place as well as /reset, and
    // this assertion is the one that will say so out loud.
    expect(UNIVERSAL_LINKS_LIVE).toBe(false);
    expect(listingUrl('abc-123').startsWith('https://')).toBe(false);
  });
});

describe('what the share sheet sends', () => {
  const message = () => listingShareMessage({ id: 'abc-123', name: 'Hostel Bica' });

  it('names the business and carries the link', () => {
    expect(message()).toContain('Hostel Bica');
    expect(message()).toContain(listingUrl('abc-123'));
  });

  it('says the link needs the app, because today it does', () => {
    // A custom scheme is not linkified by iMessage or WhatsApp and opens
    // nothing at all for a recipient without the app. Unexplained grey text is
    // how a share reads as broken; this line is the apology the https spelling
    // will not need.
    expect(message()).toContain('That link opens in the Samewhere app.');
  });

  it('is a statement about a business, not an invitation to a person', () => {
    // An owner is putting their own listing on a wall or in a booking
    // confirmation. "Join me", "come and meet" and the rest belong to the
    // group invite, which is a different act with a different message.
    expect(message()).not.toMatch(/\b(join me|meet me|come and|add me)\b/i);
  });

  it('uses none of the banned vocabulary', () => {
    // design-review: "place" for a business, the dating frame in any spelling,
    // an em dash, and any presence claim. All of it reaches a stranger's
    // phone verbatim, which makes this the least forgiving string in the
    // feature.
    //
    // The URL is held out of this, and only the URL. The route is
    // src/app/place/[id].tsx, so the link spells `/place/<id>` - a path
    // segment, not a sentence, in the same class as the invite's `/i/`. The
    // brief's rule is about the word a person reads as a noun for a business;
    // if that ever stops being true the answer is a `/b/<id>` route, not a
    // reworded message.
    const prose = message().replace(listingUrl('abc-123'), '');
    for (const banned of [
      /\bplaces?\b/i,
      /\bswipe/i,
      /\bdeck\b/i,
      /\bunmatch(ed)?\b/i,
      /\bmatch(es|ed|ing)?\b/i,
      /\brequests?\b/i,
      /\bnear (you|by)\b/i,
      /\bhere now\b/i,
      /—/,
    ]) {
      expect([banned.source, banned.test(prose)]).toEqual([banned.source, false]);
    }
  });

  it('spells the business name the owner typed, wherever it lands', () => {
    // No title casing, no truncation: a venue called "the pink door" is called
    // that on the wall behind its own bar.
    expect(listingShareMessage({ id: 'x', name: 'the pink door' })).toContain('the pink door');
  });
});

describe('handing it over', () => {
  it('sends exactly one string, so it lands intact wherever it is pasted', async () => {
    await shareListing({ id: 'abc-123', name: 'Hostel Bica' });
    expect(shareSpy).toHaveBeenCalledWith({
      message: listingShareMessage({ id: 'abc-123', name: 'Hostel Bica' }),
    });
  });

  it('treats a dismissed sheet as nothing at all', async () => {
    shareSpy.mockRejectedValueOnce(new Error('User did not share'));
    await expect(shareListing({ id: 'abc-123', name: 'Hostel Bica' })).resolves.toBeUndefined();
  });
});

describe('the words both surfaces use', () => {
  it('name the act rather than the surface, and say business', () => {
    // One name for one act: the listing page and the My business row are two
    // doors onto one link, and two labels for it is the bug the design brief
    // has already paid for twice.
    expect(LISTING_SHARE_LABEL).toBe('Share this business');
    // The caption follows the same flag the message's last line does: while
    // the square encodes a custom scheme it resolves to nothing on a phone
    // without the app, and an owner who taped this to a counter on the
    // promise that it "opens the page" would learn that from a guest.
    expect(LISTING_QR_CAPTION).toBe(
      'Point a camera at this to open the page in the Samewhere app.'
    );
    expect(LISTING_QR_CAPTION).toContain('Point a camera at this');
  });
});

const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');
const PAGE = 'src/app/place/[id].tsx';
const SHEET = 'src/features/business/place-sheet.tsx';

describe('where the share is offered', () => {
  it('stands on the owner listing and on a traveler reading of it', () => {
    const code = src(PAGE);
    // Twice: the isOwner block, where an owner is looking at the thing they
    // want to put on a wall, and the traveler block under Rate this business.
    expect((code.match(/label=\{LISTING_SHARE_LABEL\}/g) ?? []).length).toBe(2);
  });

  it('is not offered to a guest, whose next move is the account', () => {
    const code = src(PAGE);
    // SignUpGate already asks, and a second ask underneath it is two asks.
    const guest = code.slice(
      code.indexOf(') : isGuest ? ('),
      code.indexOf(') : isBusinessAccount')
    );
    expect(guest).toContain('<SignUpGate');
    expect(guest).not.toContain('LISTING_SHARE_LABEL');
  });
});

/**
 * The two events the listing now records.
 *
 * They live in this file only because the ownership split for this batch gave
 * it no other home: business-home.test.ts is the natural place for a business
 * analytics assertion and belongs to somebody else this round. Move them there
 * when that file is next opened.
 */
describe('what a listing records when somebody reads it', () => {
  it('does not count the owner reading their own page', () => {
    const code = src(PAGE);
    // The owner reaches this page through their own "See it as a traveler"
    // button and is the one account that opens it over and over, so their
    // visits would dominate any history drawn from this.
    expect(code).toContain('viewCounted.current || place == null || !ownerKnown || isOwner');
    // And it waits for the answer to "whose listing is this", because a
    // disabled query never leaves isPending and undefined is not "not mine".
    expect(code).toContain(
      "const ownerKnown = !ownBusiness.isPending || ownBusiness.fetchStatus === 'idle';"
    );
  });

  it('does not count the owner tapping their own marker either', () => {
    const code = src(SHEET);
    expect(code).toContain('if (ownBusiness != null && ownBusiness.id === place.id) {');
  });

  it('tags both surfaces, so neither breaks down against undefined', () => {
    // The lesson features/chat/analytics.ts was written to record: one event
    // sent {chat_id} and never kind, the other {kind} and never chat_id, and
    // every breakdown came out as a value versus undefined.
    expect(src(PAGE)).toContain(
      "analytics.capture('business_page_viewed', { business_id: place.id, source: 'page' });"
    );
    expect(src(SHEET)).toContain(
      "analytics.capture('business_page_viewed', { business_id: place.id, source: 'sheet' });"
    );
  });

  it('records which kind of link was tapped, never the link itself', () => {
    const code = src(PAGE);
    // A phone number and a booking URL are the business's own contact
    // details. "Somebody called this hostel" is the signal; the number is not.
    expect(code).toContain(
      "analytics.capture('business_link_tapped', { business_id: businessId, kind: link.kind });"
    );
    expect(code).not.toContain('value: link.value');
  });
});
