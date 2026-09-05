import { listingNotice } from '@/features/business/listing-notice';
import type { BusinessState } from '@/lib/database.types';

/**
 * The card the map shows an owner whose own chip is missing. The code has
 * always known why the listing is absent — my_business() carries the state —
 * and said nothing; these pin the sentence per state, and that the only
 * pressable one is the state the owner can fix (the email code).
 */
describe('listingNotice', () => {
  const states: BusinessState[] = ['unconfirmed', 'listed', 'flagged', 'removed'];

  it('every state produces its own sentence', () => {
    const lines = states.map((state) => listingNotice(state).line);
    expect(new Set(lines).size).toBe(states.length);
    for (const state of states) {
      const notice = listingNotice(state);
      expect(notice.line.length).toBeGreaterThan(0);
      expect(notice.detail.length).toBeGreaterThan(0);
    }
  });

  it("only 'unconfirmed' is pressable", () => {
    for (const state of states) {
      expect(listingNotice(state).pressable).toBe(state === 'unconfirmed');
    }
  });

  it('unconfirmed says what to do, in the words of the fix', () => {
    const notice = listingNotice('unconfirmed');
    expect(notice.line).toBe('Your business is not on the map yet.');
    expect(notice.detail).toBe('Confirm your email to put it here.');
  });

  it('flagged says the listing is being checked, without a moderation leak', () => {
    const notice = listingNotice('flagged');
    expect(notice.line).toBe('We are checking your listing.');
    expect(notice.detail).toBe('It goes on the map once that is done.');
  });

  it('removed says so plainly and names the door to a human', () => {
    const notice = listingNotice('removed');
    expect(notice.line).toBe('Your listing is off the map.');
    expect(notice.detail).toBe('Contact us from My business if that seems wrong.');
  });

  it('never an em dash, never a banned word', () => {
    for (const state of states) {
      const notice = listingNotice(state);
      const copy = `${notice.line} ${notice.detail}`;
      expect(copy).not.toContain('—');
      expect(copy).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });
});
