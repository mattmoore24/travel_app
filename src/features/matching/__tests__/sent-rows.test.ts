import { waitingRows } from '../sent-rows';
import type { SentRequestRow } from '@/lib/database.types';

const row = (over: Partial<SentRequestRow>): SentRequestRow => ({
  id: 'r1',
  recipient_id: 'u1',
  source: 'trip_match',
  profile_element: 'bio',
  first_message: 'Any good night markets?',
  state: 'sent',
  chat_id: null,
  created_at: '2026-09-01T10:00:00Z',
  expired_at: null,
  withdrawn_at: null,
  blocked_after_send: false,
  ...over,
});

describe('waitingRows', () => {
  it('keeps a hello that is still out', () => {
    expect(waitingRows([row({})]).map((r) => r.id)).toEqual(['r1']);
  });

  it('drops one that became a conversation', () => {
    expect(waitingRows([row({ state: 'accepted', chat_id: 'c1' })])).toEqual([]);
  });

  it('drops a prefilter block, which was refused in front of the writer', () => {
    expect(waitingRows([row({ state: 'blocked', blocked_after_send: false })])).toEqual([]);
  });

  it('keeps one the classifier stopped after the app said it was sent', () => {
    const rows = waitingRows([row({ id: 'r2', state: 'blocked', blocked_after_send: true })]);
    expect(rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('keeps an expired hello, which still reads as sent', () => {
    const rows = waitingRows([row({ id: 'r3', expired_at: '2026-09-02T00:00:00Z' })]);
    expect(rows.map((r) => r.id)).toEqual(['r3']);
  });
});

describe('a hello the sender took back', () => {
  it('leaves the list, which is the whole visible half of the feature', () => {
    // The server stamps withdrawn_at and never touches `state` — a fourth
    // state would break the launch that runs the previous bundle against the
    // new schema. So every reader has to remember the column, and this is
    // the reader that decides whether the row is still on screen. Without
    // it the refetch returns a byte-identical list and "You said hi to Ana"
    // stays up for ever.
    expect(waitingRows([row({ withdrawn_at: '2026-09-01T11:00:00Z' })])).toEqual([]);
  });

  it('even when it is the blocked-after-send kind that is kept on purpose', () => {
    // That row survives so the sender can find what they wrote and rewrite
    // it. Taking it back is the sender saying they no longer want to.
    expect(
      waitingRows([
        row({ state: 'blocked', blocked_after_send: true, withdrawn_at: '2026-09-01T11:00:00Z' }),
      ])
    ).toEqual([]);
  });

  it('and one that was not withdrawn is untouched', () => {
    expect(
      waitingRows([row({}), row({ id: 'r2', withdrawn_at: '2026-09-01T11:00:00Z' })]).map(
        (r) => r.id
      )
    ).toEqual(['r1']);
  });
});
