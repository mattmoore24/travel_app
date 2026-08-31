import { helloExpired, saidHiAlready } from '@/features/matching/already-sent';
import type { SentRequestRow } from '@/lib/database.types';

const row = (
  recipient: string,
  state: SentRequestRow['state'],
  expiredAt: string | null = null
): SentRequestRow => ({
  id: `r-${recipient}-${state}`,
  recipient_id: recipient,
  source: 'trip_match',
  profile_element: 'trip',
  first_message: 'Both in Lisbon next week, up for a market run?',
  state,
  chat_id: null,
  created_at: '2026-08-01T10:00:00Z',
  expired_at: expiredAt,
});

/**
 * One shot per direction, ever. Every surface that offers a Say hi has to
 * agree about when there is nothing left to offer, or the tap ends in the
 * unique-constraint refusal that destroys the draft.
 */
describe('whether a hello is already out', () => {
  it('counts a live one', () => {
    expect(saidHiAlready([row('u1', 'sent')], 'u1')).toBe(true);
  });

  it('counts an expired one, because the constraint outlives the row', () => {
    // The sweep clears the recipient's inbox; it does not free the pair. And
    // it never shows up as a new state: sent_requests() keeps saying 'sent'
    // and stamps expired_at, so a bundle that has not learned the word
    // still refuses to offer a second hello.
    expect(saidHiAlready([row('u1', 'sent', '2026-08-20T03:40:00Z')], 'u1')).toBe(true);
  });

  it('does not count a moderation stop, which the sender is invited to rewrite', () => {
    expect(saidHiAlready([row('u1', 'blocked')], 'u1')).toBe(false);
  });

  it('does not count an accepted one: that surface has a chat to open', () => {
    expect(saidHiAlready([row('u1', 'accepted')], 'u1')).toBe(false);
  });

  it('answers about the traveler asked for, and about nobody with no id', () => {
    expect(saidHiAlready([row('u1', 'sent')], 'u2')).toBe(false);
    expect(saidHiAlready([row('u1', 'sent')], null)).toBe(false);
    expect(saidHiAlready([row('u1', 'sent')], undefined)).toBe(false);
  });
});

/**
 * The sibling question, asked by the copy that sits beside the disabled
 * control. respond_to_message_request only accepts a 'pending' row, so once
 * the sweep has stamped it there is nobody left who can answer — and
 * "it'll be in Chat if they answer" stops being true.
 */
describe('whether that hello has run out', () => {
  it('is false while it can still be answered', () => {
    expect(helloExpired([row('u1', 'sent')], 'u1')).toBe(false);
  });

  it('is true once the sweep has stamped it', () => {
    expect(helloExpired([row('u1', 'sent', '2026-08-20T03:40:00Z')], 'u1')).toBe(true);
  });

  it('reads the stamp, never the state, so an old bundle can stay right', () => {
    // The whole point of the additive column: `state` never learns a sixth
    // word, so nothing here may branch on one.
    const stamped = row('u1', 'sent', '2026-08-20T03:40:00Z');
    expect(stamped.state).toBe('sent');
    expect(helloExpired([stamped], 'u1')).toBe(true);
  });

  it('answers about the traveler asked for, and about nobody with no id', () => {
    const stamped = row('u1', 'sent', '2026-08-20T03:40:00Z');
    expect(helloExpired([stamped], 'u2')).toBe(false);
    expect(helloExpired([stamped], null)).toBe(false);
    expect(helloExpired([stamped], undefined)).toBe(false);
  });
});
