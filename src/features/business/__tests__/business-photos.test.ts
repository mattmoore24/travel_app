import fs from 'node:fs';
import path from 'node:path';

import { coverIdOf, coverPromotion, PHOTOS_MAX } from '@/features/business/business-photos';
import { after } from '@/lib/__tests__/source';

/**
 * Which photo the public sees as the cover.
 *
 * The whole bug was one index. The editor compared against `photos[0]` and so
 * chipped a pending photo "Cover" and asked "Remove your cover photo?" about
 * something no traveler could see, while every reader outside the owner's own
 * screens takes the first APPROVED row. With require_photo_moderation ON —
 * which is how production runs — a fresh upload is pending for as long as the
 * worker takes, so `photos[0]` and the real cover disagree for every business
 * that has just added one.
 */
const photo = (id: string, moderation_status: 'pending' | 'approved' | 'rejected') => ({
  id,
  moderation_status,
});

describe('coverIdOf', () => {
  it('has no cover for an empty grid', () => {
    expect(coverIdOf([])).toBeNull();
  });

  it('has no cover while everything is still in review', () => {
    expect(coverIdOf([photo('a', 'pending'), photo('b', 'pending')])).toBeNull();
  });

  it('skips a pending first photo and names the approved second', () => {
    // The case the old code got wrong: the map has already promoted 'b', and
    // the grid was still calling 'a' the cover.
    expect(coverIdOf([photo('a', 'pending'), photo('b', 'approved')])).toBe('b');
  });

  it('skips a rejected first photo too', () => {
    expect(coverIdOf([photo('a', 'rejected'), photo('b', 'approved')])).toBe('b');
  });

  it('takes the first approved photo when several have cleared', () => {
    // Position order, which is what the query sorts by, so the first approved
    // row is the same one `order by position limit 1` gives every reader.
    expect(coverIdOf([photo('a', 'approved'), photo('b', 'approved')])).toBe('a');
  });

  it('has no cover when the only photo was rejected', () => {
    expect(coverIdOf([photo('a', 'rejected')])).toBeNull();
  });
});

/**
 * Choosing a cover, and the one thing it must never do.
 *
 * Before this the cover was whichever photo survived at the lowest position,
 * so an owner replaced it by DELETING every photo ordered before the one they
 * wanted — a cascade of destructive confirms, each losing a photo that had
 * already passed moderation.
 *
 * The arithmetic is the risk, exactly as it was on the profile side: nothing
 * in business_photos enforces a unique slot (the CHECK is only `between 0 and
 * 9`), PostgREST cannot write per-row values in one statement, and every
 * reader takes `order by position` and then the first approved row. So two
 * photos at slot 0 is a business with two covers, and the ORDER of the writes
 * is the whole guarantee — the kind of thing jest can hold and a screenshot
 * cannot.
 */
const slotted = (id: string, position: number, status: 'pending' | 'approved' | 'rejected') => ({
  id,
  position,
  moderation_status: status,
});

