import { hrefFor } from '@/features/business/links';
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
