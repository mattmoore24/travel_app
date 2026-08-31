import { hrefFor, opensInAppBrowser } from '@/features/business/links';
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
