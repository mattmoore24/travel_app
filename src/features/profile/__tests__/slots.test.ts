import { nextFreeSlot, tightenSlots } from '@/features/profile/slots';

describe('nextFreeSlot', () => {
  it('fills from the bottom', () => {
    expect(nextFreeSlot([], 6)).toBe(0);
    expect(nextFreeSlot([0], 6)).toBe(1);
    expect(nextFreeSlot([0, 1, 2], 6)).toBe(3);
  });

  it('fills a hole before extending', () => {
    expect(nextFreeSlot([0, 2], 6)).toBe(1);
    expect(nextFreeSlot([1, 2, 3], 6)).toBe(0);
  });

  it('is null when the list is full, at either cap', () => {
    expect(nextFreeSlot([0, 1, 2], 3)).toBeNull();
    expect(nextFreeSlot([0, 1, 2, 3, 4, 5], 6)).toBeNull();
    // The prompts cap and the priorities cap share this function, so a list
    // that is full at three must still have room at six.
    expect(nextFreeSlot([0, 1, 2], 6)).toBe(3);
  });
});

describe('tightenSlots', () => {
  const rows = (...slots: number[]) => slots.map((slot) => ({ slot, text: `t${slot}` }));

  it('does nothing to a list that is already tight', () => {
    const { writes, deletes } = tightenSlots(rows(0, 1, 2), [0, 1, 2]);
    expect(writes).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('pulls the tail up when a middle entry goes', () => {
    const { writes, deletes } = tightenSlots(rows(0, 2), [0, 1, 2]);
    expect(writes).toEqual([{ slot: 1, row: { slot: 2, text: 't2' } }]);
    expect(deletes).toEqual([2]);
  });

  it('needs no write when the last entry goes, only the delete', () => {
    const { writes, deletes } = tightenSlots(rows(0, 1), [0, 1, 2]);
    expect(writes).toEqual([]);
    expect(deletes).toEqual([2]);
  });

  it('empties cleanly', () => {
    const { writes, deletes } = tightenSlots([], [0]);
    expect(writes).toEqual([]);
    expect(deletes).toEqual([0]);
  });

  it('orders writes ascending, so each lands on an already-vacated slot', () => {
    const { writes } = tightenSlots(rows(1, 2, 3), [0, 1, 2, 3]);
    expect(writes.map((w) => w.slot)).toEqual([0, 1, 2]);
  });

  // The bug this function exists to prevent. A list holding 0, 3 and 4 that
  // loses slot 0 leaves BOTH 3 and 4 behind after the writes; deleting only
  // the highest would orphan slot 3 and the profile would show four chips
  // where three were meant.
  it('deletes every stale slot, not just the highest', () => {
    const { writes, deletes } = tightenSlots(rows(3, 4), [0, 3, 4]);
    expect(writes).toEqual([
      { slot: 0, row: { slot: 3, text: 't3' } },
      { slot: 1, row: { slot: 4, text: 't4' } },
    ]);
    expect(deletes).toEqual([3, 4]);
  });
});
