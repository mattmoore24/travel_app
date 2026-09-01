import { pinOnMessage } from '@/features/rooms/message-pin';

/**
 * Whether there is still a plan on this message.
 *
 * The case worth the file is the second one: at expiry `room_messages` nulls
 * every pin column and leaves the message row alone, so a reader that drew the
 * card from the id would put a venue-less card with a live-looking Join on it
 * over a plan that is gone. §7 rule 3 says an expired pin is unreadable and a
 * chat must not become the way around that.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  pin_id: 'pin-1',
  pin_venue_name: 'Park Bar',
  pin_plan: 'Sunset drinks',
  pin_category: 'bar',
  pin_intent_date: '2026-09-04',
  ...over,
});

describe('pinOnMessage', () => {
  it('reads the plan off the row the RPC returned', () => {
    expect(pinOnMessage(row())).toEqual({
      messageId: 'm1',
      pinId: 'pin-1',
      venueName: 'Park Bar',
      plan: 'Sunset drinks',
      category: 'bar',
      intentDate: '2026-09-04',
    });
  });

  it('finds nothing once the server has emptied the columns', () => {
    expect(
      pinOnMessage(
        row({ pin_id: null, pin_venue_name: null, pin_plan: null, pin_intent_date: null })
      )
    ).toBeNull();
  });

  // Half-built is the same answer as gone. A card that says "a plan" and names
  // neither the place nor the day is worse than no card, and the two halves
  // are nulled together by construction — so anything else is a bug upstream
  // and must not be rendered.
  it('finds nothing when the venue is missing', () => {
    expect(pinOnMessage(row({ pin_venue_name: null }))).toBeNull();
  });

  it('finds nothing when the day is missing', () => {
    expect(pinOnMessage(row({ pin_intent_date: null }))).toBeNull();
  });

  // A direct chat reads the `messages` table, which has pin_id and none of the
  // joined columns on it.
  it('finds nothing on a row that carries no joined columns', () => {
    expect(pinOnMessage({ id: 'm1', pin_id: 'pin-1' })).toBeNull();
  });

  it('keeps a plan with no words on it', () => {
    expect(pinOnMessage(row({ pin_plan: null }))?.plan).toBeNull();
  });

  it('falls back to the catch-all category rather than dropping the card', () => {
    expect(pinOnMessage(row({ pin_category: null }))?.category).toBe('other');
  });
});