/** Walk a plan one write at a time and report every slot ever shared. */
function collisions(
  before: { id: string; position: number }[],
  plan: { id: string; position: number }[]
) {
  const at = new Map(before.map((row) => [row.id, row.position]));
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

describe('a business picks its cover', () => {
  it('promotes an approved photo to the front, and the cover follows', () => {
    const photos = [
      slotted('a', 0, 'approved'),
      slotted('b', 1, 'approved'),
      slotted('c', 2, 'approved'),
    ];
    const promotion = coverPromotion(photos, 'c');
    expect(promotion).not.toBeNull();
    expect(promotion!.next.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(promotion!.next.map((row) => row.position)).toEqual([0, 1, 2]);
    // The point of the whole feature: coverIdOf, which is the same question
    // every reader outside this screen asks, now answers 'c'.
    expect(coverIdOf(promotion!.next)).toBe('c');
  });

  it('is a no-op on the photo that is already the cover', () => {
    const photos = [slotted('a', 0, 'approved'), slotted('b', 1, 'approved')];
    expect(coverPromotion(photos, 'a')).toBeNull();
  });

  it('refuses a photo that has not cleared, and one that was removed', () => {
    // coverIdOf ignores anything but approved rows, so promoting either would
    // renumber the gallery and promise a cover no traveler can see.
    const photos = [
      slotted('a', 0, 'approved'),
      slotted('b', 1, 'pending'),
      slotted('c', 2, 'rejected'),
    ];
    expect(coverPromotion(photos, 'b')).toBeNull();
    expect(coverPromotion(photos, 'c')).toBeNull();
  });

  it('refuses an id that is not in the list', () => {
    expect(coverPromotion([slotted('a', 0, 'approved')], 'ghost')).toBeNull();
  });

  it('promotes past a pending photo sitting at slot 0', () => {
    // The case the old "delete your way to one" rule got worst: 'a' is at the
    // front, is invisible to travelers, and 'b' is the real cover. Promoting
    // 'c' has to land it in front of BOTH.
    const photos = [
      slotted('a', 0, 'pending'),
      slotted('b', 1, 'approved'),
      slotted('c', 2, 'approved'),
    ];
    const promotion = coverPromotion(photos, 'c')!;
    expect(promotion.next.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(coverIdOf(promotion.next)).toBe('c');
  });

  it('closes the hole a delete left rather than preserving it', () => {
    // A swap would send the old cover to slot 3 and leave 1 empty forever.
    const photos = [
      slotted('a', 0, 'approved'),
      slotted('c', 2, 'approved'),
      slotted('d', 3, 'approved'),
    ];
    const promotion = coverPromotion(photos, 'd')!;
    expect(promotion.next.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('never lets two photos hold one slot on the way there', () => {
    for (let size = 2; size <= PHOTOS_MAX - 1; size += 1) {
      const photos = Array.from({ length: size }, (_, index) =>
        slotted(`p${index}`, index, 'approved')
      );
      for (let target = 1; target < size; target += 1) {
        const promotion = coverPromotion(photos, `p${target}`)!;
        expect(collisions(photos, promotion.writes)).toEqual([]);
        // And the writes actually leave the list where `next` says they do.
        const at = new Map(photos.map((row) => [row.id, row.position]));
        for (const write of promotion.writes) {
          at.set(write.id, write.position);
        }
        for (const row of promotion.next) {
          expect(at.get(row.id)).toBe(row.position);
        }
      }
    }
  });

  it('keeps slot 0 clean even on a full grid, which has nowhere to step', () => {
    // Ten photos in ten slots: the plan has no free slot to park a photo in,
    // so one duplicate is unavoidable. It must never be slot 0, which is the
    // one a duplicate would turn into two covers.
    const photos = Array.from({ length: PHOTOS_MAX }, (_, index) =>
      slotted(`p${index}`, index, 'approved')
    );
    const promotion = coverPromotion(photos, 'p7')!;
    expect(collisions(photos, promotion.writes)).not.toContain(0);
    expect(coverIdOf(promotion.next)).toBe('p7');
  });
});

describe('one picker, however many buttons drive it', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'business-photos.tsx'), 'utf8');

  it('latches before the picker opens, not on the mutation flag', () => {
    // Two surfaces share this picker: the dashed tile in the grid and the
    // docked button the signup step is handed through registerPick. Only the
    // tile is disabled while an upload runs, so the button could open a
    // second picker over the first - and nextPosition() is computed from a
    // list the first upload has not landed in yet, so both picks resolved to
    // the SAME slot and made two photos at one position.
    expect(code).toContain('picking.current');
    expect(code).toContain('picking.current = true');
    // A ref, not state: two taps in one frame must not both read false.
    expect(code).toContain('const picking = useRef(false)');
    // Set before any await, and cleared in a finally so a cancelled picker
    // or a failed upload does not wedge the button shut.
    const guard = after(code, 'const pick = async');
    const body = guard.slice(0, guard.indexOf('const pickOne'));
    expect(body.indexOf('picking.current = true')).toBeLessThan(body.indexOf('await'));
    expect(body).toContain('finally');
    expect(body).toContain('picking.current = false');
  });
});

describe('a verdict reaches the screen that is watching for it', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'business-photos.tsx'), 'utf8');

  it('watches while anything is unsettled', () => {
    // This is the screen most likely to be open when a verdict lands:
    // somebody has just added a photo and is looking at the tile that says
    // "In review". Without a watch it says that until the screen is left and
    // come back to, and a rejected photo never gets to explain itself - which
    // is what the chip beside it exists for.
    expect(code).toContain('refetchInterval:');
    expect(code).toContain("photo.moderation_status !== 'approved'");
  });

  it('stops once everything has settled', () => {
    // The poll must end on its own, or an owner reading a finished listing
    // pays for it forever.
    const watch = after(code, 'refetchInterval:');
    expect(watch.slice(0, watch.indexOf('});'))).toContain(': false');
  });
});
