import fs from 'node:fs';
import path from 'node:path';

import { guestEmptyCityLine, guestGateReason } from '@/features/guest/copy';

/**
 * The guest Travelers screen must never contradict itself in an empty city.
 *
 * The shipped pair was 'Nobody in town this week.' directly above a sign-up
 * card reading 'See everyone else in town' — and the empty branch is the
 * launch-day state (LAUNCH_RUNBOOK step 4 purges the demo travelers before
 * real users arrive). Both sentences now come from functions of the same
 * `featured` value, so the contradiction is impossible by construction; this
 * test pins both the functions and the screen's use of them.
 */

const screen = fs
  .readFileSync(path.join(__dirname, '..', '(tabs)', 'travelers.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the sign-up reason follows the featured branch', () => {
  it('never promises "everyone else" when there is nobody', () => {
    expect(guestGateReason(null, false, 'Lisbon')).toBe('Be one of the first travelers in Lisbon');
    expect(guestGateReason(null, false, null)).toBe('Be one of the first here');
    expect(guestGateReason(null, false, 'Lisbon')).not.toContain('everyone else');
  });

  it('names the featured traveler when there is one', () => {
    expect(guestGateReason('Ana', true, 'Lisbon')).toBe('Make a profile to say hi to Ana');
    expect(guestGateReason(null, true, 'Lisbon')).toBe('Make a profile to say hi to them');
  });

  it('is what the screen actually renders, and the old literal is gone', () => {
    expect(screen).toContain('guestGateReason(');
    expect(screen).not.toContain('See everyone else in town');
  });
});

describe('the empty line carries the evidence the map already has', () => {
  it('counts the plans when there are any', () => {
    expect(guestEmptyCityLine(3, 'Bangkok')).toBe(
      'No profiles to show yet. 3 plans are on the map in Bangkok this week.'
    );
    expect(guestEmptyCityLine(1, 'Bangkok')).toBe(
      'No profiles to show yet. 1 plan is on the map in Bangkok this week.'
    );
  });

  it('falls back to the plain sentence at zero or with no city name', () => {
    expect(guestEmptyCityLine(0, 'Bangkok')).toBe('Nobody in town this week.');
    expect(guestEmptyCityLine(4, null)).toBe('Nobody in town this week.');
  });

  it('is what the screen actually renders', () => {
    expect(screen).toContain('guestEmptyCityLine(');
    expect(screen).not.toMatch(/'Nobody in town this week\.'/);
  });

  it('makes no presence claims', () => {
    for (const line of [
      guestEmptyCityLine(0, 'Bangkok'),
      guestEmptyCityLine(2, 'Bangkok'),
      guestGateReason(null, false, 'Bangkok'),
      guestGateReason('Ana', true, 'Bangkok'),
    ]) {
      expect(line).not.toMatch(/here now|near you|nearby/i);
    }
  });
});
