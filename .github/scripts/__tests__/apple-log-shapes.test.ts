import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const MODULE = path.join(ROOT, '.github', 'scripts', 'apple-log-shapes.mjs');

type Classified = { name: string; verdict: string; detail: string };

/**
 * Run the real module, in real node, as an ES module — which is how the
 * workflow runs it.
 *
 * Jest's transform does not take `.mjs`, and the two ways around that are
 * teaching Jest a new transform or handing the file to the runtime it actually
 * ships on. The second is also the more honest test: no transpilation stands
 * between this assertion and the bytes CI executes. One subprocess answers
 * every question this file asks, so the cost is a single spawn.
 */
function ask(lines: string[], details: string[]) {
  const script = `
    import { classify, scrub, SHAPES } from ${JSON.stringify(MODULE)};
    const input = JSON.parse(process.argv[1]);
    console.log(
      JSON.stringify({
        classified: input.lines.map(classify),
        scrubbed: input.details.map(scrub),
        shapes: SHAPES.map((shape) => ({
          name: shape.name,
          verdict: shape.verdict,
          source: shape.match.source,
          flags: shape.match.flags,
        })),
      })
    );
  `;
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script, JSON.stringify({ lines, details })],
    { encoding: 'utf8' }
  );
  return JSON.parse(out) as {
    classified: Classified[];
    scrubbed: string[];
    shapes: { name: string; verdict: string; source: string; flags: string }[];
  };
}

const SHAPES = ask([], []).shapes;
const classify = (line: string) => ask([line], []).classified[0];
const scrub = (detail: string) => ask([], [detail]).scrubbed[0];
const FUNCTIONS = [
  'supabase/functions/delete-account/index.ts',
  'supabase/functions/store-apple-token/index.ts',
];

/**
 * `.github/scripts/apple-log-shapes.mjs` is a MIRROR of two Edge Functions,
 * and the failure a mirror has is drift: edit a log string in
 * supabase/functions and forget this list, and the reader quietly reclassifies
 * a real answer as "(unrecognised shape, withheld)". The run stays green, the
 * step summary says nothing, and the one question the whole workflow exists to
 * answer goes unanswered while looking answered.
 *
 * So this does not test the mirror against a copy of the strings. It reads the
 * two functions, pulls out every Apple line they can actually write, and
 * requires the classifier to recognise each one — and requires the reverse
 * too, so a shape left behind by a deleted log line is caught as well.
 */

/**
 * Every `console.log`/`console.error` in a file whose message starts with one
 * of the two Apple prefixes, rendered into a concrete example.
 *
 * The substitution is deliberately crude and deliberately typed: an
 * interpolation whose expression mentions `status` becomes a three-digit
 * number, because two of the shapes match on `(\d{3})` and a word there would
 * make this test pass a regex the real line would fail. Everything else
 * becomes prose.
 */
