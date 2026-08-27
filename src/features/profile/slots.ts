/**
 * Slot arithmetic, shared by every capped list on a profile.
 *
 * Prompts and priorities both store `slot` rather than a position, because
 * the cap then falls out of the primary key: there is no sequence of writes
 * that produces a row past the ceiling, no count trigger, and nothing for the
 * client to enforce. The price is that removing a middle entry leaves a hole,
 * which `tightenSlots` closes.
 */

/** The lowest free slot, or null when the list is full. */
export function nextFreeSlot(usedSlots: number[], max: number): number | null {
  for (let slot = 0; slot < max; slot += 1) {
    if (!usedSlots.includes(slot)) {
      return slot;
    }
  }
  return null;
}

/**
 * Turn the rows that should survive into `0..n-1`.
 *
 * `writes` is what to upsert and `deletes` is what to remove afterwards, and
 * both orders matter:
 *
 * - Writes come out ASCENDING. Slots only ever move down, so by the time slot
 *   `i` is written, whatever used to sit there has already been copied to its
 *   own lower slot. Any other order overwrites a row that has not moved yet.
 * - Deletes come last, and they are every previously-occupied slot at or past
 *   the new length — not merely the highest one. A list at slots [0, 3, 4]
 *   losing slot 0 leaves BOTH 3 and 4 behind after the writes, and deleting
 *   only the maximum would orphan slot 3.
 *
 * Rows already in place produce no write, so a tight list costs nothing.
 */
export function tightenSlots<T extends { slot: number }>(
  survivors: T[],
  occupiedBefore: number[]
): { writes: { slot: number; row: T }[]; deletes: number[] } {
  const ordered = [...survivors].sort((a, b) => a.slot - b.slot);
  const writes = ordered
    .map((row, slot) => ({ slot, row }))
    .filter((write) => write.row.slot !== write.slot);
  const deletes = occupiedBefore.filter((slot) => slot >= ordered.length).sort((a, b) => a - b);
  return { writes, deletes };
}
