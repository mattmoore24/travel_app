import { heldPhotoNotice, photoRejection } from '@/constants/moderation';

/**
 * The point of this module is a distinction the old UI did not draw: a
 * classifier that gave up is not a rules breach, and saying it is to somebody
 * who did nothing wrong is the bug. So the tests that matter are the ones
 * that fail if the two cases ever read the same again.
 */

// Spelled the way the SQL copy-lint and the policy test spell it.
const BANNED = /\b(swipe|deck|match|unmatch(?:ed)?|request)\b/i;
const EM_DASH = '—';

describe('photoRejection', () => {
  it('never calls a failsafe a rules breach, whatever category came with it', () => {
    const why = photoRejection('moderation_unavailable', 'failsafe');
    expect(why.failsafe).toBe(true);
    expect(why.chip).toBe('Try again');
    expect(why.body).toContain('Nothing about it broke a rule');
    expect(why.body).not.toContain('house rules');
  });

  it('names the category for a real rejection and says a machine decided', () => {
    const why = photoRejection('explicit', 'claude-moderator');
    expect(why.failsafe).toBe(false);
    expect(why.chip).toBe('Removed');
    expect(why.title).toBe('Nudity or sexual content');
    expect(why.body).toContain('automatic check');
    expect(why.body).toContain('Contact us');
  });

  it('falls back to the generic sentence rather than printing a raw token', () => {
    // 'refusal' is a real value the worker writes and the photo schema does
    // not name, so this is the live case, not a hypothetical one.
    for (const category of ['refusal', 'something_new', null, undefined]) {
      const why = photoRejection(category, 'claude-moderator');
      expect(why.title).toBe('Against the house rules');
      expect(why.body).not.toContain(String(category));
    }
  });

  it('gives every rules rejection a way to a person, and no failsafe one', () => {
    for (const category of ['explicit', 'suggestive', 'violent', 'other_violation']) {
      expect(photoRejection(category, 'claude-moderator').body).toContain('Contact us');
    }
    expect(photoRejection('explicit', 'failsafe').body).not.toContain('Contact us');
  });

  it('writes copy the app is allowed to show', () => {
    const lines = ['explicit', 'suggestive', 'violent', 'other_violation', 'refusal'].flatMap(
      (category) => {
        const rules = photoRejection(category, 'claude-moderator');
        const failsafe = photoRejection(category, 'failsafe');
        return [rules.chip, rules.title, rules.body, failsafe.chip, failsafe.title, failsafe.body];
      }
    );
    expect(lines.filter((line) => line.includes(EM_DASH))).toEqual([]);
    expect(lines.filter((line) => BANNED.test(line))).toEqual([]);
  });
});

describe('heldPhotoNotice', () => {
  it('says the failsafe when the failsafe is all there is', () => {
    expect(heldPhotoNotice({ heldBack: 1, rejected: 0, failsafe: 1 })).toBe(
      'One photo could not be checked, so nobody else can see it. Tap to try again.'
    );
  });

  it('says removed only when something was actually removed', () => {
    expect(heldPhotoNotice({ heldBack: 2, rejected: 2, failsafe: 0 })).toBe(
      '2 photos were removed and nobody else can see them. Tap to see why.'
    );
  });

  it('does not call a genuine rejection a timeout when somebody holds both', () => {
    // The case the boolean pair got wrong. One timeout plus one real
    // rejection read as "could not be checked... tap to try again", which
    // invites an upload of the photo that WAS refused - and that one costs a
    // strike. The rules half has the consequence, so it wins the sentence.
    const both = heldPhotoNotice({ heldBack: 2, rejected: 1, failsafe: 1 });
    expect(both).toBe('2 photos were removed and nobody else can see them. Tap to see why.');
    expect(both).not.toContain('try again');
  });

  it('keeps the waiting case a wait', () => {
    expect(heldPhotoNotice({ heldBack: 1, rejected: 0, failsafe: 0 })).toBe(
      'One photo is still being checked, so nobody else can see it yet.'
    );
  });
});
