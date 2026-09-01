import {
  hostOf,
  hrefFor,
  isShortLink,
  linkCaution,
  opensInAppBrowser,
} from '@/features/business/links';
import type { BusinessLinkJson, BusinessLinkKind } from '@/lib/database.types';

const link = (kind: BusinessLinkKind, value: string): BusinessLinkJson =>
  ({ kind, value, label: '' }) as BusinessLinkJson;

describe('hrefFor', () => {
  it('dials a phone number without its spaces', () => {
    expect(hrefFor(link('phone', '+34 600 123 456'))).toBe('tel:+34600123456');
  });

  it('opens mail for an email address', () => {
    expect(hrefFor(link('email', 'hello@bar.com'))).toBe('mailto:hello@bar.com');
  });

  // The database stores WhatsApp as a phone number and REJECTS a wa.me URL
  // (20260827110000_business_content.sql), so this is the shape every one of
  // them arrives in. It used to become `https://+34 600 123 456`.
  it('turns a WhatsApp number into a wa.me link', () => {
    expect(hrefFor(link('whatsapp', '+34 600 123 456'))).toBe('https://wa.me/34600123456');
    expect(hrefFor(link('whatsapp', '(020) 7123-4567'))).toBe('https://wa.me/02071234567');
  });

  // "@yourplace, or the full link" is what the editor asks for.
  it('sends a bare handle to the right site', () => {
    expect(hrefFor(link('instagram', '@yourplace'))).toBe('https://instagram.com/yourplace');
    expect(hrefFor(link('tiktok', '@yourplace'))).toBe('https://tiktok.com/@yourplace');
    expect(hrefFor(link('facebook', 'yourplace'))).toBe('https://facebook.com/yourplace');
    expect(hrefFor(link('x', '@yourplace'))).toBe('https://x.com/yourplace');
  });

  it('leaves a full link alone, whatever the kind', () => {
    expect(hrefFor(link('instagram', 'https://instagram.com/yourplace'))).toBe(
      'https://instagram.com/yourplace'
    );
    expect(hrefFor(link('website', 'https://bar.com'))).toBe('https://bar.com');
  });

  it('gives a scheme-less address one, which is the case that started this', () => {
    expect(hrefFor(link('website', 'example.com'))).toBe('https://example.com');
    expect(hrefFor(link('menu', ' example.com/menu '))).toBe('https://example.com/menu');
  });
});

/**
 * Which opener a link kind gets. This is the whole of the in-app browser
 * decision, isolated out of the screen so it can be asserted without
 * mounting one: a website and a menu come up inside the app with a Done
 * button; everything else belongs to another app and is left alone.
 */
describe('opensInAppBrowser', () => {
  it('keeps reading inside the app', () => {
    expect(opensInAppBrowser('website')).toBe(true);
    expect(opensInAppBrowser('menu')).toBe(true);
  });

  it('leaves the kinds that are not web pages to the system', () => {
    for (const kind of ['phone', 'email', 'whatsapp'] as BusinessLinkKind[]) {
      expect(opensInAppBrowser(kind)).toBe(false);
    }
  });

  // The expensive mistake this prevents: an in-app browser intercepting a
  // universal link the native app claims, and showing a signed-out web view
  // to somebody who is logged in two icons away.
  it('leaves every social handle to the app that claims it', () => {
    for (const kind of ['instagram', 'tiktok', 'facebook', 'x'] as BusinessLinkKind[]) {
      expect(opensInAppBrowser(kind)).toBe(false);
    }
  });

  it('leaves anything that ends in a card number to the real browser', () => {
    expect(opensInAppBrowser('reservations')).toBe(false);
    expect(opensInAppBrowser('tickets')).toBe(false);
    expect(opensInAppBrowser('other')).toBe(false);
  });
});

/**
 * Where a tap really lands, as opposed to what the row says.
 *
 * A business listing is the one place in this app where content somebody
 * typed sends a traveler to an arbitrary address, and the tap happens on a
 * screen wearing Samewhere's chrome. The database screens a link's LABEL
 * through the same classifier a message goes through and has nothing to say
 * about its VALUE, so these are the checks the reader's side can still make.
 */
