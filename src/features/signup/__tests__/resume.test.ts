import fs from 'node:fs';
import path from 'node:path';

import { RESUME_FIRST_STEP, RESUME_LAST_STEP, resumeStep, type ResumeProfile } from '../resume';

/**
 * Onboarding used to open at step 3 whatever was already answered, so anybody
 * who quit at the photo step, whose phone killed the app, or who reinstalled
 * was walked back through screens that each showed their own answer already
 * in the box. Nothing was lost - every step saves on the way past it - but it
 * reads as an app that did not register them the first time.
 */
const blank: ResumeProfile = {
  display_name: null,
  age: null,
  home_city: null,
  home_country: null,
  languages: [],
  occupation: null,
  bio: null,
};

const basics = { ...blank, display_name: 'Ana', age: 29 };
const home = { ...basics, home_city: 'Lisbon', home_country: 'Portugal', languages: ['en'] };

const step = (
  profile: ResumeProfile,
  extras: Partial<{
    hasProfilePhoto: boolean;
    prompts: unknown[];
    priorities: unknown[];
    trips: unknown[];
  }> = {}
) =>
  resumeStep({
    profile,
    hasProfilePhoto: false,
    prompts: [],
    priorities: [],
    trips: [],
    ...extras,
  });

describe('resumeStep', () => {
  it('opens a brand new account at the first step, which is the case that must not regress', () => {
    expect(step(blank)).toBe(RESUME_FIRST_STEP);
    expect(step(blank)).toBe(3);
  });

  it('one past the basics is step 4', () => {
    expect(step(basics)).toBe(4);
  });

  it('one past home is the photo step', () => {
    expect(step(home)).toBe(5);
  });

  it('holds at the photo step until there is a photo, which is the quit-here case', () => {
    expect(step(home, { hasProfilePhoto: false })).toBe(5);
    expect(step(home, { hasProfilePhoto: true })).toBe(6);
  });

  it('walks the optional steps one past the last answer', () => {
    const withPhoto = { hasProfilePhoto: true };
    expect(step({ ...home, occupation: 'Nurse' }, withPhoto)).toBe(7);
    expect(step({ ...home, occupation: 'Nurse', bio: 'Hello' }, withPhoto)).toBe(8);
    expect(step(home, { ...withPhoto, prompts: [{}] })).toBe(9);
    expect(step(home, { ...withPhoto, priorities: [{}] })).toBe(10);
    expect(step(home, { ...withPhoto, trips: [{}] })).toBe(11);
  });

  it('the skipped-bio-with-a-trip case, which is the one that decides the rule', () => {
    // Passed the bio deliberately, then added a trip. Resuming at 7 would
    // walk them back through four screens they chose to pass; the rule is
    // one past the HIGHEST step with data, not the first gap.
    expect(step({ ...home, occupation: 'Nurse' }, { hasProfilePhoto: true, trips: [{}] })).toBe(11);
  });

  it('a required step that is unsatisfied is a floor nothing gets past', () => {
    // A profile carrying prompts, priorities and a trip but no photo: the
    // photo step has no skip button, so it cannot be resumed past.
    expect(
      step(home, { hasProfilePhoto: false, prompts: [{}], priorities: [{}], trips: [{}] })
    ).toBe(5);
    // ...and the floor is the FIRST unsatisfied one, not the last.
    expect(step({ ...basics, languages: [] }, { hasProfilePhoto: true, trips: [{}] })).toBe(4);
    expect(step({ ...blank, home_city: 'Lisbon', languages: ['en'] }, { trips: [{}] })).toBe(3);
  });

  it('a name with no age has not answered step 3', () => {
    expect(step({ ...blank, display_name: 'Ana' })).toBe(3);
    expect(step({ ...blank, age: 29 })).toBe(3);
  });

  it('a home city with no language has not answered step 4', () => {
    expect(step({ ...basics, home_city: 'Lisbon' })).toBe(4);
    expect(step({ ...basics, languages: ['en'] })).toBe(4);
  });

  it('treats whitespace as unanswered', () => {
    expect(step({ ...home, occupation: '   ' }, { hasProfilePhoto: true })).toBe(6);
    expect(step({ ...home, occupation: 'Nurse', bio: '  ' }, { hasProfilePhoto: true })).toBe(7);
  });

  it('never returns a step outside the range onboarding can render', () => {
    const everything = step(
      { ...home, occupation: 'Nurse', bio: 'Hello' },
      {
        hasProfilePhoto: true,
        prompts: [{}, {}, {}],
        priorities: [{}, {}],
        trips: [{}, {}],
      }
    );
    expect(everything).toBeGreaterThanOrEqual(RESUME_FIRST_STEP);
    expect(everything).toBeLessThanOrEqual(RESUME_LAST_STEP);
  });
});

describe('onboarding spends it', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'onboarding', 'index.tsx'),
    'utf8'
  );

  it('seeds the step from resumeStep rather than hardcoding the first one', () => {
    expect(source).toContain('resumeStep({');
    // Comments are stripped first: the comment above the seed quotes the old
    // expression on purpose, and a scan that cannot tell code from prose
    // would fail on the very line that explains the change.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('useState(3)');
  });

  it('waits for the four queries the seed reads before mounting the steps', () => {
    // Seeding from a query that lands late is a step number that changes
    // under the person's finger, so the hold is load-bearing, not tidiness.
    for (const query of ['photosQuery', 'promptsQuery', 'prioritiesQuery', 'tripsQuery']) {
      expect(source).toContain(query);
    }
    expect(source).toContain('query.isSuccess || query.isError');
  });
});
