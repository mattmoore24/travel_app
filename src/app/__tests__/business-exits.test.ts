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
    // One shared element, so the ten steps cannot drift apart.
    expect(code).toContain("router.replace('/(tabs)')");
    expect(code).toContain('const leaveFooter =');
    // Every StepShell in the file hands its footer slot one of exactly two
    // elements, and both of them end in leaveFooter: the plain one, and
    // listingFooter, which is the inline code box stacked on top of it. So
    // the count that matters is not how many times leaveFooter appears but
    // whether any step passes something else, or nothing at all.
    const footers = code.match(/footer=\{(\w+)\}/g) ?? [];
    const shells = code.match(/<StepShell/g) ?? [];
    expect(shells.length).toBe(10);
    expect(footers.length).toBe(shells.length - 1);
    for (const footer of footers) {
      expect(['footer={leaveFooter}', 'footer={listingFooter}']).toContain(footer);
    }
    // The one step whose footer is written inline rather than named is "Where
    // is it?", which adds a Try again above the same element.
    expect(code).toContain('{leaveFooter}');
    expect(code).toContain('const listingFooter = (');
  });

  it('business-email keeps its own way out, now that it has no close button', () => {
    // It used to be a StepScreen with an onClose. StepShell has no such slot,
    // and this screen is arrived at by `replace`, so without a footer exit the
    // only way off a code that never arrives is to kill the app - which is
    // the trap the whole of this file exists to keep shut.
    const code = source('business-email.tsx');
    expect(code).toContain('label="Finish this later"');
    expect(code).toContain(
      "onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}"
    );
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

/**
 * Nothing is ever left underneath business-signup.
 *
 * The screen's whole exit design assumes it: registering flips isBusiness,
 * the root's Protected guards change, and any route still mounted below is
 * filtered out from under a live screen. That is the crash at the top of this
 * file, and the e2e suite reproduced it for three consecutive runs after a
 * "Finish listing your business" row was added to the profile with a push.
 *
 * The tell is that the exit itself is unguarded — business-signup replaces to
 * the tabs without checking canGoBack, on the stated grounds that canGoBack is
 * false in the normal case. A push entrance makes that false, and then the
 * unguarded exit and the guard flip are both wrong at once.
 */
describe('every door into business-signup is a replace', () => {
  it.each(['profile-me.tsx', 'onboarding/index.tsx', '(auth)/join.tsx'])(
    '%s does not push it',
    (file) => {
      const code = source(...file.split('/'));
      expect(code).not.toContain("push('/business-signup')");
      expect(code).toContain("replace('/business-signup')");
    }
  );
});

/**
 * Nothing mounted in the tabs may navigate while the tabs are not on screen.
 *
 * The rule exists because of a crash that took three wrong fixes to find. A
 * listing account now keeps `(tabs)` mounted for the whole business signup
 * (features/auth/routing.ts, the wantsBusiness arm — that is what makes
 * "Finish this later" able to land on the map). So the render-nothing handoffs
 * inside (tabs)/_layout.tsx are alive UNDERNEATH the listing form, and when
 * register_business flips the account kind, BusinessLanding fired a
 * `router.navigate('/(tabs)/my-business')` from a route below the focused one.
 *
 * expo-router does not treat that as "go back to the tabs". Its StackRouter
 * compares the action's root against routes[index], finds `(tabs)` and
 * `business-signup` differ, and APPENDS — pushing a second `(tabs)` route, and
 * with it a second native tab controller, into a live stack. That is the
 * ingredient this project has already died from once.
 *
 * BusinessLanding did try to express this, with `listingIntent`. That guard is
 * dead: business-signup clears the flag in its own mount effect, so the brake
 * is off by the time the account becomes a business. Focus is the honest test.
 */
describe('the tab handoffs do not navigate from underneath', () => {
  const layout = source('(tabs)', '_layout.tsx');

  it('every one of them is gated on the tabs being on screen', () => {
    // Four render-nothing components navigate: the invite, the business
    // landing, the pending intent and the sign-in door.
    const guards = layout.match(/const onScreen = useTabsAreOnScreen\(\);/g);
    expect(guards).toHaveLength(4);
    expect(layout).toContain('function useTabsAreOnScreen()');
    expect(layout).toContain('useIsFocused()');
  });

  it('and the business landing checks it before the account kind', () => {
    expect(layout).toContain(
      'if (landed.current || !onScreen || !viewerIsBusiness || listingIntent)'
    );
  });

  it('keeps focus in the deps, so the landing still happens later', () => {
    // Gating is not cancelling: D8 says a business lands on My business, and
    // it still does — the moment the form finishes and the tabs come back.
    expect(layout).toContain('}, [onScreen, viewerIsBusiness, listingIntent]);');
  });
});

/**
 * Two dead ends the review pass found in this batch's own new code, both of
 * them re-creating a bug the file beside them had just fixed.
 */
describe('the code screen always has a way off it', () => {
  const email = source('business-email.tsx');

  it('offers Finish this later in both branches, not only one', () => {
    // It used to sit inside the ELSE branch, so tapping "Use a different
    // address" left one text field, one send button, and no exit - which is
    // the dead end this screen exists to remove, moved one branch over.
    expect((email.match(/label="Finish this later"/g) ?? []).length).toBe(1);
    // One button that renders after BOTH arms of the ternary cannot be
    // branch-specific. 'Send a code to this address' is the changing arm's
    // last control; 'Send the code to a different address' is the other's.
    const exit = email.indexOf('label="Finish this later"');
    expect(exit).toBeGreaterThan(email.indexOf('Send a code to this address'));
    expect(exit).toBeGreaterThan(email.indexOf('Send the code to a different address'));
  });

  it('lets somebody keep the address they already had', () => {
    // Tapping "Use a different address" is one tap and easy to do by
    // accident, and the code already sent is still good. Without this the
    // only way back to it was to retype the same address and spend a second
    // of the five.
    expect(email).toContain('label="Keep the address you had"');
    expect(email).toContain('setChanging(false)');
    expect(email).toContain('changing && address ?');
  });
});

describe('the contact step does not burn a code per back-navigation', () => {
  it('guards its send exactly as sendCode does', () => {
    const signup = source('business-signup.tsx');
    // saveContacts fired requestCode unconditionally. Continue, back one
    // screen, Continue again is an ordinary thing to do while checking a
    // phone number, and each pass spent one of the five daily sends AND
    // invalidated the digits already in the owner's inbox. sendCode() thirty
    // lines below carried the guard already.
    expect(signup).toContain('if (sentTo !== target || !(codeLive || codeBounced))');
    // Both senders read the same two flags, so they cannot drift on what
    // counts as a code already in flight. The contact step additionally
    // scopes them to the address, because it is the step somebody comes back
    // to in order to FIX that address - see business-edges.test.ts.
    expect((signup.match(/codeLive/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
