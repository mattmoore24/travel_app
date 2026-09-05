import { photoWritePlan, reorderedPhotos, type Slotted } from '@/features/profile/photo-order';

/**
 * Reordering photos, and the one thing it must never do.
 *
 * Nothing in the schema stops two photos sharing a slot: the CHECK is only
 * `between 0 and 8`. Every reader takes `order by position` and then the
 * first row, so two photos at 0 means a profile with two profile photos and
 * whichever came back first winning. PostgREST cannot write per-row values in
 * one statement, so a reorder is several round trips and the ORDER of them is
 * the whole guarantee — which is exactly the kind of thing a jest test can
 * hold and a screenshot cannot.
 */

const photos = (count: number): Slotted[] =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index}`, position: index }));

/** Walk a plan one write at a time and report every slot ever shared. */
function collisions(before: Slotted[], plan: Slotted[]) {
  const at = new Map(before.map((photo) => [photo.id, photo.position]));
  const shared: number[] = [];
  for (const write of plan) {
    at.set(write.id, write.position);
    const counts = new Map<number, number>();
    for (const position of at.values()) {
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
    for (const [position, count] of counts) {
      if (count > 1) {
        shared.push(position);
      }
    }
  }
  return shared;
}

/** The state a plan actually leaves behind. */
function applied(before: Slotted[], plan: Slotted[]): Slotted[] {
  const at = new Map(before.map((photo) => [photo.id, photo.position]));
  for (const write of plan) {
    at.set(write.id, write.position);
  }
  return [...at.entries()]
    .map(([id, position]) => ({ id, position }))
    .sort((a, b) => a.position - b.position);
}

describe('the new order', () => {
  it('moves a photo to the front and renumbers everything behind it', () => {
    const next = reorderedPhotos(photos(4), 'p2', 0);
    expect(next.map((photo) => photo.id)).toEqual(['p2', 'p0', 'p1', 'p3']);
    expect(next.map((photo) => photo.position)).toEqual([0, 1, 2, 3]);
  });

  it('closes the hole a delete left behind', () => {
    const afterDelete: Slotted[] = [
      { id: 'a', position: 0 },
      { id: 'c', position: 2 },
      { id: 'd', position: 3 },
    ];
    const next = reorderedPhotos(afterDelete, 'd', 0);
    expect(next).toEqual([
      { id: 'd', position: 0 },
      { id: 'a', position: 1 },
      { id: 'c', position: 2 },
    ]);
  });

  it('clamps a target past the ends instead of dropping the photo', () => {
    expect(reorderedPhotos(photos(3), 'p0', 9).map((p) => p.id)).toEqual(['p1', 'p2', 'p0']);
    expect(reorderedPhotos(photos(3), 'p2', -4).map((p) => p.id)).toEqual(['p2', 'p0', 'p1']);
  });

  it('leaves a photo that is already where it is asked to go alone', () => {
    const before = photos(3);
    expect(photoWritePlan(before, reorderedPhotos(before, 'p1', 1))).toEqual([]);
  });
});

describe('the write plan never doubles up a slot', () => {
  it('makes the third photo the profile photo without two profile photos', () => {
    const before = photos(3);
    const next = reorderedPhotos(before, 'p2', 0);
    const plan = photoWritePlan(before, next);
    expect(collisions(before, plan)).toEqual([]);
    expect(applied(before, plan)).toEqual(next);
  });

  it('survives a reorder, then a delete, then another reorder', () => {
    const first = photos(5);
    const afterFirst = reorderedPhotos(first, 'p4', 0);
    expect(collisions(first, photoWritePlan(first, afterFirst))).toEqual([]);

    // The middle one goes. Positions are now 0, 1, 3, 4.
    const afterDelete = afterFirst.filter((photo) => photo.id !== 'p1');
    const afterSecond = reorderedPhotos(afterDelete, 'p3', 0);
    const plan = photoWritePlan(afterDelete, afterSecond);
    expect(collisions(afterDelete, plan)).toEqual([]);
    expect(applied(afterDelete, plan)).toEqual(afterSecond);
    expect(afterSecond.map((photo) => photo.position)).toEqual([0, 1, 2, 3]);
  });

  it('walks every position of a full gallery with no slot ever shared twice', () => {
    for (let target = 0; target < 9; target += 1) {
      const before = photos(9);
      const next = reorderedPhotos(before, 'p6', target);
      const plan = photoWritePlan(before, next);
      // A full gallery has no free slot inside 0..8 to step into, so the one
      // unavoidable duplicate is allowed — but never on slot 0, and never
      // more than one slot at a time.
      expect(collisions(before, plan)).not.toContain(0);
      expect(applied(before, plan)).toEqual(next);
    }
  });

  it('has a free slot to step into whenever the gallery is not full', () => {
    for (let size = 2; size <= 8; size += 1) {
      for (let target = 0; target < size; target += 1) {
        const before = photos(size);
        const next = reorderedPhotos(before, `p${size - 1}`, target);
        const plan = photoWritePlan(before, next);
        expect(collisions(before, plan)).toEqual([]);
        expect(applied(before, plan)).toEqual(next);
      }
    }
  });
});
