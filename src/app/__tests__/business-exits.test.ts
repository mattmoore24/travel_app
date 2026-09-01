import fs from 'node:fs';
import path from 'node:path';

/**
 * The two screens that can be the only route in the stack.
 *
 * The founder typed a business confirmation code, the app died, and on
 * reopening the listing was live — because the server had already done its
 * half and the client's last line was the problem. Registering the business
 * flips `needsProfile` false, which filters `onboarding` out of the navigator
 * underneath whichever business screen is showing, leaving it at index 0.
 * react-native-screens forces the first screen of a stack to be a push
 * controller whatever its stackPresentation, so a modal there is a state it
 * has to reshuffle out of; `replace` then handed that slot to a group whose
 * layout mounts native tabs in the same commit.
 *
 * Source assertions because the thing being guarded is a route OPTION and a
 * navigation call, neither of which any render test can see.
 */
const source = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the business step flow is not presented as a modal', () => {
  const layout = source('_layout.tsx');

  it.each(['business-signup', 'business-email'])('%s is a plain screen', (name) => {
    const line = layout.split('\n').find((row) => row.includes(`name="${name}"`));
    expect(line).toBeDefined();
    expect(line).not.toContain('modal');
  });

  it('leaves the rest of the business screens as modals', () => {
    // They are pushed from the My business tab, so (tabs) is always under
    // them and they can never be route index 0.
    for (const name of ['business-storefront', 'business-edit', 'business-post']) {
      const line = layout.split('\n').find((row) => row.includes(`name="${name}"`));
      expect(line).toContain("presentation: 'modal'");
    }
  });
});

describe('no screen replaces the root without checking it can go back', () => {
  // Two shapes in the codebase and both are fine: the inline ternary, and an
  // if/else whose condition is canGoBack a few lines up (guest-name). So the
  // rule is "within sight", not "on the same line".
  // business-email is deliberately NOT on this list. Its exit after a
  // successful confirmation has to be a replace: "back" from a listing that
  // just went live would land on the submitted form that created it. What
  // makes that replace safe is the presentation, asserted above.
  // business-signup.tsx is the second exemption, and for the opposite reason
  // to business-email's. Its nine steps now each carry a "Finish this later"
  // that replaces to the tabs UNGUARDED, on purpose: this screen is reached by
  // a `replace` from join, so canGoBack is false in the normal case and a
  // guarded exit would evaluate to nothing at all. That is exactly what steps
  // 4 to 11 had before - no exit whatsoever - which made killing the app the
  // only way to abandon a half-finished listing, and killing the app lost the
  // in-memory flag that kept the account out of traveler onboarding.
  it.each(['profile-me.tsx', 'contact.tsx', 'guest-name.tsx'])('%s guards its exit', (file) => {
    const lines = source(file).split('\n');
    lines.forEach((line, index) => {
      if (!line.includes("router.replace('/(tabs)')")) {
        return;
      }
      const window = lines.slice(Math.max(0, index - 6), index + 1).join('\n');
      expect(window).toContain('canGoBack');
    });
  });

  it('business-signup keeps an unguarded exit on every step of the form', () => {
    const code = source('business-signup.tsx');
    // One shared element, so the nine steps cannot drift apart.
    expect(code).toContain("router.replace('/(tabs)')");
    expect(code).toContain('const leaveFooter =');
    // Steps 3 to 11. Step 12 is the code screen's own hand-off and has its
    // own footer; steps 1 and 2 live in the auth stack.
    const uses = code.match(/leaveFooter/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(10);
  });
});

/**
 * The gap that crashed the listing flow on its confirm step.
 *
 * `owesOnboarding` is false while EITHER isBusiness or wantsBusiness is true,
 * and register_business flips the first one on while the second one goes off.
 * If they do not OVERLAP, there is a render where neither holds: the account
 * reads as an unfinished traveler, `(tabs)` is filtered out of the navigator,
 * and traveler onboarding mounts underneath the screen the owner is standing
 * on. E2E caught it as the app on the springboard.
 *
 * Held here as source assertions, because the bug is an ORDER between two
 * awaits rather than a value any pure function returns.
 */
describe('registering a business changes exactly one thing', () => {
  // Read RAW, comments and all: the assertion below is about the comment that
  // explains the rule, and `source` strips those.
  const hooks = fs.readFileSync(
    path.join(__dirname, '..', '..', 'features', 'business', 'hooks.ts'),
    'utf8'
  );

  it('does not lower the listing intent in the same breath', () => {
    // Two e2e runs died on the confirm step for this. Registering already
    // flips one guard (isBusiness), and a guard flip filters a route out of
    // the navigator underneath the business screen that is showing — the
    // crash this whole file exists to prevent. A second guard-flipping write
    // in the same moment made it reproducible in BOTH orderings.
    // Comments stripped: the explanation above the code names the call it
    // forbids, so a raw read would match its own reasoning.
    const code = source('..', 'features', 'business', 'hooks.ts');
    const success = code.slice(
      code.indexOf('mutationFn: registerBusiness'),
      code.indexOf('mutationFn: registerBusiness') + 400
    );
    expect(success).not.toContain('setListingIntent(false)');
    expect(success).toContain("invalidateQueries({ queryKey: ['my-business'");
  });

  it('says why, so the finding does not get re-applied', () => {
    expect(hooks).toContain('NOTHING ELSE GOES IN HERE');
  });
});
