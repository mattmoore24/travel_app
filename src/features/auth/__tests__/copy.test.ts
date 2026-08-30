import fs from 'node:fs';
import path from 'node:path';

/**
 * The words on /join and the account-kind rows, held in place.
 *
 * Three findings paid for this file: "I'm travelling" was the only British
 * spelling anywhere in src/, sitting two lines above "travelers who can
 * message you"; a business owner was told "profile" on step 1 and "listing"
 * one tap later, two nouns for the same object at the moment they are
 * deciding whether this app understands what they are; and the title
 * "What is your email?" was answered by a white Apple pill that skips the
 * email entirely.
 *
 * Source assertions rather than render tests, in the shape of
 * business/__tests__/vocabulary.test.ts's sibling suites: what is being
 * guarded is the exact string a person reads.
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

describe('the app spells the way it spells "traveler"', () => {
  it('never says "travelling" anywhere a user could read it', () => {
    const offenders = walk(SRC).filter((file) =>
      /travell/i.test(stripped(fs.readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it('names the traveler row as a noun phrase against "I run a business"', () => {
    const code = stripped(
      fs.readFileSync(path.join(SRC, 'features', 'auth', 'account-kind.tsx'), 'utf8')
    );
    expect(code).toContain(`title="I'm a traveler"`);
    expect(code).toContain('title="I run a business"');
  });
});

describe('a business hears one noun for the thing it is making', () => {
  const join = stripped(fs.readFileSync(path.join(SRC, 'app', '(auth)', 'join.tsx'), 'utf8'));

  it('says "listing" on step 1 and step 2 alike, never "creating your profile"', () => {
    // Step 1's business subtitle and step 2's "next" line describe the same
    // object. The moment one says profile and the other listing, the person
    // deciding whether to sign up is being told about two different things.
    expect(join).toContain('when you build your listing.');
    expect(join).toContain('Your listing is next.');
    expect(join).not.toContain('creating your profile');
  });

  it('heads the first screen with the account, not the email', () => {
    // The title has to cover the kind rows, the Apple pill and the email
    // field. "What is your email?" was contradicted by its own loudest
    // action, a pill that skips the email entirely.
    expect(join).toContain('title="Make your account"');
    expect(join).not.toContain('What is your email?');
  });
});
