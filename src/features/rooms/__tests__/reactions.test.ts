import { applyToggle } from '@/features/rooms/reactions';
import type { ReactionSummaryRow } from '@/lib/database.types';

// The pure updater is the logic worth testing: it mirrors the server's
// one-reaction-per-person rule onto the cached summary rows so a tapback can
// appear before the network answers. The mutation plumbing around it is
// React Query's, not ours - no Supabase mock proves anything here.

const row = (over: Partial<ReactionSummaryRow> = {}): ReactionSummaryRow => ({
  message_id: 'm1',
  emoji: '❤️',
  count: 1,
  reacted_by_me: false,
  ...over,
});

const input = (over: Partial<Parameters<typeof applyToggle>[1]> = {}) => ({
  messageId: 'm1',
  emoji: '❤️',
  on: true,
  userId: 'me',
  ...over,
});

describe('applyToggle', () => {
  it('toggling on adds a row with count 1, marked as yours', () => {
    expect(applyToggle([], input())).toEqual([
      { message_id: 'm1', emoji: '❤️', count: 1, reacted_by_me: true },
    ]);
  });

  it('toggling on joins an existing row rather than duplicating it', () => {
    expect(applyToggle([row({ count: 2 })], input())).toEqual([
      row({ count: 3, reacted_by_me: true }),
    ]);
  });

  it('a second emoji on the same message moves yours rather than stacking', () => {
    const next = applyToggle(
      [row({ emoji: '❤️', count: 1, reacted_by_me: true })],
      input({ emoji: '👍' })
    );
    expect(next).toEqual([{ message_id: 'm1', emoji: '👍', count: 1, reacted_by_me: true }]);
  });

  it('moving yours leaves other people on the old emoji', () => {
    const next = applyToggle(
      [row({ emoji: '❤️', count: 2, reacted_by_me: true })],
      input({ emoji: '👍' })
    );
    expect(next).toEqual([
      row({ emoji: '❤️', count: 1, reacted_by_me: false }),
      { message_id: 'm1', emoji: '👍', count: 1, reacted_by_me: true },
    ]);
  });

  it('toggling off drops the row at zero', () => {
    expect(applyToggle([row({ reacted_by_me: true })], input({ on: false }))).toEqual([]);
  });

  it('toggling off leaves other people counted', () => {
    expect(applyToggle([row({ count: 3, reacted_by_me: true })], input({ on: false }))).toEqual([
      row({ count: 2, reacted_by_me: false }),
    ]);
  });

  it('toggling off an emoji that is not yours changes nothing', () => {
    const rows = [row({ count: 2, reacted_by_me: false })];
    expect(applyToggle(rows, input({ on: false }))).toEqual(rows);
  });

  it('only touches the message that was pressed', () => {
    const elsewhere = row({ message_id: 'm2', emoji: '❤️', reacted_by_me: true });
    const next = applyToggle([elsewhere], input({ emoji: '👍' }));
    expect(next).toEqual([
      elsewhere,
      { message_id: 'm1', emoji: '👍', count: 1, reacted_by_me: true },
    ]);
  });
});
