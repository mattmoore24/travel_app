import fs from 'node:fs';
import path from 'node:path';

import { coverIdOf } from '@/features/business/business-photos';

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
    const guard = code.slice(code.indexOf('const pick = async'));
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
    const watch = code.slice(code.indexOf('refetchInterval:'));
    expect(watch.slice(0, watch.indexOf('});'))).toContain(': false');
  });
});
