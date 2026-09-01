import { PHOTOS_MAX } from '@/features/profile/validation';

/** Anything with an id and a slot: a photo row, or a test's stand-in. */
export type Slotted = { id: string; position: number };

/**
 * Choosing which photo leads is the highest-leverage edit anybody makes to a
 * profile, and the database has allowed it since the first migration:
 * `grant update (position) on public.profile_photos to authenticated`, with
 * moderation_status and storage_path deliberately outside the grant. What was
 * missing was the arithmetic, and the arithmetic is the whole risk.
 *
 * Two rules shape everything here:
 *
 *   1. Slots are effectively unique per user. Nothing in the schema enforces
 *      it (the CHECK is only `between 0 and 8`), and every reader takes
 *      `order by position` and then the first row — so two photos sharing
 *      slot 0 means the profile has two profile photos and whichever comes
 *      back first wins.
 *   2. PostgREST cannot write per-row values in one statement, so a reorder
 *      is several round trips. The ORDER of those writes is therefore the
 *      only thing standing between a reorder and a duplicate.
 */

/**
 * The list as a reader sees it, with `id` moved to `toIndex` and every slot
 * renumbered 0..n-1.
 *
 * Renumbering rather than swapping is deliberate: a delete leaves a hole, and
 * a swap would preserve it forever. This closes holes as a side effect, which
 * is also what keeps `nextPosition` in the grid handing out the slot the
 * person expects.
 */
export function reorderedPhotos<T extends Slotted>(photos: T[], id: string, toIndex: number): T[] {
  const list = [...photos].sort((a, b) => a.position - b.position);
  const from = list.findIndex((photo) => photo.id === id);
  if (from < 0) {
    return list;
  }
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list.map((photo, index) => ({ ...photo, position: index }));
}

/**
 * The writes that carry `before` to `after`, in an order no two photos ever
 * share a slot.
 *
 * A reorder is a permutation, so it is a set of cycles, and a cycle cannot be
 * walked in place: something has to step aside first. While the gallery has a
 * free slot — anything under PHOTOS_MAX photos — that is where it steps, and
 * the whole sequence is duplicate-free. A FULL gallery has no free slot
 * inside the 0..8 the CHECK allows, and there the plan empties the lowest
 * occupied slot first: for one round trip the profile has no photo in slot 0
 * and falls back to the next one, which is a real photo, rather than having
 * two photos claiming to be the profile photo.
 */
export function photoWritePlan(
  before: Slotted[],
  after: Slotted[],
  slots: number = PHOTOS_MAX
): Slotted[] {
  const now = new Map(before.map((photo) => [photo.id, photo.position]));
  const holders = (position: number) =>
    [...now.entries()].filter(([, at]) => at === position).map(([id]) => id);
  const pending = after.filter((photo) => now.get(photo.id) !== photo.position);
  const writes: Slotted[] = [];
  const commit = (id: string, position: number) => {
    writes.push({ id, position });
    now.set(id, position);
  };
  // Every pass either lands a photo or frees the slot that lets the next one
  // land, so this terminates. The bound is belt and braces: a plan that
  // cannot finish must return a short plan, never spin.
  const bound = pending.length * 3 + slots + 4;

  while (pending.length > 0 && writes.length < bound) {
    const ready = pending.findIndex((photo) => {
      const held = holders(photo.position);
      return held.length === 0 || (held.length === 1 && held[0] === photo.id);
    });
    if (ready >= 0) {
      const [photo] = pending.splice(ready, 1);
      commit(photo.id, photo.position);
      continue;
    }
    // Nothing can land: every remaining move wants a slot somebody still
    // holds. Step one of them aside into a free slot, and it lands on the
    // next pass.
    let free: number | null = null;
    for (let slot = 0; slot < slots; slot += 1) {
      if (holders(slot).length === 0) {
        free = slot;
        break;
      }
    }
    if (free != null) {
      commit(pending[0].id, free);
      continue;
    }
    // A full gallery, so there is nowhere to step. Move the photo sitting in
    // the LOWEST slot, which empties that slot and puts the unavoidable
    // duplicate somewhere that is not the profile photo.
    let lowest = 0;
    for (let i = 1; i < pending.length; i += 1) {
      if ((now.get(pending[i].id) ?? 0) < (now.get(pending[lowest].id) ?? 0)) {
        lowest = i;
      }
    }
    const [photo] = pending.splice(lowest, 1);
    commit(photo.id, photo.position);
  }

  return writes;
}
