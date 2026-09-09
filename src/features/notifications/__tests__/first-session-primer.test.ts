import fs from 'node:fs';
import path from 'node:path';

import { justOnboarded } from '@/features/profile/just-onboarded';

/**
 * The calm ask: mounted, worded, and scoped to somebody it can actually
 * deliver to.
 *
 * The store's own rules are in primer-store.test.ts. What is left is the
 * three things that break silently: a hook nobody calls, copy that asks for a
 * permission without saying what it buys, and a guest being asked for one the
 * app has no account to use.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

describe('the first-session ask is reachable', () => {
  it('is called where the other data-driven ask is', () => {
    // Beside useHelloReceivedPrimer, in the render-nothing component that
    // already waits for a mounted stack and a live session. A hook added to
    // the repo and called nowhere is the failure this project keeps paying
    // for, and it passes a green unit suite every time.
    const layout = read('src/app/(tabs)/_layout.tsx');
    expect(layout).toContain('useFirstSessionPrimer()');
    expect(layout).toContain(
      "import { useFirstSessionPrimer } from '@/features/notifications/use-first-session-primer'"
    );
  });

  it('never asks a guest for a permission it has no account to use', () => {
    const hook = read('src/features/notifications/use-first-session-primer.ts');
    expect(hook).toContain('useIsGuest');
    expect(hook).toMatch(/if \(asked\.current \|\| isGuest \|\|/);
  });

  it('turns on the same "just finished signup" the map strip does', () => {
    // One definition. Two copies of a rule about clocks drift, and these two
    // surfaces are meant to be the same moment.
    const hook = read('src/features/notifications/use-first-session-primer.ts');
    const map = read('src/features/pins/map-screen.tsx');
    expect(hook).toContain('justOnboarded(profile?.onboarding_completed_at)');
    expect(map).toContain('justOnboarded(ownProfile?.onboarding_completed_at)');
  });
});

describe('what the first-session sheet says', () => {
  const copy = read('src/features/notifications/push-primer.tsx');

  it('names the thing that just happened before it asks for anything', () => {
    // Not an ambush at signup: something HAS happened, and the body says so
    // in its first clause.
    expect(copy).toContain("title: 'Want to know when somebody says hi?'");
    expect(copy).toContain('Your profile is live, so people can write to you from today.');
  });

  it('carries the same absolute promise as every other gate', () => {
    // "Nothing else, ever" is why people say yes; a fourth reason that
    // softened it would cost more than it is worth.
    const at = copy.indexOf("'first-session': {");
    expect(at).toBeGreaterThan(-1);
    const block = copy.slice(at, copy.indexOf('},', at));
    expect(block).toContain('Replies, first messages, your own trips and plans');
    expect(block).toContain('Nothing else, ever.');
  });
});

describe('justOnboarded', () => {
  it('is true for a stamp inside this app session', () => {
    expect(justOnboarded(new Date().toISOString())).toBe(true);
  });

  it('allows for the server clock running ahead of this device', () => {
    // The row is stamped by Postgres and read by a phone; a few minutes of
    // skew must not turn "just now" into "never".
    expect(justOnboarded(new Date(Date.now() + 60_000).toISOString())).toBe(true);
  });

  it('is false for somebody who signed up last week', () => {
    expect(justOnboarded(new Date(Date.now() - 7 * 24 * 3_600_000).toISOString())).toBe(false);
  });

  it('is false for an account that has never finished, and for nonsense', () => {
    expect(justOnboarded(null)).toBe(false);
    expect(justOnboarded(undefined)).toBe(false);
    expect(justOnboarded('')).toBe(false);
    expect(justOnboarded('not a date')).toBe(false);
  });
});
