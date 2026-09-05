import fs from 'node:fs';
import path from 'node:path';

import { profileGaps } from '../completion';

/**
 * Steps 6 through 11 of signup are six one-tap skips by design. What was
 * missing was the second ask: nothing noticed that a profile had no prompt,
 * no priorities and no bio, while the Travelers screen is built to show all
 * three.
 */
const full = {
  profile: { bio: 'Hello there', occupation: 'Nurse' },
  prompts: [{}],
  priorities: [{}],
  trips: [{}],
  handles: [{}],
};

const empty = {
  profile: { bio: null, occupation: null },
  prompts: [],
  priorities: [],
  trips: [],
  handles: [],
};

describe('profileGaps', () => {
  it('finds nothing on a finished profile, which is the case that must draw nothing', () => {
    // The important test. A card telling a complete profile to finish itself
    // is a nag on the one screen a person owns.
    const { gaps, count } = profileGaps(full);
    expect(gaps).toEqual([]);
    expect(count).toBe(0);
  });

  it('finds all six on a profile that skipped everything', () => {
    const { gaps, count } = profileGaps(empty);
    expect(count).toBe(6);
    expect(gaps.map((gap) => gap.key)).toEqual([
      'trip',
      'prompt',
      'priorities',
      'bio',
      'occupation',
      'socials',
    ]);
  });

  it('leads with the trip, because the matching runs on it', () => {
    // A profile with no trip is invisible to the feature the app exists for,
    // so it is first whatever else is missing.
    const { gaps } = profileGaps({ ...empty, prompts: [{}], priorities: [{}] });
    expect(gaps[0].key).toBe('trip');
  });

  it('closes each gap independently', () => {
    expect(profileGaps({ ...empty, trips: [{}] }).gaps.map((g) => g.key)).not.toContain('trip');
    expect(profileGaps({ ...empty, prompts: [{}] }).gaps.map((g) => g.key)).not.toContain('prompt');
    expect(profileGaps({ ...empty, priorities: [{}] }).gaps.map((g) => g.key)).not.toContain(
      'priorities'
    );
    expect(profileGaps({ ...empty, handles: [{}] }).gaps.map((g) => g.key)).not.toContain(
      'socials'
    );
  });

  it('treats whitespace as an unanswered box', () => {
    const { gaps } = profileGaps({ ...full, profile: { bio: '   ', occupation: '\n' } });
    expect(gaps.map((gap) => gap.key)).toEqual(['bio', 'occupation']);
  });

  it('never offers back the photo or the name, which had no skip to take', () => {
    // Offering back something nobody could have missed reads as noise, and
    // the tier-3 decision keeps the mandatory photo out of the second ask.
    const keys = profileGaps(empty).gaps.map((gap) => gap.key);
    expect(keys).not.toContain('photo');
    expect(keys).not.toContain('name');
  });

  it('points every row at an editor that already exists', () => {
    const routes = new Set(profileGaps(empty).gaps.map((gap) => gap.route));
    expect([...routes].sort()).toEqual([
      '/add-trip',
      '/edit-priorities',
      '/edit-profile',
      '/edit-prompt',
    ]);
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    for (const gap of profileGaps(empty).gaps) {
      const text = `${gap.title} ${gap.body}`;
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });
});

describe('the two surfaces that spend it', () => {
  const read = (...parts: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');

  it('the card asks profileGaps rather than deciding for itself', () => {
    const card = read('features', 'profile', 'finish-card.tsx');
    expect(card).toContain('profileGaps(');
    // It has to be possible to put away, or it is a nag on the one screen a
    // person owns; and it must vanish the instant the last gap closes.
    expect(card).toContain('dismissed');
    expect(card).toContain('count === 0');
  });

  it("the reader's nudge lives on the stranger's page, not the owner's", () => {
    const view = read('features', 'profile', 'profile-view.tsx');
    expect(view).toContain('onAnswerYourOwnPrompt');
    expect(view).toContain('!owner && prompts[0] && onAnswerYourOwnPrompt');
  });
});
