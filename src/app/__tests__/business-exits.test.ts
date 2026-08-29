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
});
