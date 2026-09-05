import { overlapSentence } from '@/features/matching/overlap';

/**
 * One sentence, two surfaces. Travelers builds it from a match row's city
 * name; the card the hello is answered on builds it from the three columns
 * incoming_requests() now returns. They have to come out identical, because
 * the whole point of putting the city and the dates on the incoming card is
 * that the recipient is reading the same fact the sender acted on.
 */
describe('the overlap sentence', () => {
  it('says the city and the dates', () => {
    expect(overlapSentence('Lisbon', '2026-09-03', '2026-09-08')).toBe('Both in Lisbon Sep 3 – 8');
  });

  it('keeps only the city when the label carries a country', () => {
    // ProfileView hands it "Bangkok, Thailand" (the trip label); the RPCs
    // hand it "Bangkok". Both have to produce the phone-width sentence.
    expect(overlapSentence('Bangkok, Thailand', '2026-08-23', '2026-08-28')).toBe(
      overlapSentence('Bangkok', '2026-08-23', '2026-08-28')
    );
  });

  it('is the same sentence on the traveler card and the incoming hello card', () => {
    // The traveler side quotes it from the match row; the recipient side
    // reads it off the request row. Same pair, same window, same words.
    const fromTravelers = overlapSentence('Lisbon', '2026-09-03', '2026-09-08');
    const fromIncomingHello = overlapSentence('Lisbon', '2026-09-03', '2026-09-08');
    expect(fromIncomingHello).toBe(fromTravelers);
    expect(fromIncomingHello).toBe('Both in Lisbon Sep 3 – 8');
  });

  it('says nothing at all when the overlap is missing', () => {
    // A pin-sourced hello: incoming_requests() returns three nulls because
    // the recipient's own policy cannot read the sender's trips. The card
    // must draw no chip rather than guess at one.
    expect(overlapSentence(null, null, null)).toBeNull();
    expect(overlapSentence('Lisbon', null, '2026-09-08')).toBeNull();
    expect(overlapSentence('Lisbon', '2026-09-03', null)).toBeNull();
    expect(overlapSentence(undefined, '2026-09-03', '2026-09-08')).toBeNull();
    expect(overlapSentence('  ', '2026-09-03', '2026-09-08')).toBeNull();
  });

  it('names both cities when the queue reached past one, and neither city twice', () => {
    // Under a radius (profiles.travelers_radius_km) the sender's trip is in
    // Cannes and the reader's in Nice; "Both in Cannes" would be a lie about
    // the reader. The same city on both sides is the old sentence, and no
    // second city at all (a caller that predates the column) is too.
    expect(overlapSentence('Cannes', '2026-09-03', '2026-09-08', 'Nice')).toBe(
      "In Cannes while you're in Nice, Sep 3 – 8"
    );
    expect(overlapSentence('Nice', '2026-09-03', '2026-09-08', 'Nice')).toBe(
      'Both in Nice Sep 3 – 8'
    );
    expect(overlapSentence('Nice, France', '2026-09-03', '2026-09-08', 'Nice')).toBe(
      'Both in Nice Sep 3 – 8'
    );
    expect(overlapSentence('Nice', '2026-09-03', '2026-09-08', null)).toBe(
      'Both in Nice Sep 3 – 8'
    );
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    const line = overlapSentence('Lisbon', '2026-09-03', '2026-09-08') ?? '';
    expect(line).not.toContain('—');
    expect(line).not.toMatch(/\b(swipe|deck|match|request)\b/i);
  });
});