describe('hostOf', () => {
  it('answers the same for a handle and for the full link', () => {
    expect(hostOf(link('instagram', '@yourplace'))).toBe('instagram.com');
    expect(hostOf(link('instagram', 'https://www.instagram.com/yourplace'))).toBe(
      'www.instagram.com'
    );
  });

  it('drops the port and the case', () => {
    expect(hostOf(link('website', 'https://Bar.COM:8443/menu'))).toBe('bar.com');
  });

  // The oldest way to make a link look like somewhere it is not: everything
  // before the last @ is credentials, and the host is what follows it.
  it('reads the host after the credentials, not before them', () => {
    expect(hostOf(link('website', 'https://casaazul.com@evil.test/menu'))).toBe('evil.test');
  });

  it('has no host for the kinds that are not web addresses', () => {
    expect(hostOf(link('phone', '+34 600 123 456'))).toBeNull();
    expect(hostOf(link('email', 'hello@bar.com'))).toBeNull();
  });

  it('sends WhatsApp through wa.me, which is where hrefFor puts it', () => {
    expect(hostOf(link('whatsapp', '+34 600 123 456'))).toBe('wa.me');
  });
});

describe('isShortLink', () => {
  it('knows the hosts whose whole job is hiding a destination', () => {
    expect(isShortLink(link('website', 'https://bit.ly/x3f9'))).toBe(true);
    expect(isShortLink(link('reservations', 'https://tinyurl.com/abc'))).toBe(true);
    expect(isShortLink(link('tickets', 'https://ow.ly/abc'))).toBe(true);
  });

  // The four social kinds were the gap: the value check only ever ran on the
  // else branch, so a shortener filed as an Instagram link met no check at all.
  it('sees one filed as a social link too', () => {
    expect(isShortLink(link('instagram', 'https://t.co/abc'))).toBe(true);
  });

  it('leaves a real address alone', () => {
    expect(isShortLink(link('menu', 'https://casaazul.example/menu'))).toBe(false);
    expect(isShortLink(link('phone', '+34 600 123 456'))).toBe(false);
  });
});

describe('linkCaution', () => {
  it('says a short link is hiding where it goes', () => {
    expect(linkCaution(link('website', 'https://bit.ly/x3f9'))).toBe(
      "Short link, so we can't show you where it ends up."
    );
  });

  it('names a bare address, whatever kind it is filed under', () => {
    expect(linkCaution(link('website', 'https://1.2.3.4/x'))).toBe('Goes to 1.2.3.4.');
    expect(linkCaution(link('instagram', 'https://1.2.3.4/x'))).toBe('Goes to 1.2.3.4.');
  });

  it('says so when a social link leaves the platform it is filed under', () => {
    expect(linkCaution(link('instagram', 'https://example.test/yourplace'))).toBe(
      'Goes to example.test.'
    );
  });

  it('is quiet about the links that are what they say they are', () => {
    expect(linkCaution(link('instagram', '@yourplace'))).toBeNull();
    expect(linkCaution(link('instagram', 'https://www.instagram.com/yourplace'))).toBeNull();
    expect(linkCaution(link('facebook', 'https://m.facebook.com/yourplace'))).toBeNull();
    expect(linkCaution(link('menu', 'casaazul.example/menu'))).toBeNull();
    expect(linkCaution(link('phone', '+34 600 123 456'))).toBeNull();
    expect(linkCaution(link('whatsapp', '+34 600 123 456'))).toBeNull();
  });

  // The shortener sentence wins over the destination one: this link is both
  // a shortener and a TikTok link that does not go to TikTok, and naming
  // bit.ly as the destination would read as if that were the end of it.
  it('prefers the short-link sentence when both could apply', () => {
    expect(linkCaution(link('tiktok', 'https://bit.ly/x3f9'))).toBe(
      "Short link, so we can't show you where it ends up."
    );
  });
});
