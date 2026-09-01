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
