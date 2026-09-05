import fs from 'node:fs';
import path from 'node:path';

/**
 * Every sign-up gate asks for the same thing, in the same words.
 *
 * A guest could meet two gates in one session and be asked to do two
 * apparently different things: Drop a pin said "Make a profile", tapping a
 * pin to see who is going said "Create an account", and both were
 * map-screen.tsx pushing the same /join. The fix removed the `cta` prop from
 * the component entirely, so no caller can drift again — which is exactly
 * what this file asserts.
 */
const SRC = path.join(__dirname, '..', '..', '..');

const stripped = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('one call to action for making an account', () => {
  it('no call site passes a cta at all', () => {
    // The prop is gone from the signature; a `cta=` anywhere under src/ is
    // either a caller that predates its removal or the prop creeping back.
    const offenders = walk(SRC).filter((file) =>
      /\bcta=/.test(stripped(fs.readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it('the one string is "Make a profile"', () => {
    const gate = stripped(
      fs.readFileSync(path.join(SRC, 'components', 'ui', 'sign-up-gate.tsx'), 'utf8')
    );
    expect(gate).toContain("const CTA = 'Make a profile';");
    // "account" stays the business flow's word; the gate's reasons are about
    // the profile.
    expect(gate).not.toContain('Create an account');
  });
});