function loggedAppleLines(relative: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const calls = source.matchAll(/console\.(?:log|error)\(\s*(`[^`]*`|'[^']*')\s*\)/g);
  const lines: string[] = [];
  for (const call of calls) {
    const literal = call[1];
    const body = literal.slice(1, -1);
    if (!body.startsWith('apple revoke:') && !body.startsWith('store-apple-token:')) {
      continue;
    }
    lines.push(
      body.replace(/\$\{([^}]*)\}/g, (_whole, expression: string) =>
        /status/i.test(expression) ? '400' : 'something went wrong'
      )
    );
  }
  return lines;
}

describe('the Apple log classifier mirrors the functions it reads', () => {
  const emitted = FUNCTIONS.flatMap(loggedAppleLines);

  it('finds every Apple log line in both functions', () => {
    // Ten today. A change to this number is a change to the functions, and it
    // should be looked at rather than nudged.
    expect(emitted).toHaveLength(10);
    expect(emitted.filter((line) => line.startsWith('apple revoke:'))).toHaveLength(6);
    expect(emitted.filter((line) => line.startsWith('store-apple-token:'))).toHaveLength(4);
  });

  it.each(FUNCTIONS.flatMap(loggedAppleLines))('recognises %p', (line) => {
    const seen = classify(line);
    expect(seen.name).not.toBe('(unrecognised shape, withheld)');
  });

  it('has no shape left over from a log line that no longer exists', () => {
    for (const shape of SHAPES) {
      const match = new RegExp(shape.source, shape.flags);
      const matched = emitted.some((line) => match.test(line));
      expect(`${shape.name}: ${matched ? 'still emitted' : 'ORPHANED'}`).toBe(
        `${shape.name}: still emitted`
      );
    }
  });

  it('still recognises a line the platform wrapped something around', () => {
    // The shapes anchor at `^`, so if `event_message` ever carries more than
    // the console line, appleLine() is the only thing standing between a real
    // answer and "(unrecognised shape, withheld)".
    const seen = classify('2026-09-04T09:34:06Z [info] apple revoke: ok (200)');
    expect(seen.verdict).toBe('pass');
    expect(seen.detail).toContain('HTTP 200');
  });

  it('withholds a line it does not know, and names it only by hash', () => {
    const seen = classify('apple revoke: some future wording nobody has written yet');
    expect(seen.name).toBe('(unrecognised shape, withheld)');
    expect(seen.detail).toMatch(/^sha256 [0-9a-f]{16}, \d+ characters$/);
    expect(seen.detail).not.toContain('future wording');
  });
});

describe('the verdicts say the right thing', () => {
  it('treats a 2xx from Apple as the one positive line', () => {
    const seen = classify('apple revoke: ok (200)');
    expect(seen.verdict).toBe('pass');
    expect(seen.detail).toContain('HTTP 200');
  });

  it('treats a missing token as quiet, not as a pass', () => {
    // The false pass docs/APP_STORE.md warns about: it reads like benign
    // housekeeping and is what a deletion looks like when the sign-in stored
    // nothing.
    expect(classify('apple revoke: no token for this account, nothing to revoke').verdict).toBe(
      'quiet'
    );
  });

  it.each([
    'apple revoke: Sign in with Apple key not provisioned; token NOT revoked',
    'apple revoke: failed (400): {"error":"invalid_client"}',
    'apple revoke: could not read token: connection reset',
    'apple revoke: threw: TypeError: bad key',
    'store-apple-token: Sign in with Apple key not provisioned; nothing stored',
    'store-apple-token: exchange threw: TypeError: bad key',
    'store-apple-token: exchange 400: {"error":"invalid_grant"}',
    'store-apple-token: upsert failed: connection reset',
  ])('calls %p a failure', (line) => {
    expect(classify(line).verdict).toBe('fail');
  });

  it('does not let the failure shape swallow a success', () => {
    // `failed (400): ...` and `ok (200)` are one word apart, and the ordering
    // of SHAPES is what keeps them separate.
    expect(classify('apple revoke: ok (200)').name).toContain('Apple accepted');
  });
});

describe('scrub keeps identifiers out of a public log', () => {
  it.each([
    ['a uuid', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', '(uuid)'],
    ['an email', 'someone@example.com', '(email)'],
    ['a jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop', '(jwt)'],
    ['a long token', 'a'.repeat(64), '(token)'],
  ])('replaces %s', (_what, secret, placeholder) => {
    const scrubbed = scrub(`Apple said: ${secret} is no good`);
    expect(scrubbed).toContain(placeholder);
    expect(scrubbed).not.toContain(secret);
  });

  it('caps a long detail, so a body cannot be smuggled through in pieces', () => {
    expect(scrub('short words '.repeat(200)).length).toBeLessThanOrEqual(200);
  });

  it('leaves an ordinary Apple error readable', () => {
    expect(scrub('{"error":"invalid_client"}')).toBe('{"error":"invalid_client"}');
  });
});
