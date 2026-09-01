import fs from 'node:fs';
import path from 'node:path';

import { after } from '@/lib/__tests__/source';

/**
 * Signup asks for every part of a profile, once, and ends by showing it.
 *
 * Founder: "The business and individual should be prompted to add to each
 * part of their profile during the onboarding, with detailed descriptions of
 * what they are adding at that moment, with a small 'skip for now' button for
 * only non-essential items... It should also give you a final look of how your
 * profile appears to other users at the end of onboarding."
 *
 * What this guards is the SEQUENCE and which steps are passable, neither of
 * which a render test can see. The three sections it exists for — prompts,
 * top priorities and trips — were in the schema, on the profile and in the
 * Travelers screen, and nothing in signup had ever mentioned them.
 */
const source = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const stripped = (...parts: string[]): string =>
  source(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('every part of a profile is asked for', () => {
  const code = stripped('onboarding', 'index.tsx');

  it.each([
    ['Add a photo', 5],
    ['What do you do?', 6],
    ['A bit about you', 7],
    ['Answer a prompt', 8],
    ['What are you after?', 9],
    ['Where are you going?', 10],
    ['Your socials', 11],
    // The statement, not the question: a brand-new account cannot change the
    // audience (set_visibility refuses without the badge), so the step reads
    // rather than asks. The question form is the verified branch.
    ['Who can see you', 12],
    ['Here you are', 13],
  ])('asks "%s" at step %i', (title, step) => {
    const at = code.indexOf(`step={${step}}`);
    expect(at).toBeGreaterThan(-1);
    // The title belongs to that step's shell, so it sits close after it.
    expect(code.slice(at, at + 400)).toContain(title);
  });

  it('counts thirteen steps in one place', () => {
    const steps = source('..', 'features', 'signup', 'steps.ts');
    expect(steps).toContain('SIGNUP_TOTAL_STEPS = 13');
    // Every shell reads the constant for `total`, so the bar stays honest.
    expect(code).not.toMatch(/total=\{1[0-9]\}/);
  });
});

describe('skip is only on the steps that may be skipped', () => {
  const code = stripped('onboarding', 'index.tsx');

  const shellAt = (step: number): string => {
    const at = code.indexOf(`step={${step}}`);
    const next = code.indexOf('<StepShell', at);
    return code.slice(at, next > at ? next : at + 2600);
  };

  it.each([3, 4, 5, 12, 13])('step %i cannot be skipped', (step) => {
    expect(shellAt(step)).not.toContain('onSkip');
  });

  it.each([6, 7, 11])('step %i can be', (step) => {
    expect(shellAt(step)).toContain('onSkip');
  });

  it('step 12 answers with copy, not a skip', () => {
    // The audience step has a default rather than an answer, so the cheap
    // fix — onSkip={() => go(13)} — would hide the setting from exactly the
    // person the founder added the step for. The statement title and "Got
    // it" are the fix instead.
    const shell = shellAt(12);
    expect(shell).not.toContain('onSkip');
    expect(shell).toContain('Who can see you');
    expect(shell).toContain('Got it');
  });

  it('every skip names what it is skipping', () => {
    // "Skip for now" told nobody what they were giving up at the moment they
    // gave it up. Each onSkip travels with its own skipLabel; the shell's
    // generic default is only a fallback, never what ships here.
    for (const step of [6, 7, 8, 9, 10, 11]) {
      expect(shellAt(step)).toContain('skipLabel=');
    }
  });

  it('lets the photo step through only once there is a photo', () => {
    // Position 0, not "any photo": adding one through the small + under "More
    // photos" used to satisfy a screen headed "Add a photo".
    expect(shellAt(5)).toContain('continueDisabled={!hasProfilePhoto}');
  });

  it('the trip skip names its cost, and only while there is no trip', () => {
    const shell = shellAt(10);
    // The label and its note travel together, inside the same no-trips
    // branch: the skip itself only renders when trips.length === 0, and
    // StepShell renders skipNote only while onSkip exists.
    expect(shell).toContain("I'll add it later");
    expect(shell).toContain('Travelers stays closed until you do. The map does not.');
    expect(shell).toContain('onSkip={trips.length > 0 ? undefined');
    const stepShell = stripped('..', 'features', 'signup', 'step-shell.tsx');
    const skipBlock = after(stepShell, '{onSkip ? (');
    expect(skipBlock).toContain('skipNote');
  });

  it('the Travelers wall finishes the sentence the skip started', () => {
    const travelers = stripped('(tabs)', 'travelers.tsx');
    expect(travelers).toContain('Travelers opens once you add a trip');
    expect(travelers).not.toContain('Add a trip first');
  });
});

describe('the last step is the profile, not a summary of it', () => {
  const code = stripped('onboarding', 'index.tsx');

  it('renders the same component, in owner mode, with every edit going to a step', () => {
    // The step used to render the stranger's copy and tell people to "step
    // back to change anything", where back was a one-step chevron: a typo in
    // the name was ten Back taps away. Owner mode is safe here precisely
    // because ProfileView navigates nowhere itself — every affordance is a
    // caller-supplied callback, and here every one of them is a step jump,
    // not a route behind the `onboarded` guard this account cannot satisfy.
    expect(code).toContain('<ProfileView');
    expect(code).toMatch(/<ProfileView[\s\S]*?\n\s+owner\n/);
    expect(code).not.toContain('owner={false}');
    expect(code).toMatch(/onEditSection=\{\(section\) =>[\s\S]{0,200}?jumpToStep\(/);
    expect(code).toContain('onEditPrompt={() => jumpToStep(8)}');
    expect(code).toContain('onEditPriorities={() => jumpToStep(9)}');
    // And the jump is a round trip: Continue from the step you landed on
    // comes back to the review rather than walking signup a second time.
    expect(code).toContain('setReturnTo(REVIEW_STEP)');
    expect(code).toMatch(/if \(returnTo != null\) \{[\s\S]{0,120}?setStep\(returnTo\)/);
    // Not the TripEditor sheet: a modal presented from inside StepShell is
    // the Fabric touch-death trap.
    expect(code).toContain('onEditTrips={() => jumpToStep(10)}');
    // Steps 8 and 9 push /edit-prompt and /edit-priorities for real, so the
    // check is scoped to the review block: nothing in it navigates.
    const review = after(code, '<ProfileView');
    expect(review).not.toContain('router.');
  });

  it('is the only place the stamp is written', () => {
    const stamps = code.match(/onboarding_completed_at/g) ?? [];
    expect(stamps).toHaveLength(1);
    expect(code.indexOf('onboarding_completed_at')).toBeGreaterThan(code.indexOf('step={13}'));
  });

  it('says the same thing about changing your mind everywhere', () => {
    // One constant rather than thirteen hand-written reassurances: the moment
    // they drift they read as filler instead of a promise.
    expect(code).toContain('const CHANGE_LATER =');
    expect((code.match(/note=\{CHANGE_LATER\}/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
