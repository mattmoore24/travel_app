import { countChatsSince, detailsDone, weekLine } from '@/features/business/vocabulary';

/**
 * The "How it's going" sentence and the "3 of 5 done" count.
 *
 * Both are deliberately small: the founder's ruling on this package was that
 * one sentence from numbers already on the screen is not the views/taps/saves
 * product §10 defers, and that it stops being this package the moment it
 * needs a table. These cases pin the sentence and the arithmetic so the next
 * edit cannot quietly grow either into a dashboard.
 */
describe('the How it is going line', () => {
  it('leads with what came back from the world', () => {
    expect(weekLine({ chatsThisWeek: 2, memberCount: 0 })).toBe(
      '2 travelers started a conversation this week.'
    );
  });

  it('says both numbers when there are both', () => {
    expect(weekLine({ chatsThisWeek: 2, memberCount: 11 })).toBe(
      '2 travelers started a conversation this week. 11 travelers are in your chat.'
    );
  });

  it('gets the grammar right at one', () => {
    expect(weekLine({ chatsThisWeek: 1, memberCount: 1 })).toBe(
      '1 traveler started a conversation this week. 1 traveler is in your chat.'
    );
  });

  it('does not pretend a quiet week was a busy one', () => {
    expect(weekLine({ chatsThisWeek: 0, memberCount: 4 })).toBe(
      '4 travelers are in your chat. No new conversations this week.'
    );
  });

  it('gives a brand new listing something to do rather than a zero', () => {
    const line = weekLine({ chatsThisWeek: 0, memberCount: 0 });
    expect(line).toBe(
      'No new conversations this week. A listing with photos and hours gets read more.'
    );
    // Not "0 travelers started a conversation", which is the same fact said as a
    // failure, on the one screen an owner opens to find out whether this was
    // worth signing up for.
    expect(line).not.toContain('0');
  });

  it('never names anybody, at any count', () => {
    const lines = [
      weekLine({ chatsThisWeek: 0, memberCount: 0 }),
      weekLine({ chatsThisWeek: 1, memberCount: 0 }),
      weekLine({ chatsThisWeek: 3, memberCount: 9 }),
    ];
    // The anti-retaliation control: which travelers wrote and which rated is
    // never shown to an owner. It counts conversations, so there is nothing
    // in the sentence that could be a person.
    for (const line of lines) {
      expect(line).not.toMatch(/@|http|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it('uses no banned vocabulary', () => {
    const all = [
      weekLine({ chatsThisWeek: 0, memberCount: 0 }),
      weekLine({ chatsThisWeek: 2, memberCount: 2 }),
      weekLine({ chatsThisWeek: 0, memberCount: 2 }),
    ].join(' ');
    for (const banned of ['swipe', 'deck', 'match', 'place', 'near you', 'here now', '—']) {
      expect(all.toLowerCase()).not.toContain(banned);
    }
  });
});

describe('the five things a listing is judged on', () => {
  const none = {
    hasAddress: false,
    photos: 0,
    hasHours: false,
    hasDescription: false,
    links: 0,
  };

  it('counts nothing as nothing', () => {
    expect(detailsDone(none)).toBe(0);
  });

  it('counts each one once, however many rows are behind it', () => {
    expect(detailsDone({ ...none, photos: 9 })).toBe(1);
    expect(detailsDone({ ...none, links: 4 })).toBe(1);
  });

  it('tops out at five', () => {
    expect(
      detailsDone({
        hasAddress: true,
        photos: 3,
        hasHours: true,
        hasDescription: true,
        links: 2,
      })
    ).toBe(5);
  });
});

describe('counting the week', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const at = (iso: string, kind = 'business') => ({ kind, created_at: iso });

  it('is zero before the list has loaded', () => {
    expect(countChatsSince(null, now)).toBe(0);
  });

  it('counts a conversation opened inside the window', () => {
    expect(countChatsSince([at('2026-08-30T09:00:00Z')], now)).toBe(1);
  });

  it('drops one older than seven days', () => {
    expect(countChatsSince([at('2026-08-20T09:00:00Z')], now)).toBe(0);
  });

  it('counts the boundary itself as inside', () => {
    expect(countChatsSince([at('2026-08-25T12:00:00Z')], now)).toBe(1);
  });

  it('ignores every kind that is not a traveler writing in', () => {
    // The owner's own room and any direct chat are not somebody writing to
    // the business, and counting them would inflate the one number on this
    // screen that is supposed to be believable.
    const rows = [at('2026-08-31T09:00:00Z', 'room'), at('2026-08-31T09:00:00Z', 'direct')];
    expect(countChatsSince(rows, now)).toBe(0);
  });

  it('does not read the real clock', () => {
    // A fixed list and a fixed now give a fixed answer, which is the whole
    // reason the clock is a parameter.
    const rows = [at('2026-08-28T09:00:00Z'), at('2026-08-31T09:00:00Z')];
    expect(countChatsSince(rows, now)).toBe(2);
    expect(countChatsSince(rows, new Date('2026-09-10T12:00:00Z'))).toBe(0);
  });
});

describe('the sentence claims only what the number counts', () => {
  it('says conversations started, because created_at is what is counted', () => {
    // countChatsSince filters on the chat row's created_at, so a traveler
    // who wrote again in a thread opened last month is not in this figure.
    // "wrote to you this week" was a claim the number does not support, on
    // the one line of this screen that is supposed to be believable.
    const all = [
      weekLine({ chatsThisWeek: 1, memberCount: 0 }),
      weekLine({ chatsThisWeek: 0, memberCount: 3 }),
      weekLine({ chatsThisWeek: 0, memberCount: 0 }),
    ].join(' ');
    expect(all).not.toContain('wrote to you');
    expect(all).not.toContain('has written');
  });
});
