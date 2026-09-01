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
